'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { useCanvasStore } from '@/stores/canvas'
import { useEditorStore } from '@/stores/editor'
import { useAutoSave } from '@/hooks/use-auto-save'
import { CanvasEngine } from '@/lib/canvas/engine'
import { readCanvasFile, writeCanvasFile } from '@/lib/canvas/canvas-file-io'
import { toast } from '@/stores/toast'
import { CanvasViewport } from '@/components/canvas/canvas-viewport'
import { CanvasToolStrip } from '@/components/canvas/canvas-tool-strip'
import { CanvasPropertiesPanel } from '@/components/canvas/canvas-properties-panel'
import type { CanvasTool } from '@/types/canvas'

interface CanvasEditorProps {
  tabId: string
  path: string
  isNew?: boolean
  onRenamed?: () => void
  onRename?: (tabId: string, oldPath: string, stem: string, ext: string) => void
  onPersisted?: () => void
}

/**
 * Outstanding unmount-flush promises, keyed by canvas file path.
 *
 * When a canvas editor unmounts, it schedules an async
 * `flushSave → engine.destroy` sequence. The next mount of the same path
 * must await that promise before reading the file from disk, otherwise
 * it sees stale bytes. This map is the hand-off — unmount writes to it,
 * the next mount reads and awaits, then deletes the entry.
 *
 * Module scope (not a ref) because the new mount is a fresh component
 * instance with no shared React refs.
 */
const pendingCanvasSaves = new Map<string, Promise<void>>()

const CANVAS_PANEL_STORAGE_KEY = 'ink-marrow:canvas-panel-width'
const CANVAS_PANEL_DEFAULT_WIDTH = 260
const CANVAS_PANEL_MIN_WIDTH = 180
const CANVAS_PANEL_MAX_RATIO = 0.45
/** Collapse the right panel automatically when the canvas editor container
 *  is narrower than this (px). Wider than `CANVAS_SIDEBAR_MEDIA_QUERY` so
 *  the panel collapses before the nav sidebar does. */
const CANVAS_PANEL_AUTO_COLLAPSE_BELOW = 780

export function CanvasEditor({ tabId, path, onRename, onPersisted }: CanvasEditorProps) {
  const { vaultFs } = useVaultSession()
  const engineRef = useRef<CanvasEngine | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  const [loading, setLoading] = useState(true)

  /* ---- Right panel collapse / resize ---- */

  const layoutRef = useRef<HTMLDivElement>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const panelCollapsedRef = useRef(false)
  const panelAutoCollapsedRef = useRef(false)
  const dragRef = useRef(false)

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return CANVAS_PANEL_DEFAULT_WIDTH
    const raw = localStorage.getItem(CANVAS_PANEL_STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : CANVAS_PANEL_DEFAULT_WIDTH
  })

  // Keep ref in sync for use inside ResizeObserver callback
  useEffect(() => { panelCollapsedRef.current = panelCollapsed }, [panelCollapsed])

  // Persist width
  useEffect(() => {
    if (!panelCollapsed) localStorage.setItem(CANVAS_PANEL_STORAGE_KEY, String(panelWidth))
  }, [panelWidth, panelCollapsed])

  // Auto-collapse / restore when the canvas editor container resizes
  useLayoutEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      if (w > 0 && w < CANVAS_PANEL_AUTO_COLLAPSE_BELOW && !panelCollapsedRef.current) {
        panelAutoCollapsedRef.current = true
        setPanelCollapsed(true)
      } else if (w >= CANVAS_PANEL_AUTO_COLLAPSE_BELOW && panelCollapsedRef.current && panelAutoCollapsedRef.current) {
        panelAutoCollapsedRef.current = false
        setPanelCollapsed(false)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Drag-to-resize handlers
  function clampPanelWidth(px: number): number {
    const el = layoutRef.current
    if (!el) return Math.max(CANVAS_PANEL_MIN_WIDTH, px)
    const max = Math.max(CANVAS_PANEL_MIN_WIDTH, Math.floor(el.clientWidth * CANVAS_PANEL_MAX_RATIO))
    return Math.min(Math.max(CANVAS_PANEL_MIN_WIDTH, px), max)
  }

  function onDragPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    dragRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onDragPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const el = layoutRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPanelWidth(clampPanelWidth(rect.right - e.clientX))
  }

  function onDragPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    dragRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  /* ---- Init + Load + Cleanup ---- */

  useEffect(() => {
    const signal = { cancelled: false }
    const engine = new CanvasEngine()
    engineRef.current = engine

    void (async () => {
      try {
        // If a previous mount of this same path is still flushing to
        // disk + tearing down, wait for that to finish before we read
        // the file. Otherwise we would read stale bytes and overwrite
        // the user's most recent changes with load-time state.
        const prior = pendingCanvasSaves.get(path)
        if (prior) {
          try { await prior } catch { /* best-effort */ }
          if (signal.cancelled) { engine.destroy(); return }
        }

        if (!containerRef.current) return
        await engine.init(containerRef.current)
        if (signal.cancelled) { engine.destroy(); return }

        // Load file. v5 reads metadata JSON plus PNGs from
        // `_marrow/_drawings/<assetId>/<layerId>.png`. v4 falls back to
        // the legacy sibling `<path>.assets/<layerId>.png` folder; v3
        // files with inline base64 pixels are still honoured. Both
        // older formats are rewritten as v5 on the next save.
        try {
          await readCanvasFile(engine, vaultFs, path)
          if (signal.cancelled) { engine.destroy(); return }
        } catch {
          engine.initDefault()
        }
        if (signal.cancelled) { engine.destroy(); return }

        // Wire stroke commit callback
        engine.strokeEngine.onStrokeCommitted = () => {
          // Already handled in viewport pointerup
        }

        // Sync store from engine
        syncStoreFromEngine(engine)
        setLoading(false)
      } catch (err) {
        console.error('Canvas init failed:', err)
        toast.error('Failed to initialize canvas')
      }
    })()

    return () => {
      signal.cancelled = true

      // Stop the Pixi ticker SYNCHRONOUSLY before any async work begins.
      // The cleanup kicks off an async `run()` below and returns immediately.
      // Between this return and when `engine.destroy()` eventually executes,
      // the browser can fire RAF callbacks — the ticker calls `app.render()`
      // inside those callbacks, and if `brushSystem`/`layerManager` have
      // already been torn down (or are mid-teardown) that render throws
      // "Cannot read properties of null (reading 'geometry')".
      // Stopping the ticker here closes that window.  `flushSave` uses
      // `renderer.extract.base64()` directly — it does not need the ticker.
      if (engine.initialized) {
        try { engine.app.ticker.stop() } catch { /* ignore */ }
      }

      // Capture everything we need into locals NOW — the store is about
      // to be reset and engineRef.current will be nulled. These locals
      // are what the async run() below will close over.
      const savePath = pathRef.current
      const shouldFlush = !!(
        engine.initialized &&
        useCanvasStore.getState().hasUnsavedChanges
      )

      // Sequence save → destroy so extract.base64 finishes touching the
      // live renderer before app.destroy() tears it down. Previously
      // flushSave was fire-and-forget and the extracts raced with
      // destroy(), falling back to stale lastSavedBase64 — silently
      // losing the user's in-flight changes on unmount.
      const run = async () => {
        if (shouldFlush) {
          try {
            await flushSave(engine, vaultFs, savePath)
          } catch {
            // Best-effort — don't block destroy on a failed flush.
          }
        }
        engine.destroy()
      }

      const promise = run()

      // Publish this promise so the next mount of the same path can
      // await our flush before it reads the file from disk.
      pendingCanvasSaves.set(savePath, promise)
      void promise.finally(() => {
        // Only delete if our entry is still the current one — a
        // subsequent unmount on the same path may have replaced it.
        if (pendingCanvasSaves.get(savePath) === promise) {
          pendingCanvasSaves.delete(savePath)
        }
      })

      engineRef.current = null
      useCanvasStore.getState().reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- Save ---- */

  const handleSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine?.initialized) return
    try {
      await writeCanvasFile(engine, vaultFs, pathRef.current)
      useCanvasStore.getState().markSaved()
      useEditorStore.getState().updateTab(tabId, { isDirty: false })
      onPersisted?.()
    } catch (err) {
      console.error('Canvas save failed:', err)
      toast.error('Failed to save canvas')
    }
  }, [vaultFs, tabId, onPersisted])

  const isDirty = useCanvasStore((s) => s.hasUnsavedChanges)

  useAutoSave({
    intervalMs: 3_000,
    saveOnBlur: true,
    enabled: true,
    onSave: handleSave,
    isDirty,
  })

  /* ---- Keyboard shortcuts ---- */

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement | null
      // Don't capture if user is typing in an input
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') {
        return
      }

      // Tool shortcuts (no modifier)
      if (!mod && !e.shiftKey) {
        const toolMap: Record<string, CanvasTool> = {
          b: 'brush',
          e: 'eraser',
          h: 'pan',
          g: 'fill',
          i: 'eyedropper',
        }
        const tool = toolMap[e.key.toLowerCase()]
        if (tool) {
          e.preventDefault()
          useCanvasStore.getState().setActiveTool(tool)
          return
        }

        // Brush size shortcuts
        if (e.key === '[') {
          e.preventDefault()
          const s = useCanvasStore.getState()
          if (s.activeTool === 'eraser') {
            s.setEraserSize(Math.max(1, s.eraserSize - 2))
          } else {
            s.setBrushSettings({ size: Math.max(1, s.brushSettings.size - 2) })
          }
          return
        }
        if (e.key === ']') {
          e.preventDefault()
          const s = useCanvasStore.getState()
          if (s.activeTool === 'eraser') {
            s.setEraserSize(Math.min(200, s.eraserSize + 2))
          } else {
            s.setBrushSettings({ size: Math.min(200, s.brushSettings.size + 2) })
          }
          return
        }
      }

      // Ctrl+S: save
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
        return
      }

      // Ctrl+Z: undo
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const engine = engineRef.current
        if (!engine?.initialized) return
        void (async () => {
          const ok = await engine.undoManager.undo()
          if (ok) applyUndoRedoSideEffects(engine)
        })()
        return
      }

      // Ctrl+Shift+Z or Ctrl+Y: redo
      if (mod && (e.shiftKey && e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault()
        const engine = engineRef.current
        if (!engine?.initialized) return
        void (async () => {
          const ok = await engine.undoManager.redo()
          if (ok) applyUndoRedoSideEffects(engine)
        })()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  /* ---- Render ---- */

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title bar — matches docx / xlsx style */}
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <InlineFileTitle
          path={path}
          onRename={(oldPath, newStem) => onRename?.(tabId, oldPath, newStem, '.canvas')}
        />
        <span className="text-fg-muted font-mono text-xs">.canvas</span>
      </div>

      <div ref={layoutRef} className="relative flex min-h-0 flex-1">
      {!loading && <CanvasToolStrip engineRef={engineRef} />}
      <CanvasViewport engineRef={engineRef} containerRef={containerRef} />

      {!loading && (
        <>
          {/* Drag handle — only visible when panel is open */}
          {!panelCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize properties panel"
              onPointerDown={onDragPointerDown}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              onPointerCancel={onDragPointerUp}
              className="group relative z-10 w-1 shrink-0 cursor-col-resize select-none bg-border transition-colors hover:bg-accent/60"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </div>
          )}

          {panelCollapsed ? (
            /* Collapsed rail */
            <div className="border-border bg-bg flex h-full w-10 shrink-0 flex-col items-center border-l pt-2">
              <button
                type="button"
                onClick={() => { panelAutoCollapsedRef.current = false; setPanelCollapsed(false) }}
                title="Expand properties"
                aria-label="Expand properties panel"
                className="text-fg-muted hover:text-fg hover:bg-bg-hover flex size-8 items-center justify-center rounded-md transition-colors"
              >
                <PanelRightOpen className="size-4" />
              </button>
            </div>
          ) : (
            /* Expanded panel */
            <div className="shrink-0 overflow-hidden" style={{ width: `${panelWidth}px` }}>
              <CanvasPropertiesPanel
                engineRef={engineRef}
                onCollapse={() => { panelAutoCollapsedRef.current = false; setPanelCollapsed(true) }}
              />
            </div>
          )}
        </>
      )}

      {loading && (
        <div className="text-fg-muted absolute inset-0 z-10 flex items-center justify-center bg-neutral-100 text-sm dark:bg-neutral-900">
          Loading canvas…
        </div>
      )}
      </div>
    </div>
  )
}

/* ---- Helpers ---- */

function syncStoreFromEngine(engine: CanvasEngine): void {
  const store = useCanvasStore.getState()
  store.setLayers(engine.layerManager.getLayerMeta())
  store.setActiveLayerId(engine.layerManager.activeLayerId)
  store.setViewport(engine.viewportController.state)
  store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
}

/**
 * After an undo/redo, push engine state back into the React store and
 * re-render.
 *
 * Stroke undos only change pixel data so the layer list is unaffected —
 * but `remove-layer` undo actually recreates a layer, and `add-layer`
 * undo (future) will destroy one. To keep the layers panel honest we
 * always re-sync the full layer meta + active id + undo state here,
 * rather than making each undo-kind responsible for updating the UI.
 *
 * `markDirty()` is always safe — even a pure-stroke undo produces
 * different pixels on disk than whatever was last saved.
 */
function applyUndoRedoSideEffects(engine: CanvasEngine): void {
  engine.render()
  const store = useCanvasStore.getState()
  store.setLayers(engine.layerManager.getLayerMeta())
  store.setActiveLayerId(engine.layerManager.activeLayerId)
  store.markDirty()
  store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
}

async function flushSave(
  engine: CanvasEngine,
  vaultFs: import('@/lib/fs/types').FileSystemAdapter,
  path: string,
): Promise<void> {
  try {
    await writeCanvasFile(engine, vaultFs, path)
  } catch {
    // Best-effort flush on unmount
  }
}
