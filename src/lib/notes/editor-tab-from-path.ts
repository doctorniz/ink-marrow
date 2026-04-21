import matter from 'gray-matter'
import type { EditorTab } from '@/types/editor'
import { FileType, getFileType } from '@/types/files'
import type { FileSystemAdapter } from '@/lib/fs/types'

export function editorTabTypeFromVaultPath(path: string): EditorTab['type'] {
  const name = path.split('/').pop() ?? path
  const ft = getFileType(name)
  switch (ft) {
    case FileType.Pdf:
      return 'pdf'
    case FileType.Canvas:
      return 'canvas'
    case FileType.Image:
      return 'image'
    case FileType.Code:
      return 'code'
    default:
      return 'markdown'
  }
}

/**
 * Async variant that peeks at frontmatter for `.md` files to detect
 * special types like `kanban`. Falls back to extension-based detection
 * for non-markdown files or on read failure.
 */
export async function detectEditorTabType(
  fs: FileSystemAdapter,
  path: string,
): Promise<EditorTab['type']> {
  const base = editorTabTypeFromVaultPath(path)
  if (base !== 'markdown') return base

  try {
    const raw = await fs.readTextFile(path)
    const { data } = matter(raw)
    if (data.type === 'kanban') return 'kanban'
  } catch { /* fall through */ }

  return 'markdown'
}

/** Display title: filename without extension (or with extension for code files). */
export function titleFromVaultPath(path: string): string {
  const name = path.split('/').pop() ?? path
  const ft = getFileType(name)
  // Keep the extension visible for code files
  if (ft === FileType.Code) return name
  return path.replace(/\.[^/.]+$/i, '').split('/').pop() ?? path
}
