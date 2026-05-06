'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { parseKanban, serializeKanban } from '@/lib/kanban'
import type { KanbanBoard, KanbanCard, KanbanColumnColor } from '@/types/kanban'
import { useEditorStore } from '@/stores/editor'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { KanbanColumn } from '@/components/kanban/kanban-column'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'
import { toast } from '@/stores/toast'

const SAVE_DEBOUNCE = 750

export function KanbanEditor({
  tabId,
  path,
  isNew,
  onRenamed,
  onPersisted,
}: {
  tabId: string
  path: string
  isNew?: boolean
  onRenamed: () => void
  onPersisted: () => void
}) {
  const { vaultFs } = useVaultSession()
  const updateTab = useEditorStore((s) => s.updateTab)
  const retargetTabPath = useEditorStore((s) => s.retargetTabPath)

  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const frontmatterRef = useRef<Record<string, unknown>>({})
  const pathRef = useRef(path)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boardRef = useRef<KanbanBoard | null>(null)

  pathRef.current = path
  boardRef.current = board

  // Load file
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const raw = await vaultFs.readTextFile(path)
        if (cancelled) return
        const { board: parsed, frontmatter } = parseKanban(raw)
        frontmatterRef.current = frontmatter
        setBoard(parsed)
      } catch (e) {
        console.error('Failed to load kanban', e)
        toast.error('Failed to load kanban board')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [vaultFs, path])

  // Auto-save
  const save = useCallback(async () => {
    const b = boardRef.current
    if (!b) return
    try {
      const raw = serializeKanban(b, frontmatterRef.current)
      await vaultFs.writeTextFile(pathRef.current, raw)
      await reindexMarkdownPath(vaultFs, pathRef.current)
      updateTab(tabId, { isDirty: false })
      onPersisted()
    } catch (e) {
      console.error('Failed to save kanban', e)
    }
  }, [vaultFs, tabId, updateTab, onPersisted])

  const scheduleSave = useCallback(() => {
    updateTab(tabId, { isDirty: true })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE)
  }, [tabId, updateTab, save])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        void save()
      }
    }
  }, [save])

  // Board mutation helpers
  const mutate = useCallback(
    (fn: (b: KanbanBoard) => KanbanBoard) => {
      setBoard((prev) => {
        if (!prev) return prev
        const next = fn(prev)
        boardRef.current = next
        return next
      })
      scheduleSave()
    },
    [scheduleSave],
  )

  const handleAddCard = useCallback(
    (columnId: string, title: string) => {
      mutate((b) => ({
        columns: b.columns.map((col) =>
          col.id === columnId
            ? { ...col, cards: [...col.cards, { id: crypto.randomUUID(), title, checked: false }] }
            : col,
        ),
      }))
    },
    [mutate],
  )

  const handleToggleCard = useCallback(
    (cardId: string) => {
      mutate((b) => ({
        columns: b.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === cardId ? { ...c, checked: !c.checked } : c)),
        })),
      }))
    },
    [mutate],
  )

  const handleDeleteCard = useCallback(
    (cardId: string) => {
      mutate((b) => ({
        columns: b.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== cardId),
        })),
      }))
    },
    [mutate],
  )

  const handleRenameCard = useCallback(
    (cardId: string, title: string) => {
      mutate((b) => ({
        columns: b.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === cardId ? { ...c, title } : c)),
        })),
      }))
    },
    [mutate],
  )

  const handleMoveCard = useCallback(
    (cardId: string, fromColumnId: string, toColumnId: string, insertIndex: number) => {
      mutate((b) => {
        let movedCard: KanbanCard | undefined
        const columns = b.columns.map((col) => {
          if (col.id === fromColumnId) {
            const idx = col.cards.findIndex((c) => c.id === cardId)
            if (idx !== -1) {
              movedCard = col.cards[idx]
              return { ...col, cards: col.cards.filter((c) => c.id !== cardId) }
            }
          }
          return col
        })

        if (!movedCard) return b

        return {
          columns: columns.map((col) => {
            if (col.id === toColumnId) {
              const cards = [...col.cards]
              cards.splice(insertIndex, 0, movedCard!)
              return { ...col, cards }
            }
            return col
          }),
        }
      })
    },
    [mutate],
  )

  const handleRenameColumn = useCallback(
    (columnId: string, heading: string) => {
      mutate((b) => ({
        columns: b.columns.map((col) => (col.id === columnId ? { ...col, heading } : col)),
      }))
    },
    [mutate],
  )

  const handleDeleteColumn = useCallback(
    (columnId: string) => {
      mutate((b) => ({
        columns: b.columns.filter((col) => col.id !== columnId),
      }))
    },
    [mutate],
  )

  const handleAddColumn = useCallback(() => {
    mutate((b) => ({
      columns: [
        ...b.columns,
        {
          id: crypto.randomUUID(),
          heading: 'New Column',
          color: 'zinc' as KanbanColumnColor,
          cards: [],
        },
      ],
    }))
  }, [mutate])

  const handleSetColumnColor = useCallback(
    (columnId: string, color: KanbanColumnColor | undefined) => {
      mutate((b) => ({
        columns: b.columns.map((col) =>
          col.id === columnId ? { ...col, color } : col,
        ),
      }))
    },
    [mutate],
  )

  const handleDropColumn = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      mutate((b) => {
        const cols = [...b.columns]
        cols.splice(toIndex, 0, cols.splice(fromIndex, 1)[0])
        return { columns: cols }
      })
    },
    [mutate],
  )

  const handleRenameFile = useCallback(
    async (oldPath: string, newStem: string) => {
      const ext = oldPath.match(/\.[^/.]+$/)?.[0] ?? '.md'
      const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
      const newPath = dir ? `${dir}/${newStem}${ext}` : `${newStem}${ext}`
      if (newPath === oldPath) return

      try {
        await vaultFs.rename(oldPath, newPath)
        if (newPath.endsWith('.md')) await reindexMarkdownPath(vaultFs, newPath)
        retargetTabPath(tabId, newPath, newStem)
        pathRef.current = newPath
        onRenamed()
      } catch {
        toast.error('Failed to rename')
      }
    },
    [vaultFs, tabId, retargetTabPath, onRenamed],
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-fg-muted size-6 animate-spin" />
      </div>
    )
  }

  if (!board) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">
        Failed to load board
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title bar */}
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <InlineFileTitle
          path={path}
          autoFocus={isNew}
          onRename={handleRenameFile}
        />
      </div>

      {/* Board */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
        {board.columns.map((col, columnIndex) => (
          <KanbanColumn
            key={col.id}
            column={col}
            columnIndex={columnIndex}
            onAddCard={handleAddCard}
            onToggleCard={handleToggleCard}
            onDeleteCard={handleDeleteCard}
            onRenameCard={handleRenameCard}
            onMoveCard={handleMoveCard}
            onRenameColumn={handleRenameColumn}
            onDeleteColumn={handleDeleteColumn}
            onSetColumnColor={handleSetColumnColor}
            onDropColumn={handleDropColumn}
          />
        ))}

        {/* Add column */}
        <button
          type="button"
          onClick={handleAddColumn}
          className="border-border text-fg-muted hover:text-fg hover:bg-bg-hover flex h-12 w-56 shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors"
        >
          <Plus className="size-4" />
          <span className="text-sm font-medium">Add column</span>
        </button>
      </div>
    </div>
  )
}
