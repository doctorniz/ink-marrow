import matter from 'gray-matter'
import type {
  CalendarEvent,
  CalendarEventFrontmatter,
  CalendarEventColor,
} from '@/types/calendar'

export const CALENDAR_DIR = '_marrow/_calendar'

const H1_RE = /^#\s+(.+)$/m

function safeColor(raw: unknown): CalendarEventColor {
  const valid: CalendarEventColor[] = ['violet', 'sky', 'emerald', 'amber', 'rose', 'slate']
  return valid.includes(raw as CalendarEventColor) ? (raw as CalendarEventColor) : 'violet'
}

export function parseCalendarEvent(path: string, raw: string): CalendarEvent {
  const { data, content } = matter(raw)
  const fm = data as Partial<CalendarEventFrontmatter>
  const h1 = H1_RE.exec(content)
  const bodyWithoutH1 = content.replace(/^#\s+.+\n?/, '').trim()

  return {
    path,
    uid: (fm.uid as string) ?? '',
    title: h1 ? h1[1].trim() : '',
    body: bodyWithoutH1,
    start: (fm.start as string) ?? '',
    end: (fm.end as string) ?? '',
    allDay: Boolean(fm.allDay),
    color: safeColor(fm.color),
    created: (fm.created as string) ?? new Date().toISOString(),
    modified: (fm.modified as string) ?? new Date().toISOString(),
  }
}

function yamlSafe(fm: CalendarEventFrontmatter): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fm as Record<string, unknown>).filter(([, v]) => v !== undefined),
  )
}

export function serializeCalendarEvent(
  fm: CalendarEventFrontmatter,
  title: string,
  body: string,
): string {
  const updated = { ...fm, modified: new Date().toISOString() }
  const mdBody = title ? `\n# ${title}\n${body ? `\n${body}\n` : ''}` : body ? `\n${body}\n` : '\n'
  return matter.stringify(mdBody, yamlSafe(updated))
}

export function generateEventFilename(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `evt-${ts}-${rand}.md`
}

export function generateEventUid(): string {
  return crypto.randomUUID()
}

export function defaultEventFrontmatter(
  overrides?: Partial<CalendarEventFrontmatter>,
): CalendarEventFrontmatter {
  const now = new Date().toISOString()
  const base: CalendarEventFrontmatter = {
    uid: generateEventUid(),
    start: '',
    end: '',
    allDay: true,
    color: 'violet',
    created: now,
    modified: now,
  }
  if (!overrides) return base
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined),
    ),
  } as CalendarEventFrontmatter
}

/** Pad a number to 2 digits */
function p(n: number) {
  return String(n).padStart(2, '0')
}

/** Format a Date as YYYY-MM-DD */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Format a Date as YYYY-MM-DDTHH:mm */
export function toDateTimeStr(d: Date): string {
  return `${toDateStr(d)}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Parse `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` to local Date */
export function parseEventDate(s: string): Date | null {
  if (!s) return null
  const dt = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s.trim())
  if (!dt) return null
  const [, y, mo, d, h, mi] = dt
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h ? Number(h) : 0,
    mi ? Number(mi) : 0,
  )
}

/** Returns `YYYY-MM-DD` portion of the event start */
export function eventStartDate(ev: CalendarEvent): string {
  return ev.start.slice(0, 10)
}

/** Returns `YYYY-MM-DD` portion of the event end */
export function eventEndDate(ev: CalendarEvent): string {
  return (ev.end || ev.start).slice(0, 10)
}

/** True when an event spans (or starts on) a given YYYY-MM-DD date cell. */
export function eventOccursOn(ev: CalendarEvent, dateStr: string): boolean {
  const s = eventStartDate(ev)
  const e = eventEndDate(ev)
  return dateStr >= s && dateStr <= e
}
