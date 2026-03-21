import type { FileSystemAdapter, FileWatchEvent } from './types'
import type { FileEntry, FileStats } from '@/types/files'

/**
 * Wraps an adapter so all paths are relative to `basePath` (vault root inside OPFS).
 * Empty string `""` refers to the vault root directory.
 */
export function createScopedAdapter(
  inner: FileSystemAdapter,
  basePath: string,
): FileSystemAdapter {
  const base = basePath.replace(/^\/+|\/+$/g, '')

  const join = (path: string): string => {
    const p = path.replace(/^\/+/, '')
    if (!base) return p
    return p ? `${base}/${p}` : base
  }

  return {
    type: inner.type,

    async init(): Promise<void> {
      await inner.init()
    },

    readFile(path: string): Promise<Uint8Array> {
      return inner.readFile(join(path))
    },

    readTextFile(path: string): Promise<string> {
      return inner.readTextFile(join(path))
    },

    writeFile(path: string, data: Uint8Array): Promise<void> {
      return inner.writeFile(join(path), data)
    },

    writeTextFile(path: string, content: string): Promise<void> {
      return inner.writeTextFile(join(path), content)
    },

    exists(path: string): Promise<boolean> {
      return inner.exists(join(path))
    },

    stat(path: string): Promise<FileStats> {
      return inner.stat(join(path))
    },

    mkdir(path: string): Promise<void> {
      return inner.mkdir(join(path))
    },

    readdir(path: string): Promise<FileEntry[]> {
      const full = join(path)
      return inner.readdir(full).then((entries) =>
        entries.map((e) => ({
          ...e,
          path: stripBasePrefix(e.path, base),
        })),
      )
    },

    rename(oldPath: string, newPath: string): Promise<void> {
      return inner.rename(join(oldPath), join(newPath))
    },

    copy(sourcePath: string, destPath: string): Promise<void> {
      return inner.copy(join(sourcePath), join(destPath))
    },

    remove(path: string): Promise<void> {
      return inner.remove(join(path))
    },

    removeDir(path: string): Promise<void> {
      return inner.removeDir(join(path))
    },

    watch(path: string, callback: (event: FileWatchEvent) => void): () => void {
      if (!inner.watch) {
        return () => {}
      }
      const full = join(path)
      return inner.watch(full, (event) => {
        callback({
          ...event,
          path: stripBasePrefix(event.path, base),
        })
      })
    },
  }
}

function stripBasePrefix(fullPath: string, base: string): string {
  if (!base) return fullPath
  const prefix = `${base}/`
  if (fullPath === base) return ''
  if (fullPath.startsWith(prefix)) return fullPath.slice(prefix.length)
  return fullPath
}
