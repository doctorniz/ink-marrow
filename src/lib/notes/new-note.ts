import type { FileSystemAdapter } from '@/lib/fs'

/**
 * Next available `Untitled.md`, `Untitled (2).md`, … at vault root.
 * Reuses `allocateUniqueFilePath` so the format is consistent with the
 * New-view creators.
 */
export async function allocateUntitledNotePath(fs: FileSystemAdapter): Promise<string> {
  return allocateUniqueFilePath(fs, 'Untitled.md')
}

/**
 * Given a desired file path, returns it unchanged if it doesn't exist,
 * or appends ` (2)`, ` (3)`, … to the stem until a free slot is found.
 *
 * e.g. `notes/My Note.md` → `notes/My Note (2).md` → `notes/My Note (3).md`
 */
export async function allocateUniqueFilePath(
  fs: FileSystemAdapter,
  desiredPath: string,
): Promise<string> {
  if (!(await fs.exists(desiredPath))) return desiredPath

  const lastSlash = desiredPath.lastIndexOf('/')
  const dir = lastSlash >= 0 ? desiredPath.slice(0, lastSlash + 1) : ''
  const filename = lastSlash >= 0 ? desiredPath.slice(lastSlash + 1) : desiredPath
  const dotIdx = filename.lastIndexOf('.')
  const stem = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename
  const ext = dotIdx >= 0 ? filename.slice(dotIdx) : ''

  let i = 2
  let candidate: string
  do {
    candidate = `${dir}${stem} (${i})${ext}`
    i++
  } while (await fs.exists(candidate))

  return candidate
}

/** Quoted so that titles like `Untitled (2)` don't break YAML parsing. */
export function getDefaultNoteContent(title = 'Untitled'): string {
  return ['---', `title: "${title}"`, `created: ${new Date().toISOString()}`, '---', '', ''].join('\n')
}

export async function createUntitledNote(fs: FileSystemAdapter): Promise<string> {
  const path = await allocateUntitledNotePath(fs)
  // Derive the title from the actual filename stem so it matches the file
  // tree display ("Untitled (2)" rather than always "Untitled").
  const stem = path.replace(/\.md$/i, '').split('/').pop() ?? 'Untitled'
  await fs.writeTextFile(path, getDefaultNoteContent(stem))
  return path
}
