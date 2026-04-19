'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVaultSession } from '@/contexts/vault-fs-context'
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

export function CanvasEditor({ tabId, path, onPersisted }: CanvasEditorProps) {
  const { vaultFs } = useVaultSession()
  const engineRef = useRef<CanvasEngine | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  const [loading, setLoading] = useState(true)

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

        // Load file. v4 format reads metadata JSON plus sidecar PNGs
        // under `<path>.assets/<layerId>.png`; v3 files with inline
        // base64 pixels are still honoured by the deserializer and get
        // rewritten as v4 on the next save.
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
    <div className="relative flex h-full min-h-0">
      {!loading && <CanvasToolStrip engineRef={engineRef} />}
      <CanvasViewport engineRef={engineRef} containerRef={containerRef} />
      {!loading && <CanvasPropertiesPanel engineRef={engineRef} />}

      {loading && (
        <div className="text-fg-muted absolute inset-0 z-10 flex items-center justify-center bg-neutral-100 text-sm dark:bg-neutral-900">
          Loading canvas…
        </div>
      )}
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
