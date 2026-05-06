'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useTasksStore } from '@/stores/tasks'
import type { TaskItem, TaskPriority } from '@/types/tasks'
import { PRIORITY_LABELS, PRIORITY_BG, WEEKDAY_LABEL } from '@/types/tasks'
import { cn } from '@/utils/cn'

const PRIORITIES: TaskPriority[] = [1, 2, 3, 4]

export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: TaskItem | null
}) {
  const { vaultFs } = useVaultSession()
  const updateTask = useTasksStore((s) => s.updateTask)
  const removeTask = useTasksStore((s) => s.removeTask)
  const addTask = useTasksStore((s) => s.addTask)
  const toggleTask = useTasksStore((s) => s.toggleTask)
  const lists = useTasksStore((s) => s.lists)
  const items = useTasksStore((s) => s.items)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<TaskPriority>(3)
  const [due, setDue] = useState('')
  const [list, setList] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')

  const children = task
    ? items
        .filter((i) => i.parent === task.uid)
        .slice()
        .sort((a, b) => {
          const aDone = a.status === 'done' || a.status === 'cancelled' ? 1 : 0
          const bDone = b.status === 'done' || b.status === 'cancelled' ? 1 : 0
          if (aDone !== bDone) return aDone - bDone
          if (a.order !== b.order) return a.order - b.order
          return new Date(b.modified).getTime() - new Date(a.modified).getTime()
        })
    : []

  useEffect(() => {
    if (!open || !task) return
    setTitle(task.title)
    const bodyWithoutH1 = task.body.replace(/^\n*#\s+[^\n]*\n?/, '').trim()
    setBody(bodyWithoutH1)
    setPriority(task.priority)
    setDue(task.due ?? '')
    setList(task.list ?? '')
    setTags(task.tags.join(', '))
    setSubtaskTitle('')
  }, [open, task])

  const handleSave = useCallback(async () => {
    if (!task) return
    setSaving(true)

    const tagList = tags
      .split(/[,\s]+/)
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean)

    const fullBody = title
      ? `\n# ${title}\n${body ? `\n${body}` : ''}\n`
      : body ? `\n${body}\n` : '\n'

    await updateTask(vaultFs, task.path, {
      priority,
      due: due || '',
      tags: tagList,
      body: fullBody,
    })

    const newList = list || null
    if (newList !== task.list) {
      const moveToList = useTasksStore.getState().moveToList
      await moveToList(vaultFs, task.path, newList)
    }

    setSaving(false)
    onOpenChange(false)
  }, [task, title, body, priority, due, list, tags, vaultFs, updateTask, onOpenChange])

  const handleDelete = useCallback(async () => {
    if (!task) return
    await removeTask(vaultFs, task.path)
    onOpenChange(false)
  }, [task, vaultFs, removeTask, onOpenChange])

  const handleAddSubtask = useCallback(async () => {
    if (!task || !subtaskTitle.trim()) return
    await addTask(vaultFs, subtaskTitle.trim(), {
      parent: task.uid,
      list: task.list ?? undefined,
    })
    setSubtaskTitle('')
  }, [task, subtaskTitle, vaultFs, addTask])

  if (!task) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="bg-bg border-border fixed top-1/2 left-1/2 z-50 flex max-h-[min(90dvh,44rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border shadow-xl"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleSave()
            }
          }}
        >
          {/* Header */}
          <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-fg text-sm font-semibold">Edit Task</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="text-fg-muted hover:text-fg rounded-md p-1">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="text-fg placeholder:text-fg-muted/40 w-full bg-transparent text-lg font-semibold outline-none"
            />

            {/* Notes */}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Notes..."
              rows={3}
              className="border-border bg-bg-secondary text-fg placeholder:text-fg-muted/40 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/40"
            />

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* Priority */}
              <div className="min-w-0">
                <label className="text-fg-secondary mb-1 block text-xs font-medium">Priority</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        priority === p
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-fg-secondary hover:border-border-strong',
                      )}
                    >
                      <span className={cn('size-2 rounded-full', PRIORITY_BG[p])} />
                      {p === 3 ? '' : PRIORITY_LABELS[p]}
                      {p === 3 && 'Normal'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due date */}
              <div className="min-w-0">
                <label className="text-fg-secondary mb-1 block text-xs font-medium">Due date</label>
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="border-border bg-bg-secondary text-fg min-w-0 w-full max-w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent/40"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* List */}
              <div className="min-w-0">
                <label className="text-fg-secondary mb-1 block text-xs font-medium">List</label>
                <select
                  value={list}
                  onChange={(e) => setList(e.target.value)}
                  className="border-border bg-bg-secondary text-fg min-w-0 w-full max-w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/40"
                >
                  <option value="">Inbox</option>
                  {lists.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div className="min-w-0">
                <label className="text-fg-secondary mb-1 block text-xs font-medium">Tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="work, urgent"
                  className="border-border bg-bg-secondary text-fg placeholder:text-fg-muted/40 min-w-0 w-full max-w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/40"
                />
              </div>
            </div>

            {task.repeat === 'weekly' && task.repeatWeekday != null && (
              <p className="text-fg-secondary text-xs leading-relaxed">
                Repeats weekly on {WEEKDAY_LABEL[task.repeatWeekday]}. Checking it off moves the due date
                to the next occurrence; the task stays open.
              </p>
            )}

            {/* Subtasks */}
            {!task.parent && (
              <div>
                <label className="text-fg-secondary mb-1.5 block text-xs font-medium">
                  Subtasks {children.length > 0 && `(${children.filter((c) => c.status === 'done').length}/${children.length})`}
                </label>

                <div className="flex flex-col gap-1">
                  {children.map((child) => (
                    <div key={child.path} className="flex items-center gap-2 px-1">
                      <button
                        type="button"
                        onClick={() => void toggleTask(vaultFs, child.path)}
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                          child.status === 'done'
                            ? 'border-accent bg-accent'
                            : 'border-border hover:border-accent',
                        )}
                      >
                        {child.status === 'done' && (
                          <svg viewBox="0 0 12 12" className="text-accent-fg size-2.5">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span className={cn('min-w-0 flex-1 truncate text-sm', child.status === 'done' && 'text-fg-muted line-through')}>
                        {child.title || 'Untitled'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeTask(vaultFs, child.path)}
                        className="text-fg-muted/30 hover:text-danger rounded p-0.5"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <Plus className="text-fg-muted size-3.5 shrink-0" />
                  <input
                    type="text"
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleAddSubtask() }
                    }}
                    placeholder="Add subtask"
                    className="text-fg placeholder:text-fg-muted/40 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-border flex shrink-0 items-center justify-between border-t px-5 py-3">
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="text-danger border-danger/30 hover:bg-danger/10 focus-visible:ring-danger/35 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Trash2 className="size-3.5 shrink-0" />
              Delete
            </button>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
