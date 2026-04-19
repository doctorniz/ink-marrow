'use client'

import { useCallback, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Copy,
  GripVertical,
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import { toast } from '@/stores/toast'
import type { CanvasEngine } from '@/lib/canvas/engine'
import { COLOR_SWATCHES, STANDARD_BLEND_MODES, HSL_BLEND_MODES } from '@/lib/canvas/constants'
import { cn } from '@/utils/cn'

interface CanvasPropertiesPanelProps {
  engineRef: React.RefObject<CanvasEngine | null>
}

/** Shallow equality for string arrays — used to skip no-op reorders. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function CanvasPropertiesPanel({ engineRef }: CanvasPropertiesPanelProps) {
  const activeTool = useCanvasStore((s) => s.activeTool)
  const brushSettings = useCanvasStore((s) => s.brushSettings)
  const eraserSize = useCanvasStore((s) => s.eraserSize)
  const setBrushSettings = useCanvasStore((s) => s.setBrushSettings)
  const setEraserSize = useCanvasStore((s) => s.setEraserSize)
  const pushRecentColor = useCanvasStore((s) => s.pushRecentColor)
  const recentColors = useCanvasStore((s) => s.recentColors)

  const layers = useCanvasStore((s) => s.layers)
  const activeLayerId = useCanvasStore((s) => s.activeLayerId)
  const setActiveLayerId = useCanvasStore((s) => s.setActiveLayerId)

  // Drag-to-reorder state. Kept in component state (not Zustand) because
  // it's transient UI — no other component cares about the drag in flight.
  //  - `draggedLayerId` is the id of the row currently being dragged, or
  //    null when no drag is in progress.
  //  - `dropIndicator` points at the layer we'd drop onto, and whether
  //    the cursor is in the top half ('above') or bottom half ('below')
  //    of that row. Drives the blue rule rendered between rows.
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<
    { id: string; position: 'above' | 'below' } | null
  >(null)

  const isEraser = activeTool === 'eraser'
  const currentSize = isEraser ? eraserSize : brushSettings.size

  // Which controls are relevant for the current tool. Keeping the panel
  // honest — we don't render sliders / pickers that have no effect on
  // the selected tool, so the user isn't misled into fiddling with
  // controls the engine ignores.
  //
  //   Brush      → Color + Size + Opacity
  //   Eraser     → Size only (color/opacity ignored by the erase blend)
  //   Pan        → no stroke controls; Layers panel still shown below
  //   Fill       → Color + Opacity (no size — fill floods a region)
  //   Eyedropper → no controls; samples the canvas on click
  const showColor = activeTool === 'brush' || activeTool === 'fill'
  const showSize = activeTool === 'brush' || activeTool === 'eraser'
  const showOpacity = activeTool === 'brush' || activeTool === 'fill'
  // Hardness only makes sense for the normal brush. The eraser uses
  // a crisp disc mask by design (soft erasers are a future follow-up).
  const showHardness = activeTool === 'brush'

  /* ---- Engine-backed actions ---- */

  function syncLayersToStore() {
    const engine = engineRef.current
    if (!engine?.initialized) return
    useCanvasStore.getState().setLayers(engine.layerManager.getLayerMeta())
    useCanvasStore.getState().setActiveLayerId(engine.layerManager.activeLayerId)
  }

  function handleAddLayer() {
    const engine = engineRef.current
    if (!engine?.initialized) return
    engine.layerManager.addLayer()
    syncLayersToStore()
    useCanvasStore.getState().markDirty()
  }

  /**
   * Layer deletion with undo wiring.
   *
   * Before the destructive `removeLayer` call, we capture the layer's
   * full data (metadata + pixel PNG) and its stack index, then push a
   * `remove-layer` undo entry. This is the *only* safety net — there's
   * no confirmation dialog — so if the capture fails (GPU extract
   * rejected, layer already gone) we bail and leave the layer intact
   * rather than deleting something we can't bring back. That surfaces
   * via the toast; the user can retry.
   *
   * The capture is async (extract.base64 is async) but `removeLayer`
   * is synchronous, so we sequence them in an IIFE and only update the
   * store / mark dirty once the whole thing has succeeded.
   */
  function handleRemoveLayer(id: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return

    // Guard against deleting the last layer — the engine already no-ops
    // in this case, but returning early here avoids the async snapshot
    // work and the toast on what is intentionally a disabled button.
    if (engine.layerManager.getAllLayers().length <= 1) return

    void (async () => {
      try {
        const index = engine.layerManager
          .getAllLayers()
          .findIndex((l) => l.id === id)
        if (index === -1) return

        const wasActive = engine.layerManager.activeLayerId === id
        const layerData = await engine.layerManager.captureLayerData(id)
        if (!layerData) {
          // Can't safely capture → refuse to delete rather than risk
          // losing the layer's pixels with no way to recover them.
          toast.error('Could not snapshot layer for undo — delete aborted')
          return
        }

        engine.layerManager.removeLayer(id)
        engine.undoManager.push({
          kind: 'remove-layer',
          description: `Delete ${layerData.name}`,
          layerData,
          index,
          wasActive,
        })

        engine.render()
        syncLayersToStore()
        const store = useCanvasStore.getState()
        store.markDirty()
        store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
        toast.info(`Deleted ${layerData.name} — Ctrl+Z to undo`)
      } catch (err) {
        console.error('Layer delete failed:', err)
        toast.error('Failed to delete layer')
      }
    })()
  }

  function handleDuplicateLayer(id: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    engine.layerManager.duplicateLayer(id)
    syncLayersToStore()
    useCanvasStore.getState().markDirty()
  }

  function handleSelectLayer(id: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    engine.layerManager.setActiveLayer(id)
    setActiveLayerId(id)
  }

  function handleToggleVisibility(id: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    const layer = engine.layerManager.getLayer(id)
    if (!layer) return
    engine.layerManager.setLayerVisibility(id, !layer.visible)
    engine.render()
    syncLayersToStore()
  }

  function handleToggleLock(id: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    const layer = engine.layerManager.getLayer(id)
    if (!layer) return
    engine.layerManager.setLayerLocked(id, !layer.locked)
    syncLayersToStore()
  }

  function handleOpacityChange(id: string, opacity: number) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    engine.layerManager.setLayerOpacity(id, opacity)
    engine.render()
    syncLayersToStore()
  }

  function handleBlendModeChange(id: string, mode: string) {
    const engine = engineRef.current
    if (!engine?.initialized) return
    engine.layerManager.setLayerBlendMode(id, mode)
    engine.render()
    syncLayersToStore()
  }

  /**
   * Live brush-color update. Called on every tick during a native color
   * picker drag so the brush preview stays in sync with the picker thumb.
   * Intentionally does *not* push to `recentColors` — the native
   * `<input type="color">` DOM `input` event fires continuously while the
   * user drags the HSL sliders, which would otherwise pollute the recent
   * palette with every intermediate shade. See `handleColorCommit` for
   * the commit-on-close path.
   */
  const handleColorChange = useCallback(
    (color: string) => {
      setBrushSettings({ color })
    },
    [setBrushSettings],
  )

  /**
   * Commit-level color change. Use for one-shot actions (swatch click,
   * typed hex, native picker close) where the color is considered
   * "chosen" — these push into `recentColors`.
   */
  const handleColorCommit = useCallback(
    (color: string) => {
      setBrushSettings({ color })
      pushRecentColor(color)
    },
    [setBrushSettings, pushRecentColor],
  )

  /* ---- Drag-to-reorder handlers ----
   *
   * Layers are displayed in reverse of their stack order: display-top is
   * the last element of the `layers` array (the topmost visible layer).
   * When the user drops layer A visually *above* layer B, A should end
   * up *above* B in the viewport too — meaning A gets a higher stack
   * index than B.
   *
   * The reorder is an undo-able operation: we capture the pre-drop id
   * array, compute the new array, and push a `reorder-layers` entry
   * with both. Reversing swaps before/after — see UndoManager.
   */

  function handleLayerDragStart(e: React.DragEvent, id: string) {
    setDraggedLayerId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Required for Firefox to fire drag events at all.
    e.dataTransfer.setData('text/plain', id)
  }

  function handleLayerDragOver(e: React.DragEvent, targetId: string) {
    if (!draggedLayerId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedLayerId === targetId) {
      setDropIndicator(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    const position: 'above' | 'below' = e.clientY < midpoint ? 'above' : 'below'
    setDropIndicator((prev) =>
      prev && prev.id === targetId && prev.position === position
        ? prev
        : { id: targetId, position },
    )
  }

  function handleLayerDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    const engine = engineRef.current
    const draggedId = draggedLayerId
    setDropIndicator(null)
    setDraggedLayerId(null)

    if (!engine?.initialized || !draggedId || draggedId === targetId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    const position: 'above' | 'below' = e.clientY < midpoint ? 'above' : 'below'

    const before = engine.layerManager.getAllLayers().map((l) => l.id)
    const withoutDragged = before.filter((id) => id !== draggedId)
    const targetIdx = withoutDragged.indexOf(targetId)
    if (targetIdx === -1) return

    // Layers in the UI are rendered with [...layers].reverse(), so:
    //   display 'above' target  → higher stack index → targetIdx + 1
    //   display 'below' target  → lower stack index  → targetIdx
    const insertAt = position === 'above' ? targetIdx + 1 : targetIdx
    const after = [...withoutDragged]
    after.splice(insertAt, 0, draggedId)

    if (arraysEqual(before, after)) return

    engine.layerManager.reorderLayers(after)
    engine.undoManager.push({
      kind: 'reorder-layers',
      description: 'Reorder layers',
      before,
      after,
    })
    engine.render()
    syncLayersToStore()
    const store = useCanvasStore.getState()
    store.markDirty()
    store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
  }

  function handleLayerDragEnd() {
    // Always clean up — a drop outside any row (onto empty space) won't
    // fire our onDrop, and a failed drop shouldn't leave the indicator
    // hanging or the row stuck at reduced opacity.
    setDraggedLayerId(null)
    setDropIndicator(null)
  }

  return (
    <div className="border-border bg-bg flex w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-l p-3">
      {/* ---- Color ---- */}
      {showColor && (
      <section>
        <h3 className="text-fg-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
          Color
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={brushSettings.color}
            onChange={(e) => handleColorChange(e.target.value)}
            onBlur={(e) => handleColorCommit(e.target.value)}
            className="size-8 cursor-pointer rounded border-none"
          />
          <input
            type="text"
            value={brushSettings.color}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                handleColorCommit(e.target.value)
              }
            }}
            className="border-border bg-bg-secondary text-fg w-20 rounded border px-2 py-1 font-mono text-xs"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleColorCommit(c)}
              className={cn(
                'size-5 rounded-sm border transition-transform hover:scale-110',
                brushSettings.color === c ? 'border-accent ring-accent ring-1' : 'border-border',
              )}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
        {recentColors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recentColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleColorCommit(c)}
                className="border-border size-4 rounded-sm border transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {/* ---- Brush Size ---- */}
      {showSize && (
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-fg-secondary text-xs font-semibold uppercase tracking-wider">
            {isEraser ? 'Eraser Size' : 'Brush Size'}
          </h3>
          <span className="text-fg-muted text-xs">{currentSize}px</span>
        </div>
        <Slider.Root
          min={1}
          max={200}
          step={1}
          value={[currentSize]}
          onValueChange={([v]) => {
            if (isEraser) setEraserSize(v)
            else setBrushSettings({ size: v })
          }}
          className="relative flex h-5 w-full items-center"
        >
          <Slider.Track className="bg-bg-tertiary relative h-1.5 grow rounded-full">
            <Slider.Range className="bg-accent absolute h-full rounded-full" />
          </Slider.Track>
          <Slider.Thumb className="bg-fg border-border block size-4 rounded-full border-2 shadow focus:outline-none" />
        </Slider.Root>
      </section>
      )}

      {/* ---- Opacity ---- */}
      {showOpacity && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-fg-secondary text-xs font-semibold uppercase tracking-wider">
              Opacity
            </h3>
            <span className="text-fg-muted text-xs">
              {Math.round(brushSettings.opacity * 100)}%
            </span>
          </div>
          <Slider.Root
            min={0}
            max={100}
            step={1}
            value={[Math.round(brushSettings.opacity * 100)]}
            onValueChange={([v]) => setBrushSettings({ opacity: v / 100 })}
            className="relative flex h-5 w-full items-center"
          >
            <Slider.Track className="bg-bg-tertiary relative h-1.5 grow rounded-full">
              <Slider.Range className="bg-accent absolute h-full rounded-full" />
            </Slider.Track>
            <Slider.Thumb className="bg-fg border-border block size-4 rounded-full border-2 shadow focus:outline-none" />
          </Slider.Root>
        </section>
      )}

      {/* ---- Hardness ---- */}
      {showHardness && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-fg-secondary text-xs font-semibold uppercase tracking-wider">
              Hardness
            </h3>
            <span className="text-fg-muted text-xs">
              {Math.round(brushSettings.hardness * 100)}%
            </span>
          </div>
          <Slider.Root
            min={0}
            max={100}
            step={1}
            value={[Math.round(brushSettings.hardness * 100)]}
            onValueChange={([v]) => setBrushSettings({ hardness: v / 100 })}
            className="relative flex h-5 w-full items-center"
          >
            <Slider.Track className="bg-bg-tertiary relative h-1.5 grow rounded-full">
              <Slider.Range className="bg-accent absolute h-full rounded-full" />
            </Slider.Track>
            <Slider.Thumb className="bg-fg border-border block size-4 rounded-full border-2 shadow focus:outline-none" />
          </Slider.Root>
        </section>
      )}

      {/* ---- Layers ---- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-fg-secondary text-xs font-semibold uppercase tracking-wider">
            Layers
          </h3>
          <button
            type="button"
            onClick={handleAddLayer}
            title="Add layer"
            className="text-fg-secondary hover:text-fg rounded p-0.5"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div
          className="flex flex-col gap-0.5"
          onDragLeave={(e) => {
            // Only clear the indicator when the drag actually leaves the
            // *list* — child-to-child dragover transitions fire dragleave
            // on the old child first, but the relatedTarget is still
            // inside the list container so we keep the indicator.
            if (
              !e.currentTarget.contains(e.relatedTarget as Node | null)
            ) {
              setDropIndicator(null)
            }
          }}
        >
          {[...layers].reverse().map((layer) => {
            const isDragging = draggedLayerId === layer.id
            const indicatorAbove
              = dropIndicator?.id === layer.id && dropIndicator.position === 'above'
            const indicatorBelow
              = dropIndicator?.id === layer.id && dropIndicator.position === 'below'
            return (
              <div key={layer.id} className="relative">
                {/* Drop indicator rules — thin coloured bar between rows.
                    Positioned with negative offsets so they sit in the
                    1.5px gap without reflowing the row itself. */}
                {indicatorAbove && (
                  <div className="bg-accent pointer-events-none absolute inset-x-0 -top-0.5 h-0.5 rounded-full" />
                )}
                {indicatorBelow && (
                  <div className="bg-accent pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full" />
                )}
                <div
                  draggable
                  onDragStart={(e) => handleLayerDragStart(e, layer.id)}
                  onDragOver={(e) => handleLayerDragOver(e, layer.id)}
                  onDrop={(e) => handleLayerDrop(e, layer.id)}
                  onDragEnd={handleLayerDragEnd}
                  onClick={() => handleSelectLayer(layer.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-1 py-1.5 text-xs cursor-pointer transition-colors',
                    activeLayerId === layer.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-secondary hover:bg-bg-hover',
                    isDragging && 'opacity-40',
                  )}
                >
                  <GripVertical
                    className="text-fg-muted size-3 shrink-0 cursor-grab active:cursor-grabbing"
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleToggleVisibility(layer.id) }}
                    className="shrink-0 p-0.5"
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? (
                      <Eye className="size-3" />
                    ) : (
                      <EyeOff className="size-3 opacity-40" />
                    )}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleToggleLock(layer.id) }}
                    className="shrink-0 p-0.5 opacity-50 hover:opacity-100"
                    title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  >
                    {layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDuplicateLayer(layer.id) }}
                    className="shrink-0 p-0.5 opacity-50 hover:opacity-100"
                    title="Duplicate layer"
                  >
                    <Copy className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveLayer(layer.id) }}
                    className="shrink-0 p-0.5 opacity-50 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:opacity-20"
                    title="Delete layer"
                    disabled={layers.length <= 1}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ---- Active Layer Settings ---- */}
      {activeLayerId && (
        <section>
          <h3 className="text-fg-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
            Layer Settings
          </h3>
          {(() => {
            const layer = layers.find((l) => l.id === activeLayerId)
            if (!layer) return null
            return (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-fg-secondary text-xs">Opacity</span>
                    <span className="text-fg-muted text-xs">
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </div>
                  <Slider.Root
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(layer.opacity * 100)]}
                    onValueChange={([v]) => handleOpacityChange(layer.id, v / 100)}
                    className="relative flex h-5 w-full items-center"
                  >
                    <Slider.Track className="bg-bg-tertiary relative h-1.5 grow rounded-full">
                      <Slider.Range className="bg-accent absolute h-full rounded-full" />
                    </Slider.Track>
                    <Slider.Thumb className="bg-fg border-border block size-4 rounded-full border-2 shadow focus:outline-none" />
                  </Slider.Root>
                </div>
                <div>
                  <span className="text-fg-secondary text-xs">Blend Mode</span>
                  <select
                    value={layer.blendMode}
                    onChange={(e) => handleBlendModeChange(layer.id, e.target.value)}
                    className="border-border bg-bg-secondary text-fg mt-1 w-full rounded border px-2 py-1 text-xs"
                  >
                    {STANDARD_BLEND_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, ' ')}
                      </option>
                    ))}
                    <optgroup label="HSL (may fall back to Normal)">
                      {HSL_BLEND_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, ' ')}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
            )
          })()}
        </section>
      )}
    </div>
  )
}
