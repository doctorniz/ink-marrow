'use client'

import { useCallback, useRef, useState } from 'react'
import { GripHorizontal, Plus, Trash2 } from 'lucide-react'
import type { KanbanColumn as KanbanColumnType, KanbanColumnColor } from '@/types/kanban'
import {
  KanbanCardItem,
  readKanbanCardDragData,
  kanbanCardDragActive,
} from '@/components/kanban/kanban-card'
import { cn } from '@/utils/cn'

export const COLUMN_DRAG_MIME = 'application/x-ink-kanban-column'
const COLUMN_PREFIX = 'ink-kanban-column:'

function setColumnDragData(e: React.DragEvent, fromIndex: number) {
  const payload = JSON.stringify({ fromIndex })
  e.dataTransfer.setData(COLUMN_DRAG_MIME, payload)
  e.dataTransfer.setData('text/plain', `${COLUMN_PREFIX}${payload}`)
  e.dataTransfer.effectAllowed = 'move'
}

function readColumnDragData(e: React.DragEvent): { fromIndex: number } | null {
  let raw = ''
  try {
    raw = e.dataTransfer.getData(COLUMN_DRAG_MIME)
  } catch { /* ignore */ }
  if (!raw) {
    const plain = e.dataTransfer.getData('text/plain')
    if (plain.startsWith(COLUMN_PREFIX)) raw = plain.slice(COLUMN_PREFIX.length)
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { fromIndex: number }
    if (typeof parsed.fromIndex === 'number') return parsed
  } catch { /* ignore */ }
  return null
}

function columnDragActive(types: readonly string[]): boolean {
  return Array.from(types).includes(COLUMN_DRAG_MIME)
}

const COLUMN_SHELL: Record<KanbanColumnColor, string> = {
  slate:
    'bg-slate-100/90 border-slate-200 dark:bg-slate-900/35 dark:border-slate-700',
  amber:
    'bg-amber-50/95 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800',
  sky: 'bg-sky-50/95 border-sky-200 dark:bg-sky-950/35 dark:border-sky-800',
  emerald:
    'bg-emerald-50/95 border-emerald-200 dark:bg-emerald-950/35 dark:border-emerald-800',
  violet:
    'bg-violet-50/95 border-violet-200 dark:bg-violet-950/35 dark:border-violet-800',
  rose: 'bg-rose-50/95 border-rose-200 dark:bg-rose-950/35 dark:border-rose-800',
  zinc: 'bg-zinc-100/90 border-zinc-200 dark:bg-zinc-900/40 dark:border-zinc-700',
}

const SWATCH: Record<KanbanColumnColor, string> = {
  slate: 'bg-slate-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
  zinc: 'bg-zinc-500',
}

const COLOR_OPTIONS: KanbanColumnColor[] = [
  'slate',
  'amber',
  'sky',
  'emerald',
  'violet',
  'rose',
  'zinc',
]

export function KanbanColumn({
  column,
  columnIndex,
  onAddCard,
  onToggleCard,
  onDeleteCard,
  onRenameCard,
  onMoveCard,
  onRenameColumn,
  onDeleteColumn,
  onSetColumnColor,
  onDropColumn,
}: {
  column: KanbanColumnType
  columnIndex: number
  onAddCard: (columnId: string, title: string) => void
  onToggleCard: (cardId: string) => void
  onDeleteCard: (cardId: string) => void
  onRenameCard: (cardId: string, title: string) => void
  onMoveCard: (cardId: string, fromColumnId: string, toColumnId: string, insertIndex: number) => void
  onRenameColumn: (columnId: string, heading: string) => void
  onDeleteColumn: (columnId: string) => void
  onSetColumnColor: (columnId: string, color: KanbanColumnColor | undefined) => void
  onDropColumn: (fromIndex: number, toIndex: number) => void
}) {
  const [addText, setAddText] = useState('')
  const [dropCardOver, setDropCardOver] = useState(false)
  const [dropColOver, setDropColOver] = useState(false)
  const [editingHeading, setEditingHeading] = useState(false)
  const [headingDraft, setHeadingDraft] = useState(column.heading)
  const headingRef = useRef<HTMLInputElement>(null)

  const shell =
    column.color && COLUMN_SHELL[column.color]
      ? COLUMN_SHELL[column.color]
      : 'bg-bg-secondary border-border'

  const handleAddCard = useCallback(() => {
    const trimmed = addText.trim()
    if (!trimmed) return
    onAddCard(column.id, trimmed)
    setAddText('')
  }, [addText, column.id, onAddCard])

  const handleCardDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropCardOver(false)
      const parsed = readKanbanCardDragData(e)
      if (!parsed) return
      onMoveCard(parsed.cardId, parsed.fromColumn, column.id, column.cards.length)
    },
    [column.id, column.cards.length, onMoveCard],
  )

  const handleColumnHeaderDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropColOver(false)
      const col = readColumnDragData(e)
      if (col) {
        onDropColumn(col.fromIndex, columnIndex)
        return
      }
      const card = readKanbanCardDragData(e)
      if (card) {
        onMoveCard(card.cardId, card.fromColumn, column.id, 0)
      }
    },
    [column.id, columnIndex, onDropColumn, onMoveCard],
  )

  const commitHeading = useCallback(() => {
    const trimmed = headingDraft.trim()
    if (trimmed && trimmed !== column.heading) {
      onRenameColumn(column.id, trimmed)
    } else {
      setHeadingDraft(column.heading)
    }
    setEditingHeading(false)
  }, [headingDraft, column.id, column.heading, onRenameColumn])

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-56 shrink-0 flex-col rounded-xl border',
        shell,
        dropCardOver && 'ring-accent/50 ring-2',
        dropColOver && 'ring-2 ring-violet-400/60 dark:ring-violet-500/50',
      )}
    >
      {/* Column header — column drag + optional card drop at top */}
      <div
        className="flex flex-col gap-1.5 px-2.5 pt-2.5 pb-1"
        onDragOver={(e) => {
          if (columnDragActive(e.dataTransfer.types)) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            setDropColOver(true)
          } else if (kanbanCardDragActive(e.dataTransfer.types)) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropColOver(false)
          }
        }}
        onDrop={handleColumnHeaderDrop}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              setColumnDragData(e, columnIndex)
            }}
            className="text-fg-muted/50 hover:text-fg-muted shrink-0 cursor-grab rounded p-0.5 active:cursor-grabbing"
            aria-label="Drag to reorder column"
            title="Drag to reorder"
          >
            <GripHorizontal className="size-4" />
          </button>

          {editingHeading ? (
            <input
              ref={headingRef}
              type="text"
              value={headingDraft}
              onChange={(e) => setHeadingDraft(e.target.value)}
              onBlur={commitHeading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitHeading() }
                if (e.key === 'Escape') { setHeadingDraft(column.heading); setEditingHeading(false) }
              }}
              autoFocus
              className="text-fg min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
            />
          ) : (
            <h3
              className="text-fg min-w-0 flex-1 cursor-text truncate text-sm font-semibold"
              onClick={() => { setHeadingDraft(column.heading); setEditingHeading(true) }}
            >
              {column.heading}
            </h3>
          )}

          <span className="text-fg-muted shrink-0 text-xs tabular-nums">
            {column.cards.length}
          </span>

          <button
            type="button"
            onClick={() => onDeleteColumn(column.id)}
            className="text-fg-muted/40 hover:text-destructive shrink-0 rounded p-0.5 transition-colors"
            aria-label={`Delete ${column.heading} column`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Column color">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onSetColumnColor(column.id, column.color === c ? undefined : c)}
              className={cn(
                'size-4 rounded-full border-2 transition-transform',
                SWATCH[c],
                column.color === c ? 'border-fg scale-110' : 'border-transparent hover:scale-105',
              )}
            />
          ))}
        </div>
      </div>

      {/* Cards */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2"
        onDragOver={(e) => {
          if (!kanbanCardDragActive(e.dataTransfer.types)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropCardOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropCardOver(false)
          }
        }}
        onDrop={handleCardDrop}
      >
        {column.cards.map((card) => (
          <KanbanCardItem
            key={card.id}
            card={card}
            columnId={column.id}
            onToggle={onToggleCard}
            onDelete={onDeleteCard}
            onRename={onRenameCard}
          />
        ))}

        {column.cards.length === 0 && !dropCardOver && (
          <div className="text-fg-muted/30 py-6 text-center text-xs">
            Drop cards here
          </div>
        )}
      </div>

      {/* Add card */}
      <div className="border-border/60 border-t px-2 py-2">
        <div className="flex items-center gap-1.5">
          <Plus className="text-fg-muted size-3.5 shrink-0" />
          <input
            type="text"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAddCard() }
            }}
            placeholder="Add card..."
            className="text-fg placeholder:text-fg-muted/40 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>
    </div>
  )
}
