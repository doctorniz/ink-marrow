'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CanvasEngine } from '@/lib/canvas/engine'
import { useCanvasStore } from '@/stores/canvas'
import { hexToRgba, rgbToHex } from '@/lib/canvas/flood-fill'
import type { CanvasTool, BrushSettings } from '@/types/canvas'

interface CanvasViewportProps {
  engineRef: React.RefObject<CanvasEngine | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The div that hosts the PixiJS <canvas>.
 * Handles all pointer events (drawing, panning) and wheel (zoom).
 *
 * Pointer handlers read tool state via `useCanvasStore.getState()` to avoid
 * stale closures — a tool switch mid-stroke (unlikely but possible via
 * keyboard shortcut) should be picked up instantly without re-wiring
 * listeners. The cursor style, however, is a *render-time* concern and
 * MUST come from a reactive selector so the component re-renders when
 * the tool changes — otherwise the inline `style.cursor` is frozen at
 * first-mount value. See BUG-06.
 */
export function CanvasViewport({ engineRef, containerRef }: CanvasViewportProps) {
  const activePointerRef = useRef<number | null>(null)

  // Reactive selectors — these drive the cursor style below.
  const activeTool = useCanvasStore((s) => s.activeTool)
  const activeLayerId = useCanvasStore((s) => s.activeLayerId)
  const layers = useCanvasStore((s) => s.layers)
  const brushSettings = useCanvasStore((s) => s.brushSettings)
  const eraserSize = useCanvasStore((s) => s.eraserSize)
  const zoom = useCanvasStore((s) => s.viewport.zoom)

  const activeLayerLocked = useMemo(
    () => layers.find((l) => l.id === activeLayerId)?.locked ?? false,
    [layers, activeLayerId],
  )

  const cursor = useMemo(
    () => cursorForTool(activeTool, activeLayerLocked, brushSettings, eraserSize, zoom),
    [activeTool, activeLayerLocked, brushSettings, eraserSize, zoom],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const engine = engineRef.current
      if (!engine?.initialized) return

      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      activePointerRef.current = e.pointerId

      const tool = useCanvasStore.getState().activeTool
      const rect = el.getBoundingClientRect()

      if (tool === 'pan' || e.button === 1 || (e.altKey && tool !== 'eyedropper')) {
        // Pan with middle click, alt+click, or pan tool
        engine.viewportController.beginPan(e.clientX, e.clientY)
        return
      }

      if (tool === 'brush' || tool === 'eraser') {
        const canvasPoint = engine.viewportController.screenToCanvas(
          e.clientX,
          e.clientY,
          rect,
        )
        const state = useCanvasStore.getState()
        const settings = tool === 'eraser'
          ? { ...state.brushSettings, size: state.eraserSize }
          : state.brushSettings

        // Auto-expand the canvas if this stroke starts beyond the current bounds.
        engine.expandToFit(canvasPoint.x, canvasPoint.y)

        // Snapshot for undo before drawing
        void (async () => {
          const snapshot = await engine.undoManager.snapshotActiveLayer()
          if (snapshot) {
            // Store snapshot temporarily — will be pushed on stroke commit
            ;(engine as CanvasEngineWithSnapshot)._pendingSnapshot = snapshot
          }
        })()

        engine.strokeEngine.beginStroke(
          {
            x: canvasPoint.x,
            y: canvasPoint.y,
            // Mouse is a binary device — spec reports 0.5 when pressed, but
            // that halves the brush size vs the configured value. Treat mouse
            // as full pressure so size-setting = actual painted size. Stylus
            // and touch keep their real reported pressure for expression.
            pressure: e.pointerType === 'mouse' ? 1.0 : (e.pressure || 0.5),
            tiltX: e.tiltX,
            tiltY: e.tiltY,
            timestamp: e.timeStamp,
          },
          settings,
          tool === 'eraser',
        )
        engine.render()
      }

      if (tool === 'fill') {
        const canvasPoint = engine.viewportController.screenToCanvas(
          e.clientX,
          e.clientY,
          rect,
        )
        const state = useCanvasStore.getState()
        const [r, g, b, a] = hexToRgba(
          state.brushSettings.color,
          state.brushSettings.opacity,
        )
        const layerId = engine.layerManager.activeLayerId
        if (!layerId) return

        // Snapshot + fill + push undo, sequenced. The snapshot must
        // complete *before* the fill mutates the RT, otherwise we'd
        // capture the post-fill state and undo would be a no-op.
        void (async () => {
          try {
            const snapshot = await engine.undoManager.snapshotActiveLayer()
            const ok = await engine.layerManager.floodFillLayer(
              layerId,
              canvasPoint.x,
              canvasPoint.y,
              r, g, b, a,
            )
            if (!ok) return
            engine.render()
            if (snapshot) {
              engine.undoManager.push({
                kind: 'stroke',
                description: 'Fill',
                snapshots: [snapshot],
              })
            }
            const store = useCanvasStore.getState()
            store.markDirty()
            store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
          } catch (err) {
            console.error('Fill failed:', err)
          }
        })()
        return
      }

      if (tool === 'eyedropper') {
        // Sample the composited pixel under the cursor, convert to
        // #rrggbb, push into brush settings + recent-colours list.
        // No undo entry — the eyedropper is non-destructive.
        const canvasPoint = engine.viewportController.screenToCanvas(
          e.clientX,
          e.clientY,
          rect,
        )
        const sample = engine.layerManager.sampleCompositedPixel(
          canvasPoint.x,
          canvasPoint.y,
          engine.background,
        )
        if (sample) {
          const hex = rgbToHex(sample.r, sample.g, sample.b)
          const store = useCanvasStore.getState()
          store.setBrushSettings({ color: hex })
          store.pushRecentColor(hex)
        }
        return
      }
    },
    [engineRef],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const engine = engineRef.current
      if (!engine?.initialized) return
      if (activePointerRef.current !== e.pointerId) return

      if (engine.viewportController.isPanning) {
        engine.viewportController.updatePan(e.clientX, e.clientY)
        useCanvasStore.getState().setViewport(engine.viewportController.state)
        engine.render()
        return
      }

      if (engine.strokeEngine.isDrawing) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvasPoint = engine.viewportController.screenToCanvas(
          e.clientX,
          e.clientY,
          rect,
        )
        const state = useCanvasStore.getState()
        const tool = state.activeTool
        const settings = tool === 'eraser'
          ? { ...state.brushSettings, size: state.eraserSize }
          : state.brushSettings

        // Auto-expand mid-stroke if the pointer crosses the canvas boundary.
        // expandCanvas preserves scratchpad content so the stroke is seamless.
        engine.expandToFit(canvasPoint.x, canvasPoint.y)

        engine.strokeEngine.continueStroke(
          {
            x: canvasPoint.x,
            y: canvasPoint.y,
            pressure: e.pointerType === 'mouse' ? 1.0 : (e.pressure || 0.5),
            tiltX: e.tiltX,
            tiltY: e.tiltY,
            timestamp: e.timeStamp,
          },
          settings,
        )
        engine.render()
      }
    },
    [engineRef],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const engine = engineRef.current
      if (!engine?.initialized) return

      const el = e.currentTarget
      el.releasePointerCapture(e.pointerId)
      activePointerRef.current = null

      if (engine.viewportController.isPanning) {
        engine.viewportController.endPan()
        useCanvasStore.getState().setViewport(engine.viewportController.state)
        return
      }

      if (engine.strokeEngine.isDrawing) {
        engine.strokeEngine.endStroke()
        engine.render()

        // Push undo entry
        const snapshot = (engine as CanvasEngineWithSnapshot)._pendingSnapshot
        if (snapshot) {
          engine.undoManager.push({
            kind: 'stroke',
            snapshots: [snapshot],
            description: 'Stroke',
          })
          ;(engine as CanvasEngineWithSnapshot)._pendingSnapshot = null
        }

        const store = useCanvasStore.getState()
        store.markDirty()
        store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
      }
    },
    [engineRef],
  )

  /**
   * Attach `wheel` as a native, *non-passive* listener.
   *
   * React's synthetic `onWheel` is delegated through the root and we
   * cannot control its `passive` flag from JSX. In passive mode
   * `e.preventDefault()` is a silent no-op: the canvas still zooms, but
   * the outer scroll container *also* scrolls, producing a disorienting
   * "zoom + scroll-away" double-action and the browser logs
   * "Unable to preventDefault inside passive event listener".
   *
   * Attaching directly via `addEventListener(..., { passive: false })`
   * guarantees `preventDefault()` actually suppresses the native scroll,
   * regardless of what React's wheel delegation is doing today.
   *
   * The handler reads `engineRef.current` inside, so it does not need to
   * be re-bound on every engine swap.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      const engine = engineRef.current
      if (!engine?.initialized) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const pivotX = e.clientX - rect.left
      const pivotY = e.clientY - rect.top
      engine.viewportController.zoomAtPoint(-e.deltaY, pivotX, pivotY)
      useCanvasStore.getState().setViewport(engine.viewportController.state)
      engine.render()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
    }
  }, [containerRef, engineRef])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 overflow-hidden bg-neutral-100 dark:bg-neutral-900"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
      style={{ touchAction: 'none', cursor }}
    />
  )
}

/**
 * Encode an SVG string as a CSS cursor url(...) value.
 * The double-stroke technique (white thick + black thin) keeps the icon
 * legible on both light and dark canvas backgrounds.
 */
function svgCursor(svg: string, hotspotX: number, hotspotY: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspotX} ${hotspotY}, ${fallback}`
}

// Lucide PaintBucket paths — hotspot at the paint-drop centre (20, 19)
const FILL_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
  `<g stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">` +
  `<path d="m19 11-8-8-8.5 8.5a5.5 5.5 0 0 0 11 0Z"/>` +
  `<path d="m20 12 2-2"/><line x1="19" x2="21" y1="11" y2="9"/>` +
  `<path d="M22 17v1a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0Z"/>` +
  `</g>` +
  `<g stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">` +
  `<path d="m19 11-8-8-8.5 8.5a5.5 5.5 0 0 0 11 0Z"/>` +
  `<path d="m20 12 2-2"/><line x1="19" x2="21" y1="11" y2="9"/>` +
  `<path d="M22 17v1a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0Z"/>` +
  `</g></svg>`,
  20, 19, 'cell',
)

// Lucide Pipette paths — hotspot at the pipette tip (2, 22)
const EYEDROPPER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
  `<g stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">` +
  `<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>` +
  `<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>` +
  `</g>` +
  `<g stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">` +
  `<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>` +
  `<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>` +
  `</g></svg>`,
  2, 22, 'crosshair',
)

// Brush/eraser cursor size bounds (CSS cursor max is 128 × 128 in most browsers)
const MIN_CURSOR_PX = 4
const MAX_CURSOR_PX = 128

/**
 * Build a dynamic brush cursor SVG.
 *
 * The circle is filled with the brush color at the current opacity. Hardness
 * drives a radial gradient: hardness=1 → solid fill, hardness=0 → full
 * centre-to-edge fade. A white outer ring + semi-transparent dark inner ring
 * keeps the cursor legible on both light and dark canvas backgrounds.
 *
 * Screen diameter = brushSize × zoom, clamped to 4–128 px.
 * Hotspot is at the circle centre so clicks land in the middle of the dot.
 */
function buildBrushCursor(settings: BrushSettings, zoom: number): string {
  const screenDia = Math.round(settings.size * zoom)
  const d = Math.max(MIN_CURSOR_PX, Math.min(MAX_CURSOR_PX, screenDia))
  const cx = d / 2
  const r = Math.max(0.5, cx - 1.5) // inner radius, leaving room for the ring stroke
  const hardnessPct = Math.round(settings.hardness * 100)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">` +
    `<defs>` +
    `<radialGradient id="bg" cx="${cx}" cy="${cx}" r="${r}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="${hardnessPct}%" stop-color="${settings.color}" stop-opacity="${settings.opacity}"/>` +
    `<stop offset="100%" stop-color="${settings.color}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" stroke="white" stroke-width="2" fill="url(#bg)"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" stroke="rgba(0,0,0,0.55)" stroke-width="1" fill="none"/>` +
    `</svg>`
  const hotspot = Math.round(cx)
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot} ${hotspot}, crosshair`
}

/**
 * Build a dynamic eraser cursor SVG.
 *
 * Shows an empty ring (no fill) so the user can see through it to the pixels
 * they are about to erase. Same double-ring contrast technique as the brush.
 *
 * Screen diameter = eraserSize × zoom, clamped to 4–128 px.
 */
function buildEraserCursor(eraserSize: number, zoom: number): string {
  const screenDia = Math.round(eraserSize * zoom)
  const d = Math.max(MIN_CURSOR_PX, Math.min(MAX_CURSOR_PX, screenDia))
  const cx = d / 2
  const r = Math.max(0.5, cx - 1)
  // White fill previews the erase-to-white effect; dark border keeps it
  // legible on both light and dark canvas backgrounds.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="white" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>` +
    `</svg>`
  const hotspot = Math.round(cx)
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot} ${hotspot}, crosshair`
}

/**
 * Resolve the CSS cursor for a given tool + active-layer-lock state.
 *
 * Locked active layer short-circuits to `not-allowed` for any tool that
 * would mutate pixels (brush, eraser, fill — eyedropper is read-only,
 * pan doesn't mutate). We deliberately still allow `grab` for pan even
 * when the layer is locked — panning the viewport is never a mutation.
 */
function cursorForTool(
  tool: CanvasTool,
  locked: boolean,
  brushSettings: BrushSettings,
  eraserSize: number,
  zoom: number,
): string {
  if (tool === 'pan') return 'grab'
  if (locked) return 'not-allowed'
  switch (tool) {
    case 'brush':
      return buildBrushCursor(brushSettings, zoom)
    case 'eraser':
      return buildEraserCursor(eraserSize, zoom)
    case 'eyedropper':
      return EYEDROPPER_CURSOR
    case 'fill':
      return FILL_CURSOR
    default:
      return 'crosshair'
  }
}

// Extend engine type to hold pending snapshot without polluting the class
interface CanvasEngineWithSnapshot extends CanvasEngine {
  _pendingSnapshot?: import('@/types/canvas').LayerSnapshot | null
}
