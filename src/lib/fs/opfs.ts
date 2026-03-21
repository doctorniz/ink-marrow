import { FileType, getFileType } from '@/types/files'
import type { FileEntry, FileStats } from '@/types/files'
import type { FileSystemAdapter } from './types'

export class OpfsAdapter implements FileSystemAdapter {
  readonly type = 'opfs' as const
  private root: FileSystemDirectoryHandle | null = null

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory()
  }

  private getRoot(): FileSystemDirectoryHandle {
    if (!this.root) throw new Error('OPFS adapter not initialized. Call init() first.')
    return this.root
  }

  private async resolvePath(
    path: string,
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const segments = path.split('/').filter(Boolean)
    const name = segments.pop()
    if (!name) throw new Error(`Invalid path: ${path}`)

    let dir = this.getRoot()
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment)
    }
    return { parent: dir, name }
  }

  private async resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    const segments = path.split('/').filter(Boolean)
    let dir = this.getRoot()
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment)
    }
    return dir
  }

  async readFile(path: string): Promise<Uint8Array> {
    const { parent, name } = await this.resolvePath(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async readTextFile(path: string): Promise<string> {
    const { parent, name } = await this.resolvePath(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    return file.text()
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const { parent, name } = await this.resolvePath(path)
    const fileHandle = await parent.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    await writable.write(copy)
    await writable.close()
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const encoder = new TextEncoder()
    await this.writeFile(path, encoder.encode(content))
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { parent, name } = await this.resolvePath(path)
      try {
        await parent.getFileHandle(name)
        return true
      } catch {
        await parent.getDirectoryHandle(name)
        return true
      }
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<FileStats> {
    const { parent, name } = await this.resolvePath(path)
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    return {
      size: file.size,
      createdAt: new Date(file.lastModified),
      modifiedAt: new Date(file.lastModified),
    }
  }

  async mkdir(path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean)
    let dir = this.getRoot()
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const dir = path ? await this.resolveDir(path) : this.getRoot()
    const entries: FileEntry[] = []

    const withEntries = dir as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
    }
    for await (const [name, handle] of withEntries.entries()) {
      const entryPath = path ? `${path}/${name}` : name
      const isDirectory = handle.kind === 'directory'

      const entry: FileEntry = {
        name,
        path: entryPath,
        type: isDirectory ? FileType.Other : getFileType(name),
        isDirectory,
      }

      if (!isDirectory) {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          entry.size = file.size
          entry.modifiedAt = new Date(file.lastModified).toISOString()
        } catch {
          // Stat errors are non-fatal
        }
      }

      entries.push(entry)
    }

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const data = await this.readFile(oldPath)
    await this.writeFile(newPath, data)
    await this.remove(oldPath)
  }

  async copy(sourcePath: string, destPath: string): Promise<void> {
    const data = await this.readFile(sourcePath)
    await this.writeFile(destPath, data)
  }

  async remove(path: string): Promise<void> {
    const { parent, name } = await this.resolvePath(path)
    await parent.removeEntry(name)
  }

  async removeDir(path: string): Promise<void> {
    const { parent, name } = await this.resolvePath(path)
    await parent.removeEntry(name, { recursive: true })
  }
}
