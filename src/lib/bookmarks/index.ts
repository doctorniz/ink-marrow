import matter from 'gray-matter'
import type { BookmarkFrontmatter, BookmarkItem } from '@/types/bookmarks'

export const BOOKMARKS_DIR = '_marrow/_bookmarks'

export function categoryFromPath(path: string): string | null {
  const rel = path.startsWith(BOOKMARKS_DIR + '/')
    ? path.slice(BOOKMARKS_DIR.length + 1)
    : path
  const parts = rel.split('/')
  return parts.length > 1 ? parts[0] : null
}

export function parseBookmarkItem(path: string, raw: string): BookmarkItem {
  const { data } = matter(raw)
  const fm = data as Partial<BookmarkFrontmatter>
  const rawTags = fm.tags as unknown
  const tags = Array.isArray(rawTags)
    ? (rawTags as unknown[]).map(String)
    : typeof rawTags === 'string'
      ? rawTags.split(/[,\s]+/).filter(Boolean)
      : []

  return {
    path,
    url: (fm.url as string) ?? '',
    title: (fm.title as string) ?? '',
    description: (fm.description as string) ?? '',
    favicon: (fm.favicon as string) ?? '',
    ogImage: (fm.ogImage as string) ?? '',
    tags,
    category: categoryFromPath(path),
    created: (fm.created as string) ?? new Date().toISOString(),
    modified: (fm.modified as string) ?? new Date().toISOString(),
  }
}

export function serializeBookmark(fm: BookmarkFrontmatter): string {
  const updated: BookmarkFrontmatter = { ...fm, modified: new Date().toISOString() }
  return matter.stringify('', updated)
}

export function generateBookmarkFilename(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}.md`
}
