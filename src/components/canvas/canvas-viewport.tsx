'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CanvasEngine } from '@/lib/canvas/engine'
import { useCanvasStore } from '@/stores/canvas'
import { hexToRgba, rgbToHex } from '@/lib/canvas/flood-fill'
import type { CanvasTool } from '@/types/canvas'

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

  const activeLayerLocked = useMemo(
    () => layers.find((l) => l.id === activeLayerId)?.locked ?? false,
    [layers, activeLayerId],
  )

  const cursor = useMemo(
    () => cursorForTool(activeTool, activeLayerLocked),
    [activeTool, activeLayerLocked],
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
            pressure: e.pressure || 0.5,
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

        engine.strokeEngine.continueStroke(
          {
            x: canvasPoint.x,
            y: canvasPoint.y,
            pressure: e.pressure || 0.5,
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
 * Resolve the CSS cursor for a given tool + active-layer-lock state.
 *
 * Locked active layer short-circuits to `not-allowed` for any tool that
 * would mutate pixels (brush, eraser, fill, eyedropper-is-read-only-so-ok,
 * pan-doesn't-care). We deliberately still allow `grab` for pan even when
 * the layer is locked — panning the viewport is never a mutation.
 */
function cursorForTool(tool: CanvasTool, locked: boolean): string {
  if (tool === 'pan') return 'grab'
  if (locked) return 'not-allowed'
  switch (tool) {
    case 'eyedropper':
      return 'copy'
    case 'fill':
      return 'cell'
    case 'brush':
    case 'eraser':
    default:
      return 'crosshair'
  }
}

// Extend engine type to hold pending snapshot without polluting the class
interface CanvasEngineWithSnapshot extends CanvasEngine {
  _pendingSnapshot?: import('@/types/canvas').LayerSnapshot | null
}
