import type { FileEntry } from '@/types/files'
import { FileType } from '@/types/files'

/** Hide app-internal dirs from the Notes sidebar. */
export function isNotesTreeHidden(entry: FileEntry): boolean {
  if (entry.name === '_marrow' || entry.name === '_assets') return true
  const parts = entry.path.split('/')
  return parts.some((p) => p === '_marrow' || p === '_assets')
}

/** Folders always (if not hidden). Files: markdown, PDF, canvas, and images. */
export function isNotesTreeEntry(entry: FileEntry): boolean {
  if (isNotesTreeHidden(entry)) return false
  if (entry.isDirectory) return true
  return (
    entry.type === FileType.Markdown ||
    entry.type === FileType.Pdf ||
    entry.type === FileType.Canvas ||
    entry.type === FileType.Image ||
    entry.type === FileType.Code
  )
}

export function sortTreeEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
