import matter from 'gray-matter'
import type { BoardItem, BoardItemFrontmatter, ThoughtColor } from '@/types/board'

export const BOARD_DIR = '_marrow/_board'
export const BOARD_ASSETS_DIR = '_marrow/_board/_assets'

const H1_RE = /^#\s+(.+)$/m
const IMAGE_RE = /!\[.*?\]\(.+?\)/

export function parseBoardItem(path: string, raw: string): BoardItem {
  const { data, content } = matter(raw)
  const fm = data as Partial<BoardItemFrontmatter>
  const h1 = H1_RE.exec(content)

  return {
    path,
    type: fm.type ?? 'thought',
    title: h1 ? h1[1].trim() : null,
    body: content,
    color: (fm.color as ThoughtColor) ?? 'yellow',
    created: fm.created ?? new Date().toISOString(),
    modified: fm.modified ?? new Date().toISOString(),
    hasImage: IMAGE_RE.test(content),
  }
}

export function serializeBoardItem(
  fm: BoardItemFrontmatter,
  content: string,
): string {
  const updated = { ...fm, modified: new Date().toISOString() }
  return matter.stringify(content, updated)
}

export function generateBoardFilename(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}.md`
}

export function defaultFrontmatter(color: ThoughtColor = 'yellow'): BoardItemFrontmatter {
  const now = new Date().toISOString()
  return { type: 'thought', created: now, modified: now, color }
}
