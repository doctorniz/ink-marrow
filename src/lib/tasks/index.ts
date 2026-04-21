import matter from 'gray-matter'
import type { TaskItem, TaskFrontmatter, TaskPriority, TaskStatus } from '@/types/tasks'
import { getEffectiveDueDate, parseLocalDate, startOfLocalDay } from '@/lib/tasks/recurrence'

export const TASKS_DIR = '_marrow/_tasks'

const H1_RE = /^#\s+(.+)$/m

export function parseTaskItem(path: string, raw: string): TaskItem {
  const { data, content } = matter(raw)
  const fm = data as Partial<TaskFrontmatter>
  const h1 = H1_RE.exec(content)

  const rawTags = fm.tags as unknown
  const tags = Array.isArray(rawTags)
    ? (rawTags as unknown[]).map(String)
    : typeof rawTags === 'string'
      ? (rawTags as string).split(/[,\s]+/).filter(Boolean)
      : []

  const repeatFm = (fm.repeat as string) === 'weekly' ? ('weekly' as const) : null
  const rw = fm.repeatWeekday
  const repeatWeekday =
    typeof rw === 'number' && rw >= 0 && rw <= 6
      ? rw
      : typeof rw === 'string' && /^[0-6]$/.test(rw)
        ? Number(rw)
        : null

  return {
    path,
    uid: (fm.uid as string) ?? '',
    title: h1 ? h1[1].trim() : '',
    body: content,
    status: (fm.status as TaskStatus) ?? 'todo',
    priority: (fm.priority as TaskPriority) ?? 3,
    due: fm.due || null,
    created: (fm.created as string) ?? new Date().toISOString(),
    modified: (fm.modified as string) ?? new Date().toISOString(),
    completed: fm.completed || null,
    tags,
    list: listFromPath(path),
    parent: fm.parent || null,
    order: (fm.order as number) ?? 0,
    repeat: repeatFm && repeatWeekday != null ? repeatFm : null,
    repeatWeekday: repeatFm && repeatWeekday != null ? repeatWeekday : null,
    children: [],
  }
}

/** js-yaml rejects `undefined`; strip before stringify */
function yamlSafeFrontmatter(fm: TaskFrontmatter): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fm as Record<string, unknown>).filter(([, v]) => v !== undefined),
  )
}

export function serializeTask(fm: TaskFrontmatter, body: string): string {
  const updated: TaskFrontmatter = { ...fm, modified: new Date().toISOString() }
  return matter.stringify(body, yamlSafeFrontmatter(updated))
}

export function generateTaskFilename(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}.md`
}

export function generateUid(): string {
  return crypto.randomUUID()
}

export function defaultTaskFrontmatter(
  overrides?: Partial<TaskFrontmatter>,
): TaskFrontmatter {
  const now = new Date().toISOString()
  const base: TaskFrontmatter = {
    uid: generateUid(),
    status: 'todo',
    priority: 3,
    due: '',
    created: now,
    modified: now,
    completed: '',
    tags: [],
    parent: '',
    order: 0,
  }
  if (!overrides) return base
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined),
    ),
  } as TaskFrontmatter
}

export function listFromPath(path: string): string | null {
  const rel = path.startsWith(TASKS_DIR + '/')
    ? path.slice(TASKS_DIR.length + 1)
    : path
  const parts = rel.split('/')
  return parts.length > 1 ? parts[0] : null
}

export function buildTaskTree(flat: TaskItem[]): TaskItem[] {
  const byUid = new Map<string, TaskItem>()
  for (const t of flat) {
    byUid.set(t.uid, { ...t, children: [] })
  }

  const roots: TaskItem[] = []
  for (const t of byUid.values()) {
    if (t.parent && byUid.has(t.parent)) {
      byUid.get(t.parent)!.children.push(t)
    } else {
      roots.push(t)
    }
  }

  const sortFn = (a: TaskItem, b: TaskItem) => {
    const aDone = a.status === 'done' || a.status === 'cancelled' ? 1 : 0
    const bDone = b.status === 'done' || b.status === 'cancelled' ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    if (a.order !== b.order) return a.order - b.order
    return new Date(b.modified).getTime() - new Date(a.modified).getTime()
  }

  roots.sort(sortFn)
  for (const t of byUid.values()) {
    if (t.children.length > 1) t.children.sort(sortFn)
  }

  return roots
}

export function isOverdue(task: TaskItem): boolean {
  if (task.status === 'done' || task.status === 'cancelled') return false
  const today = startOfLocalDay(new Date())
  const eff = getEffectiveDueDate(task, today)
  if (!eff) return false
  const d = parseLocalDate(eff)
  if (!d) return false
  return d < today
}

export function isDueToday(task: TaskItem): boolean {
  const today = new Date()
  const eff = getEffectiveDueDate(task, today)
  if (!eff) return false
  const d = parseLocalDate(eff)
  if (!d) return false
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

export function isDueThisWeek(task: TaskItem): boolean {
  const today = startOfLocalDay(new Date())
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const eff = getEffectiveDueDate(task, today)
  if (!eff) return false
  const d = parseLocalDate(eff)
  if (!d) return false
  return d >= today && d <= weekEnd
}

export function bodyFromTitle(title: string): string {
  return title ? `\n# ${title}\n` : '\n'
}

/** Build frontmatter for disk write; preserves or clears `repeat` from `patch` / `existing`. */
export function mergeTaskFrontmatterForSave(
  existing: TaskItem,
  patch: Partial<TaskFrontmatter>,
): TaskFrontmatter {
  const repeatResolved =
    patch.repeat === '' || patch.repeat === null
      ? null
      : patch.repeat === 'weekly'
        ? 'weekly'
        : existing.repeat

  const repeatWeekdayResolved =
    typeof patch.repeatWeekday === 'number' ? patch.repeatWeekday : existing.repeatWeekday

  const weekly =
    repeatResolved === 'weekly' &&
    repeatWeekdayResolved != null &&
    repeatWeekdayResolved >= 0 &&
    repeatWeekdayResolved <= 6

  const fm: TaskFrontmatter = {
    uid: existing.uid,
    status: (patch.status as TaskStatus) ?? existing.status,
    priority: (patch.priority as TaskPriority) ?? existing.priority,
    due: patch.due !== undefined ? String(patch.due) : (existing.due ?? ''),
    created: existing.created,
    modified: new Date().toISOString(),
    completed:
      patch.completed !== undefined
        ? String(patch.completed)
        : (existing.completed ?? '') || '',
    tags: patch.tags ?? existing.tags,
    parent: patch.parent !== undefined ? String(patch.parent) : (existing.parent ?? '') || '',
    order: patch.order ?? existing.order,
  }

  if (weekly) {
    fm.repeat = 'weekly'
    fm.repeatWeekday = repeatWeekdayResolved as number
  }

  return fm
}
