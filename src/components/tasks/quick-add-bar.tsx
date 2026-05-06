'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { parseQuickAdd } from '@/lib/tasks/parse-quick-add'
import { useTasksStore } from '@/stores/tasks'
import { PRIORITY_LABELS, WEEKDAY_LABEL } from '@/types/tasks'
import { cn } from '@/utils/cn'

export function QuickAddBar() {
  const { vaultFs } = useVaultSession()
  const addTask = useTasksStore((s) => s.addTask)
  const activeList = useTasksStore((s) => s.activeList)
  const activeFilter = useTasksStore((s) => s.activeFilter)
  const [value, setValue] = useState('')

  const parsed = useMemo(() => {
    if (!value.trim()) return null
    return parseQuickAdd(value)
  }, [value])

  const handleSubmit = useCallback(async () => {
    if (!value.trim()) return
    const result = parseQuickAdd(value)
    if (!result.title) return

    const list = activeFilter === 'all' ? activeList : null

    await addTask(vaultFs, result.title, {
      list: list ?? undefined,
      priority: result.priority,
      due: result.due,
      tags: result.tags,
      repeat: result.repeat,
      repeatWeekday: result.repeatWeekday,
    })
    setValue('')
  }, [value, vaultFs, addTask, activeList, activeFilter])

  const hasParsedTokens =
    parsed &&
    (parsed.priority ||
      parsed.tags.length ||
      parsed.due ||
      (parsed.repeat === 'weekly' && parsed.repeatWeekday != null))

  return (
    <div className="border-border border-b px-3 py-2.5 sm:px-4">
      <div className="flex items-center gap-2.5">
        <Plus className="text-fg-muted/50 size-4 shrink-0" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSubmit()
            }
          }}
          placeholder="Add a task..."
          className="text-fg placeholder:text-fg-muted/40 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      {hasParsedTokens && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-3.5 sm:pl-6">
          {parsed.priority && (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                parsed.priority === 1 && 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
                parsed.priority === 2 && 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
                parsed.priority === 3 && 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
                parsed.priority === 4 && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {PRIORITY_LABELS[parsed.priority]}
            </span>
          )}
          {parsed.tags.map((tag) => (
            <span
              key={tag}
              className="bg-accent/10 text-accent rounded-full px-1.5 py-0.5 text-[10px]"
            >
              #{tag}
            </span>
          ))}
          {parsed.due && (
            <span className="bg-bg-tertiary text-fg-muted rounded-md px-1.5 py-0.5 text-[10px]">
              {parsed.due}
            </span>
          )}
          {parsed.repeat === 'weekly' && parsed.repeatWeekday != null && (
            <span className="bg-accent/15 text-accent rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              Weekly &middot; {WEEKDAY_LABEL[parsed.repeatWeekday]}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
