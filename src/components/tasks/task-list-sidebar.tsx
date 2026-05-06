'use client'

import { useCallback, useRef, useState } from 'react'
import { CalendarClock, Inbox, Plus, Sun, Trash2 } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { isDueToday, isDueThisWeek } from '@/lib/tasks'
import { useTasksStore, type TaskFilter } from '@/stores/tasks'
import { cn } from '@/utils/cn'

// Rotating palette for list color dots
const LIST_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-pink-500',
  'bg-rose-500',
]

function listColor(index: number) {
  return LIST_COLORS[index % LIST_COLORS.length]
}

export function TaskListSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { vaultFs } = useVaultSession()
  const items = useTasksStore((s) => s.items)
  const lists = useTasksStore((s) => s.lists)
  const activeList = useTasksStore((s) => s.activeList)
  const activeFilter = useTasksStore((s) => s.activeFilter)
  const setActiveList = useTasksStore((s) => s.setActiveList)
  const setActiveFilter = useTasksStore((s) => s.setActiveFilter)
  const createList = useTasksStore((s) => s.createList)
  const removeList = useTasksStore((s) => s.removeList)

  const [addingList, setAddingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const active = items.filter((i) => i.status !== 'done' && i.status !== 'cancelled')
  const topLevel = active.filter((i) => !i.parent)
  const inboxCount = topLevel.filter((i) => i.list === null).length
  const todayCount = active.filter((i) => isDueToday(i)).length
  const upcomingCount = active.filter((i) => isDueThisWeek(i)).length

  const listCounts: Record<string, number> = {}
  for (const l of lists) listCounts[l] = 0
  for (const i of topLevel) {
    if (i.list && listCounts[i.list] !== undefined) listCounts[i.list]++
  }

  const isSmartActive = (filter: TaskFilter) =>
    activeFilter === filter && activeList === null

  const isListActive = (name: string) =>
    activeList === name && activeFilter === 'all'

  const handleSmartClick = useCallback(
    (filter: TaskFilter) => {
      setActiveList(null)
      setActiveFilter(filter)
      onNavigate?.()
    },
    [setActiveList, setActiveFilter, onNavigate],
  )

  const handleListClick = useCallback(
    (name: string) => {
      setActiveList(name)
      setActiveFilter('all')
      onNavigate?.()
    },
    [setActiveList, setActiveFilter, onNavigate],
  )

  const handleAddList = useCallback(async () => {
    const name = newListName.trim()
    if (!name) {
      setAddingList(false)
      return
    }
    await createList(vaultFs, name)
    setNewListName('')
    setAddingList(false)
    handleListClick(name)
  }, [newListName, vaultFs, createList, handleListClick])

  const smartFilters: {
    filter: TaskFilter
    label: string
    icon: typeof Inbox
    count: number
    iconClass: string
  }[] = [
    {
      filter: 'all',
      label: 'Inbox',
      icon: Inbox,
      count: inboxCount,
      iconClass: 'text-fg-secondary',
    },
    {
      filter: 'today',
      label: 'Today',
      icon: Sun,
      count: todayCount,
      iconClass: 'text-emerald-500',
    },
    {
      filter: 'upcoming',
      label: 'Upcoming',
      icon: CalendarClock,
      count: upcomingCount,
      iconClass: 'text-sky-500',
    },
  ]

  return (
    <div className="border-border bg-bg flex h-full w-[220px] shrink-0 flex-col border-r">
      {/* Smart filters */}
      <div className="flex flex-col gap-0.5 p-2 pt-3">
        {smartFilters.map(({ filter, label, icon: Icon, count, iconClass }) => (
          <button
            key={filter}
            type="button"
            onClick={() => handleSmartClick(filter)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
              isSmartActive(filter)
                ? 'bg-accent/10 text-accent'
                : 'text-fg-secondary hover:bg-bg-hover hover:text-fg',
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0',
                isSmartActive(filter) ? 'text-accent' : iconClass,
              )}
            />
            <span className="flex-1 truncate">{label}</span>
            {count > 0 && (
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  isSmartActive(filter) ? 'text-accent/70' : 'text-fg-muted',
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lists section */}
      <div className="mx-3 mt-2 border-t border-border/60" />

      <div className="px-3 pb-1 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-muted/60">
          My Lists
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {lists.map((name, index) => (
          <div
            key={name}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isListActive(name)
                ? 'bg-accent/10 text-accent'
                : 'text-fg-secondary hover:bg-bg-hover hover:text-fg',
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              onClick={() => handleListClick(name)}
            >
              {/* Colored dot */}
              <span
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  isListActive(name) ? 'bg-accent' : listColor(index),
                )}
              />
              <span className="flex-1 truncate">{name}</span>
              {(listCounts[name] ?? 0) > 0 && (
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    isListActive(name) ? 'text-accent/70' : 'text-fg-muted',
                  )}
                >
                  {listCounts[name]}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void removeList(vaultFs, name)
              }}
              className="text-fg-muted/0 group-hover:text-fg-muted hover:!text-danger shrink-0 rounded p-0.5 transition-colors"
              aria-label={`Delete ${name} list`}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}

        {addingList ? (
          <input
            ref={inputRef}
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onBlur={() => void handleAddList()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddList()
              if (e.key === 'Escape') {
                setAddingList(false)
                setNewListName('')
              }
            }}
            autoFocus
            placeholder="List name"
            className="border-border bg-bg-secondary text-fg placeholder:text-fg-muted/40 mx-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent/40"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingList(true)}
            className="text-fg-muted hover:text-fg hover:bg-bg-hover flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors"
          >
            <Plus className="size-3.5 shrink-0" />
            <span>Add list</span>
          </button>
        )}
      </div>
    </div>
  )
}
