'use client'

import { useCallback, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { isDueToday, isOverdue } from '@/lib/tasks'
import { useTasksStore } from '@/stores/tasks'
import type { TaskItem } from '@/types/tasks'
import { cn } from '@/utils/cn'

// Priority ring colours for the checkbox border
const PRIORITY_RING: Record<number, string> = {
  1: 'border-red-500',
  2: 'border-orange-400',
  3: 'border-blue-400',
  4: 'border-border',
}

function formatDue(due: string): string {
  const d = new Date(due)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / 86_400_000)
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function TaskRow({
  item,
  depth = 0,
  onEdit,
}: {
  item: TaskItem
  depth?: number
  onEdit: (item: TaskItem) => void
}) {
  const { vaultFs } = useVaultSession()
  const toggleTask = useTasksStore((s) => s.toggleTask)
  const removeTask = useTasksStore((s) => s.removeTask)
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)

  const isDone = item.status === 'done' || item.status === 'cancelled'
  const hasChildren = item.children.length > 0
  const doneChildren = item.children.filter((c) => c.status === 'done').length

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void toggleTask(vaultFs, item.path)
    },
    [vaultFs, item.path, toggleTask],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void removeTask(vaultFs, item.path)
    },
    [vaultFs, item.path, removeTask],
  )

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onEdit(item)
    },
    [onEdit, item],
  )

  const priorityRing = PRIORITY_RING[item.priority] ?? 'border-border'

  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-2.5 border-b border-border/40 py-2.5 transition-colors last:border-b-0',
          isDone ? 'opacity-40' : 'hover:bg-bg-hover/50',
          'cursor-pointer',
        )}
        style={{ paddingLeft: `${16 + depth * 24}px`, paddingRight: 12 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onEdit(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEdit(item)
        }}
      >
        {/* Collapse chevron or spacer */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
            className="text-fg-muted hover:text-fg -mx-0.5 shrink-0 rounded p-0.5 touch-manipulation"
          >
            {collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Checkbox — priority ring colour */}
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors touch-manipulation',
            isDone
              ? 'border-fg-muted/40 bg-fg-muted/20'
              : cn(priorityRing, 'hover:bg-accent/10'),
          )}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        >
          {isDone && <Check className="text-fg-muted/60 size-3" strokeWidth={3} />}
        </button>

        {/* Title */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm leading-snug',
            isDone ? 'text-fg-muted line-through' : 'text-fg',
          )}
        >
          {item.title || 'Untitled'}
        </span>

        {/* Right-side metadata */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Subtask count */}
          {hasChildren && (
            <span className="text-fg-muted/60 text-[10px] tabular-nums">
              {doneChildren}/{item.children.length}
            </span>
          )}

          {/* Tags — hide on very small screens */}
          {item.tags.length > 0 && !isDone && (
            <div className="hidden gap-1 xs:flex">
              {item.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="bg-accent/10 text-accent rounded-full px-1.5 py-0.5 text-[10px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Due badge */}
          {item.due && !isDone && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                isOverdue(item)
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : isDueToday(item)
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-bg-tertiary text-fg-muted',
              )}
            >
              {formatDue(item.due)}
            </span>
          )}

          {/* Hover actions */}
          <div
            className={cn(
              'flex gap-0.5 transition-opacity',
              hovered ? 'opacity-100' : 'opacity-0',
            )}
          >
            <button
              type="button"
              onClick={handleEdit}
              className="text-fg-muted/60 hover:text-fg rounded-md p-1 transition-colors touch-manipulation"
              aria-label="Edit task"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="text-fg-muted/60 hover:text-destructive rounded-md p-1 transition-colors touch-manipulation"
              aria-label="Delete task"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren &&
        !collapsed &&
        item.children.map((child) => (
          <TaskRow key={child.path} item={child} depth={depth + 1} onEdit={onEdit} />
        ))}
    </>
  )
}
