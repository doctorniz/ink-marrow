'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { toast } from '@/stores/toast'
import {
  ChevronRight,
  ChevronDown,
  ExternalLink,
  FileCode2,
  FileText,
  FileType2,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  GitFork,
  Layout,
  Music,
  PanelLeftClose,
  Presentation,
  Pencil,
  Plus,
  Search,
  Star,
  Table2,
  Trash2,
} from 'lucide-react'
import type { FileSystemAdapter } from '@/lib/fs'
import { FileType } from '@/types/files'
import {
  detectEditorTabType,
  titleFromVaultPath,
} from '@/lib/notes/editor-tab-from-path'
import type { FileEntry } from '@/types/files'
import { isNotesTreeEntry, sortTreeEntries } from '@/lib/notes/tree-filter'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import { createUntitledNote } from '@/lib/notes/new-note'
import { collectFilePaths, renameFolder } from '@/lib/notes/folder-ops'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'
import { useFileTreeStore } from '@/stores/file-tree'
import { useEditorStore } from '@/stores/editor'
import { removeSearchDocument } from '@/lib/search/index'
import { Button } from '@/components/ui/button'
import { RenameNoteDialog } from '@/components/notes/rename-note-dialog'
import { cn } from '@/utils/cn'

const DND_TYPE = 'application/x-ink-tree-path'

function fileTitleFromPath(path: string): string {
  return titleFromVaultPath(path)
}

export function NotesFileTree({
  vaultFs,
  refreshToken = 0,
  onNoteCreated,
  starredPaths = [],
  onRequestCollapse,
  onSearchOpen,
  onGraphOpen,
  rootClassName,
}: {
  vaultFs: FileSystemAdapter
  /** Increment from parent to reload the tree (e.g. after creating a note elsewhere). */
  refreshToken?: number
  onNoteCreated?: () => void
  starredPaths?: string[]
  onRequestCollapse?: () => void
  onSearchOpen?: () => void
  onGraphOpen?: () => void
  rootClassName?: string
}) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([])
  const [renamePath, setRenamePath] = useState<string | null>(null)
  const [inlineEditPath, setInlineEditPath] = useState<string | null>(null)
  const [externalDragOver, setExternalDragOver] = useState(false)
  const dragEnterCount = useRef(0)
  const [deletePath, setDeletePath] = useState<string | null>(null)
  const [deleteIsFolder, setDeleteIsFolder] = useState(false)
  const [renameFolderPath, setRenameFolderPath] = useState<string | null>(null)
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)
  const selectedPath = useFileTreeStore((s) => s.selectedPath)
  const setSelectedPath = useFileTreeStore((s) => s.setSelectedPath)
  const openTab = useEditorStore((s) => s.openTab)
  const addRecentFile = useEditorStore((s) => s.addRecentFile)

  const refresh = useCallback(async () => {
    const entries = await vaultFs.readdir('')
    const visible = entries.filter(isNotesTreeEntry).sort(sortTreeEntries)
    setRootEntries(visible)
  }, [vaultFs])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  async function handleNewNote() {
    const path = await createUntitledNote(vaultFs)
    onNoteCreated?.()
    setSelectedPath(path)
    openTab({
      id: crypto.randomUUID(),
      path,
      type: 'markdown',
      title: fileTitleFromPath(path),
      isDirty: false,
    })
    addRecentFile(path)
  }

  function handleOpenFile(path: string) {
    setSelectedPath(path)
    addRecentFile(path)

    void (async () => {
      const type = await detectEditorTabType(vaultFs, path)
      openTab({
        id: crypto.randomUUID(),
        path,
        type,
        title: fileTitleFromPath(path),
        isDirty: false,
      })
    })()
  }

  async function handleExternalImport(files: FileList, targetFolder: string) {
    if (!files.length) return
    try {
      let count = 0
      for (const file of Array.from(files)) {
        const buf = new Uint8Array(await file.arrayBuffer())
        const dest = targetFolder ? `${targetFolder}/${file.name}` : file.name
        await vaultFs.writeFile(dest, buf)
        if (dest.endsWith('.md')) await reindexMarkdownPath(vaultFs, dest)
        count++
      }
      void refresh()
      onNoteCreated?.()
      toast.success(`Imported ${count} file${count !== 1 ? 's' : ''}`)
    } catch (e) {
      console.error('Import failed', e)
      toast.error('Failed to import files')
    } finally {
      dragEnterCount.current = 0
      setExternalDragOver(false)
    }
  }

  /** Move a file into a target folder via drag-and-drop */
  async function handleMoveFile(srcPath: string, destFolder: string) {
    const fileName = srcPath.split('/').pop()
    if (!fileName) return
    const newPath = destFolder ? `${destFolder}/${fileName}` : fileName
    if (vaultPathsPointToSameFile(newPath, srcPath)) return
    if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, srcPath)) {
      toast.error('A file with that name already exists in the target folder')
      return
    }
    try {
      await vaultFs.rename(srcPath, newPath)
      removeSearchDocument(srcPath)
      if (newPath.endsWith('.md')) {
        await reindexMarkdownPath(vaultFs, newPath)
      }
      const { tabs, retargetTabPath } = useEditorStore.getState()
      const tab = tabs.find((t) => t.path === srcPath)
      if (tab) retargetTabPath(tab.id, newPath, fileTitleFromPath(newPath))
      if (selectedPath === srcPath) setSelectedPath(newPath)
      void refresh()
      onNoteCreated?.()
      toast.success(`Moved to ${destFolder || 'root'}`)
    } catch (e) {
      console.error('Move failed', e)
      toast.error('Failed to move file')
    }
  }

  async function handleInlineRename(oldPath: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed) return
    const sanitized = trimmed.replace(/[/\\:*?"<>|]/g, '')
    if (!sanitized) return
    // Preserve the original file extension
    const ext = oldPath.includes('.') ? oldPath.slice(oldPath.lastIndexOf('.')) : '.md'
    const fileName = sanitized.toLowerCase().endsWith(ext.toLowerCase()) ? sanitized : `${sanitized}${ext}`
    const parent = oldPath.lastIndexOf('/') === -1 ? '' : oldPath.slice(0, oldPath.lastIndexOf('/'))
    const newPath = parent ? `${parent}/${fileName}` : fileName
    if (vaultPathsPointToSameFile(newPath, oldPath)) return
    if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, oldPath)) {
      toast.error('A note with that name already exists')
      return
    }
    try {
      await vaultFs.rename(oldPath, newPath)
      removeSearchDocument(oldPath)
      if (newPath.endsWith('.md')) {
        await reindexMarkdownPath(vaultFs, newPath)
      }
      const { tabs, retargetTabPath } = useEditorStore.getState()
      const tab = tabs.find((t) => t.path === oldPath)
      if (tab) retargetTabPath(tab.id, newPath, fileTitleFromPath(newPath))
      if (selectedPath === oldPath) setSelectedPath(newPath)
      void refresh()
      onNoteCreated?.()
    } catch (e) {
      console.error('Inline rename failed', e)
      toast.error('Failed to rename note')
    }
  }

  function requestDelete(path: string, isFolder: boolean) {
    setDeletePath(path)
    setDeleteIsFolder(isFolder)
  }

  async function handleDelete() {
    if (!deletePath) return
    try {
      if (deleteIsFolder) {
        const files = await collectFilePaths(vaultFs, deletePath)
        for (const f of files) removeSearchDocument(f)
        const { tabs, closeTab } = useEditorStore.getState()
        for (const tab of tabs) {
          if (tab.path.startsWith(deletePath + '/') || tab.path === deletePath) {
            closeTab(tab.id)
          }
        }
        await vaultFs.removeDir(deletePath)
        toast.success('Folder deleted')
      } else {
        await vaultFs.remove(deletePath)
        removeSearchDocument(deletePath)
        const tabs = useEditorStore.getState().tabs
        const tab = tabs.find((t) => t.path === deletePath)
        if (tab) useEditorStore.getState().closeTab(tab.id)
        toast.success('Note deleted')
      }
      if (selectedPath?.startsWith(deletePath)) setSelectedPath(null)
      setDeletePath(null)
      void refresh()
      onNoteCreated?.()
    } catch (e) {
      console.error('Delete failed', e)
      toast.error(deleteIsFolder ? 'Failed to delete folder' : 'Failed to delete note')
    }
  }

  return (
    <>
      <RenameNoteDialog
        open={renamePath !== null}
        onOpenChange={(o) => !o && setRenamePath(null)}
        vaultFs={vaultFs}
        currentPath={renamePath ?? ''}
        onRenamed={() => onNoteCreated?.()}
      />
      {deletePath && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
          <div className="bg-bg border-border w-[min(100%,360px)] rounded-xl border p-5 shadow-lg">
            <h2 className="text-fg text-sm font-semibold">
              Delete {deleteIsFolder ? 'folder' : 'note'}?
            </h2>
            <p className="text-fg-secondary mt-2 text-sm">
              Are you sure you want to delete{' '}
              <strong>{deletePath.split('/').pop()}</strong>
              {deleteIsFolder ? ' and all its contents' : ''}? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="text-fg-secondary hover:text-fg rounded-md px-3 py-1.5 text-sm"
                onClick={() => setDeletePath(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bg-danger text-accent-fg hover:opacity-90 rounded-md px-3 py-1.5 text-sm font-medium"
                onClick={() => void handleDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <RenameFolderDialog
        open={renameFolderPath !== null}
        onOpenChange={(o) => !o && setRenameFolderPath(null)}
        vaultFs={vaultFs}
        currentPath={renameFolderPath ?? ''}
        onRenamed={() => {
          onNoteCreated?.()
          void refresh()
        }}
      />
      <NewFolderDialog
        open={newFolderParent !== null}
        onOpenChange={(o) => !o && setNewFolderParent(null)}
        vaultFs={vaultFs}
        parentPath={newFolderParent ?? ''}
        onCreated={() => {
          onNoteCreated?.()
          void refresh()
        }}
      />
    <div
      className={cn(
        'border-border bg-bg relative flex h-full w-[min(100%,240px)] shrink-0 flex-col border-r',
        rootClassName,
      )}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dragEnterCount.current++
          setExternalDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        dragEnterCount.current = Math.max(0, dragEnterCount.current - 1)
        if (dragEnterCount.current === 0) setExternalDragOver(false)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
        }
      }}
      onDrop={(e) => {
        dragEnterCount.current = 0
        setExternalDragOver(false)
        if (e.dataTransfer.files.length > 0 && !e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault()
          void handleExternalImport(e.dataTransfer.files, '')
          return
        }
        const src = e.dataTransfer.getData(DND_TYPE)
        if (!src) return
        e.preventDefault()
        void handleMoveFile(src, '')
      }}
    >
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {onRequestCollapse && (
            <Button
              variant="ghost"
              size="sm"
              className="text-fg-muted hover:text-fg size-7 shrink-0 p-0"
              onClick={onRequestCollapse}
              aria-label="Collapse vault tree"
              title="Collapse vault tree"
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          )}
          <span className="text-fg truncate text-xs font-semibold tracking-wide uppercase">
            Vault
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onSearchOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="text-fg-muted hover:text-fg size-7 shrink-0 p-0"
              onClick={onSearchOpen}
              aria-label="Search vault"
              title="Search (Ctrl+F)"
            >
              <Search className="size-3.5" />
            </Button>
          )}
          {onGraphOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="text-fg-muted hover:text-fg size-7 shrink-0 p-0"
              onClick={onGraphOpen}
              aria-label="Open graph"
              title="Graph"
            >
              <GitFork className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-fg size-7 shrink-0 p-0"
            onClick={() => setNewFolderParent('')}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-fg size-7 shrink-0 p-0"
            onClick={() => void handleNewNote()}
            aria-label="New note"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      {externalDragOver && (
        <div className="border-accent bg-accent/10 pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed">
          <span className="text-accent text-xs font-semibold">Drop to import</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {starredPaths.length > 0 && (
          <div className="mb-2">
            <div className="text-fg-muted px-3 pb-1 pt-1.5 text-[10px] font-semibold tracking-widest uppercase">
              Starred
            </div>
            {starredPaths.map((p) => (
              <SidebarPathRow
                key={`star-${p}`}
                path={p}
                selected={selectedPath === p}
                onOpen={handleOpenFile}
              />
            ))}
          </div>
        )}
        {rootEntries.length === 0 && starredPaths.length === 0 ? (
          <p className="text-fg-muted px-3 py-4 text-center text-xs">No files yet.</p>
        ) : (
          <div
            role="tree"
            aria-label="Vault file tree"
          >
            {rootEntries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                vaultFs={vaultFs}
                refreshToken={refreshToken}
                selectedPath={selectedPath}
                inlineEditPath={inlineEditPath}
                onOpenFile={handleOpenFile}
                onStartInlineEdit={setInlineEditPath}
                onCommitInlineEdit={handleInlineRename}
                onCancelInlineEdit={() => setInlineEditPath(null)}
                onRenameNote={setRenamePath}
                onDeleteItem={requestDelete}
                onRenameFolder={setRenameFolderPath}
                onNewSubfolder={setNewFolderParent}
                onMoveFile={handleMoveFile}
                onExternalImport={handleExternalImport}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}

function SidebarPathRow({
  path,
  selected,
  onOpen,
}: {
  path: string
  selected: boolean
  onOpen: (path: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className={cn(
        'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors',
        selected
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-fg hover:bg-bg-hover',
      )}
    >
      <FileText className={cn('size-3.5 shrink-0', selected ? 'text-accent/60' : 'text-fg-muted')} aria-hidden />
      <span className="min-w-0 truncate">{fileTitleFromPath(path)}</span>
    </button>
  )
}

function TreeNode({
  entry,
  depth,
  vaultFs,
  refreshToken,
  selectedPath,
  inlineEditPath,
  onOpenFile,
  onStartInlineEdit,
  onCommitInlineEdit,
  onCancelInlineEdit,
  onRenameNote,
  onDeleteItem,
  onRenameFolder,
  onNewSubfolder,
  onMoveFile,
  onExternalImport,
}: {
  entry: FileEntry
  depth: number
  vaultFs: FileSystemAdapter
  /** Bumped when vault files change (same as parent `NotesFileTree`); reloads expanded folder children. */
  refreshToken: number
  selectedPath: string | null
  inlineEditPath: string | null
  onOpenFile: (path: string) => void
  onStartInlineEdit: (path: string) => void
  onCommitInlineEdit: (oldPath: string, newName: string) => void
  onCancelInlineEdit: () => void
  onRenameNote: (path: string) => void
  onDeleteItem: (path: string, isFolder: boolean) => void
  onRenameFolder: (path: string) => void
  onNewSubfolder: (parentPath: string) => void
  onMoveFile: (srcPath: string, destFolder: string) => void
  onExternalImport: (files: FileList, targetFolder: string) => void
}) {
  const expandedPaths = useFileTreeStore((s) => s.expandedPaths)
  const toggleExpanded = useFileTreeStore((s) => s.toggleExpanded)
  const toggleStarred = useFileTreeStore((s) => s.toggleStarred)
  const starred = useFileTreeStore((s) => s.starredPaths.includes(entry.path))
  const expanded = Boolean(expandedPaths[entry.path])
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const isEditing = inlineEditPath === entry.path

  useEffect(() => {
    if (!entry.isDirectory || !expanded) return
    let cancelled = false
    void vaultFs.readdir(entry.path).then((entries) => {
      if (cancelled) return
      const visible = entries.filter(isNotesTreeEntry).sort(sortTreeEntries)
      setChildren(visible)
    })
    return () => {
      cancelled = true
    }
  }, [entry.isDirectory, entry.path, expanded, vaultFs, refreshToken])

  if (!entry.isDirectory) {
    const selected = selectedPath === entry.path
    const displayName = titleFromVaultPath(entry.path)
    const FileIcon =
      entry.type === FileType.Canvas ? Layout
      : entry.type === FileType.Image ? ImageIcon
      : entry.type === FileType.Audio ? Music
      : entry.type === FileType.Video ? Film
      : entry.type === FileType.Docx ? FileType2
      : entry.type === FileType.Pptx ? Presentation
      : entry.type === FileType.Spreadsheet ? Table2
      : entry.type === FileType.Code ? FileCode2
      : FileText

    function commitInline() {
      const val = inlineInputRef.current?.value
      if (val != null) {
        onCommitInlineEdit(entry.path, val)
      }
      onCancelInlineEdit()
    }

    const fileRow = (
      <div
        role="treeitem"
        aria-selected={selected}
        aria-level={depth + 1}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, entry.path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2' && !isEditing) {
            e.preventDefault()
            onStartInlineEdit(entry.path)
          }
        }}
        className={cn(
          'group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-0.5 rounded-md py-1 pr-1 text-[13px] transition-colors',
          selected
            ? 'bg-accent/10 text-accent'
            : 'text-fg hover:bg-bg-hover',
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileIcon className="text-fg-muted size-3.5 shrink-0" aria-hidden />
            <input
              ref={inlineInputRef}
              type="text"
              defaultValue={displayName}
              autoFocus
              onFocus={(e) => {
                const el = e.currentTarget
                el.setSelectionRange(0, el.value.length)
              }}
              onBlur={commitInline}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitInline() }
                if (e.key === 'Escape') { e.preventDefault(); onCancelInlineEdit() }
                e.stopPropagation()
              }}
              className="text-fg bg-bg border-accent min-w-0 flex-1 rounded border px-1 py-0 text-[13px] outline-none"
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onOpenFile(entry.path)}
              onDoubleClick={(e) => {
                e.preventDefault()
                if (entry.type === FileType.Markdown) onStartInlineEdit(entry.path)
              }}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 py-0 text-left',
                selected && 'font-medium',
              )}
            >
              <FileIcon
                className={cn(
                  'size-3.5 shrink-0',
                  selected ? 'text-accent/60' : 'text-fg-muted',
                  entry.type === FileType.Pdf && 'text-red-400/70',
                  entry.type === FileType.Canvas && 'text-violet-400/70',
                  entry.type === FileType.Image && 'text-emerald-400/70',
                  entry.type === FileType.Audio && 'text-pink-400/70',
                  entry.type === FileType.Video && 'text-cyan-400/70',
                  entry.type === FileType.Docx && 'text-indigo-400/70',
                  entry.type === FileType.Pptx && 'text-orange-400/70',
                  entry.type === FileType.Spreadsheet && 'text-green-400/70',
                  entry.type === FileType.Code && 'text-sky-400/70',
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate">{displayName}</span>
            </button>
            <button
              type="button"
              className={cn(
                'shrink-0 rounded p-1 transition-opacity md:opacity-0 md:group-hover:opacity-100',
                starred ? 'text-accent opacity-100' : 'text-fg-muted hover:text-fg opacity-100',
              )}
              aria-label={starred ? 'Remove star' : 'Star note'}
              onClick={(e) => {
                e.stopPropagation()
                toggleStarred(entry.path)
              }}
            >
              <Star className={cn('size-3.5', starred && 'fill-current')} aria-hidden />
            </button>
            <button
              type="button"
              className="text-fg-muted hover:text-fg shrink-0 rounded p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              aria-label={`Rename ${entry.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onStartInlineEdit(entry.path)
              }}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              className="text-fg-muted hover:text-red-500 shrink-0 rounded p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              aria-label={`Delete ${entry.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onDeleteItem(entry.path, false)
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>
    )

    return (
      <TreeContextMenu
        isFile
        entryName={entry.name}
        starred={starred}
        onOpen={() => onOpenFile(entry.path)}
        onRename={() => onStartInlineEdit(entry.path)}
        onStar={() => toggleStarred(entry.path)}
        onDelete={() => onDeleteItem(entry.path, false)}
      >
        {fileRow}
      </TreeContextMenu>
    )
  }

  const folderRow = (
    <div
      className={cn(
        'group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-0.5 rounded-md py-1 pr-1 text-[13px] transition-colors',
        dragOver
          ? 'bg-accent/15 ring-accent/40 ring-1'
          : 'hover:bg-bg-hover',
      )}
      style={{ paddingLeft: 2 + depth * 14 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        setDragOver(false)
        if (e.dataTransfer.files.length > 0 && !e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault()
          e.stopPropagation()
          onExternalImport(e.dataTransfer.files, entry.path)
          return
        }
        const src = e.dataTransfer.getData(DND_TYPE)
        if (!src) return
        e.preventDefault()
        e.stopPropagation()
        onMoveFile(src, entry.path)
      }}
    >
      <button
        type="button"
        onClick={() => toggleExpanded(entry.path)}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entry.name}`}
        className="text-fg flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-fg-muted size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="text-fg-muted size-4 shrink-0" aria-hidden />
        )}
        <Folder className="text-fg-muted size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{entry.name}</span>
      </button>
      <button
        type="button"
        className="text-fg-muted hover:text-fg shrink-0 rounded p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
        aria-label={`New subfolder in ${entry.name}`}
        title="New subfolder"
        onClick={(e) => {
          e.stopPropagation()
          onNewSubfolder(entry.path)
        }}
      >
        <FolderPlus className="size-3.5" />
      </button>
      <button
        type="button"
        className="text-fg-muted hover:text-fg shrink-0 rounded p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
        aria-label={`Rename ${entry.name}`}
        title="Rename folder"
        onClick={(e) => {
          e.stopPropagation()
          onRenameFolder(entry.path)
        }}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        className="text-fg-muted hover:text-red-500 shrink-0 rounded p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
        aria-label={`Delete ${entry.name}`}
        title="Delete folder"
        onClick={(e) => {
          e.stopPropagation()
          onDeleteItem(entry.path, true)
        }}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )

  return (
    <div role="treeitem" aria-expanded={expanded} aria-level={depth + 1}>
      <TreeContextMenu
        isFile={false}
        entryName={entry.name}
        onRename={() => onRenameFolder(entry.path)}
        onNewSubfolder={() => onNewSubfolder(entry.path)}
        onDelete={() => onDeleteItem(entry.path, true)}
      >
        {folderRow}
      </TreeContextMenu>
      {expanded && children && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              vaultFs={vaultFs}
              refreshToken={refreshToken}
              selectedPath={selectedPath}
              inlineEditPath={inlineEditPath}
              onOpenFile={onOpenFile}
              onStartInlineEdit={onStartInlineEdit}
              onCommitInlineEdit={onCommitInlineEdit}
              onCancelInlineEdit={onCancelInlineEdit}
              onRenameNote={onRenameNote}
              onDeleteItem={onDeleteItem}
              onRenameFolder={onRenameFolder}
              onNewSubfolder={onNewSubfolder}
              onMoveFile={onMoveFile}
              onExternalImport={onExternalImport}
            />
          ))}
        </div>
      )}
      {expanded && children && children.length === 0 && (
        <p
          className="text-fg-muted py-1 text-xs"
          style={{ paddingLeft: 28 + depth * 14 }}
        >
          Empty folder
        </p>
      )}
    </div>
  )
}

const CTX_ROW =
  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none transition-colors cursor-pointer data-[highlighted]:bg-bg-hover'

function TreeContextMenu({
  children,
  isFile,
  entryName,
  starred,
  onOpen,
  onRename,
  onStar,
  onNewSubfolder,
  onDelete,
}: {
  children: React.ReactNode
  isFile: boolean
  entryName: string
  starred?: boolean
  onOpen?: () => void
  onRename: () => void
  onStar?: () => void
  onNewSubfolder?: () => void
  onDelete: () => void
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="border-border-strong bg-bg z-50 min-w-[180px] rounded-lg border p-1 shadow-lg">
          {isFile && onOpen && (
            <ContextMenu.Item className={CTX_ROW} onSelect={onOpen}>
              <ExternalLink className="size-4" />
              Open
            </ContextMenu.Item>
          )}
          {isFile && onStar && (
            <ContextMenu.Item className={CTX_ROW} onSelect={onStar}>
              <Star className={cn('size-4', starred && 'fill-current')} />
              {starred ? 'Unstar' : 'Star'}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item className={CTX_ROW} onSelect={onRename}>
            <Pencil className="size-4" />
            Rename
          </ContextMenu.Item>
          {!isFile && onNewSubfolder && (
            <ContextMenu.Item className={CTX_ROW} onSelect={onNewSubfolder}>
              <FolderPlus className="size-4" />
              New subfolder
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className="bg-border my-1 h-px" />
          <ContextMenu.Item
            className={`${CTX_ROW} text-danger data-[highlighted]:bg-danger/10`}
            onSelect={onDelete}
          >
            <Trash2 className="size-4" />
            Delete {isFile ? entryName : 'folder'}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function RenameFolderDialog({
  open,
  onOpenChange,
  vaultFs,
  currentPath,
  onRenamed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultFs: FileSystemAdapter
  currentPath: string
  onRenamed?: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(currentPath.split('/').pop() ?? '')
    setError(null)
  }, [open, currentPath])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    if (/[/\\]/.test(trimmed)) {
      setError('Name cannot contain slashes.')
      return
    }
    const parent = parentDir(currentPath)
    const newPath = parent ? `${parent}/${trimmed}` : trimmed
    if (vaultPathsPointToSameFile(newPath, currentPath)) {
      onOpenChange(false)
      return
    }
    if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, currentPath)) {
      setError('A folder with that name already exists.')
      return
    }

    setBusy(true)
    try {
      const oldFiles = await collectFilePaths(vaultFs, currentPath)
      await renameFolder(vaultFs, currentPath, newPath)

      const { tabs, retargetTabPath } = useEditorStore.getState()
      for (const tab of tabs) {
        if (tab.path.startsWith(currentPath + '/')) {
          const updated = newPath + tab.path.slice(currentPath.length)
          retargetTabPath(tab.id, updated, updated.replace(/\.md$/i, '').split('/').pop() ?? updated)
        }
      }
      for (const f of oldFiles) removeSearchDocument(f)

      const sel = useFileTreeStore.getState().selectedPath
      if (sel?.startsWith(currentPath + '/') || sel === currentPath) {
        useFileTreeStore.getState().setSelectedPath(
          sel === currentPath ? newPath : newPath + sel.slice(currentPath.length),
        )
      }

      onRenamed?.()
      onOpenChange(false)
      toast.success('Folder renamed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[199] bg-black/40" />
        <Dialog.Content className="border-border-strong bg-bg fixed top-1/2 left-1/2 z-[200] w-[min(100%,360px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-4 shadow-lg">
          <Dialog.Title className="text-fg text-sm font-semibold">Rename folder</Dialog.Title>
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              aria-label="New folder name"
              className="border-border-strong focus:border-accent focus:ring-accent/20 bg-bg text-fg w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              autoFocus
              disabled={busy}
            />
            {error && (
              <p className="text-danger text-xs" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Renaming…' : 'Rename'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function NewFolderDialog({
  open,
  onOpenChange,
  vaultFs,
  parentPath,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultFs: FileSystemAdapter
  parentPath: string
  onCreated?: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a folder name.')
      return
    }
    if (/[/\\]/.test(trimmed)) {
      setError('Name cannot contain slashes.')
      return
    }
    const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed
    if (await vaultFs.exists(fullPath)) {
      setError('A folder with that name already exists.')
      return
    }

    setBusy(true)
    try {
      await vaultFs.mkdir(fullPath)
      useFileTreeStore.getState().setExpanded(parentPath, true)
      onCreated?.()
      onOpenChange(false)
      toast.success('Folder created')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[199] bg-black/40" />
        <Dialog.Content className="border-border-strong bg-bg fixed top-1/2 left-1/2 z-[200] w-[min(100%,360px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-4 shadow-lg">
          <Dialog.Title className="text-fg text-sm font-semibold">New folder</Dialog.Title>
          <Dialog.Description className="text-fg-secondary mt-1 text-xs">
            Create a subfolder inside <code className="text-fg">{parentPath || 'vault root'}</code>.
          </Dialog.Description>
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="Folder name"
              aria-label="Folder name"
              className="border-border-strong focus:border-accent focus:ring-accent/20 bg-bg text-fg w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              disabled={busy}
            />
            {error && (
              <p className="text-danger text-xs" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
