'use client'

import {
  Paintbrush,
  Eraser,
  Hand,
  Pipette,
  PaintBucket,
  Undo2,
  Redo,
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvas'
import type { CanvasTool } from '@/types/canvas'
import type { CanvasEngine } from '@/lib/canvas/engine'
import { cn } from '@/utils/cn'

interface CanvasToolStripProps {
  engineRef: React.RefObject<CanvasEngine | null>
}

const TOOLS: { id: CanvasTool; icon: typeof Paintbrush; label: string; shortcut: string }[] = [
  { id: 'brush', icon: Paintbrush, label: 'Brush', shortcut: 'B' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
  { id: 'pan', icon: Hand, label: 'Pan', shortcut: 'H' },
  { id: 'fill', icon: PaintBucket, label: 'Fill', shortcut: 'G' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' },
]

export function CanvasToolStrip({ engineRef }: CanvasToolStripProps) {
  const activeTool = useCanvasStore((s) => s.activeTool)
  const setActiveTool = useCanvasStore((s) => s.setActiveTool)
  const canUndo = useCanvasStore((s) => s.canUndo)
  const canRedo = useCanvasStore((s) => s.canRedo)

  async function handleUndo() {
    const engine = engineRef.current
    if (!engine?.initialized) return
    const ok = await engine.undoManager.undo()
    if (ok) {
      engine.render()
      const store = useCanvasStore.getState()
      store.markDirty()
      store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
    }
  }

  async function handleRedo() {
    const engine = engineRef.current
    if (!engine?.initialized) return
    const ok = await engine.undoManager.redo()
    if (ok) {
      engine.render()
      const store = useCanvasStore.getState()
      store.markDirty()
      store.setUndoState(engine.undoManager.canUndo, engine.undoManager.canRedo)
    }
  }

  return (
    <div className="border-border bg-bg flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
      {TOOLS.map(({ id, icon: Icon, label, shortcut }) => (
        <button
          key={id}
          type="button"
          title={`${label} (${shortcut})`}
          onClick={() => setActiveTool(id)}
          className={cn(
            'flex size-9 items-center justify-center rounded-lg transition-colors',
            activeTool === id
              ? 'bg-accent text-accent-fg'
              : 'text-fg-secondary hover:bg-bg-hover hover:text-fg',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}

      <div className="bg-border mx-2 my-1 h-px w-6" />

      <button
        type="button"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => void handleUndo()}
        className="text-fg-secondary hover:text-fg flex size-9 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => void handleRedo()}
        className="text-fg-secondary hover:text-fg flex size-9 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
      >
        <Redo className="size-4" />
      </button>
    </div>
  )
}
