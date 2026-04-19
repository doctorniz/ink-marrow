'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDownAZ,
  ArrowUpZA,
  ChevronLeft,
  Grid2X2,
  Inbox,
  List,
  SlidersHorizontal,
} from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import type { FileSystemAdapter } from '@/lib/fs'
import { useFileBrowserStore } from '@/stores/file-browser'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { useUiStore } from '@/stores/ui'
import { ViewMode, INBOX_DIR } from '@/types/vault'
import type { FbFileItem, FbSortField, FbViewMode } from '@/types/file-browser'
import {
  collectBrowserFiles,
  sortBrowserFiles,
  filterBrowserFiles,
} from '@/lib/file-browser/collect-files'
import { toast } from '@/stores/toast'
import { removeSearchDocument } from '@/lib/search/index'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'
import { Button } from '@/components/ui/button'
import { FbFileCard, FbFileRow, FB_DND_TYPE } from '@/components/file-browser/fb-file-card'
import { FbContextMenu } from '@/components/file-browser/fb-context-menu'
import { FbBatchToolbar } from '@/components/file-browser/fb-batch-toolbar'
import { PdfViewer } from '@/components/pdf/pdf-viewer'
import { CanvasEditor } from '@/components/canvas/canvas-editor'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { MoveToFolderDialog } from '@/components/file-browser/move-to-folder-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/utils/cn'
import { editorTabTypeFromVaultPath, titleFromVaultPath } from '@/lib/notes/editor-tab-from-path'

/* ------------------------------------------------------------------ */
/* Constants and helpers                                               */
/* ------------------------------------------------------------------ */

const SORT_LABELS: Record<FbSortField, string> = {
  name: 'Name',
  modifiedAt: 'Modified',
  size: 'Size',
  type: 'Type',
}

const ROW_HEIGHT = 40
/** Must fit icon + multiline rename textarea in `FbFileCard`. */
const CARD_HEIGHT = 152
const CARD_MIN_W = 100
const CARD_GAP = 12

/** Compute which file paths overlap with the rubber-band rect (content coords). */
function computeRubberBandSelection(
  files: FbFileItem[],
  rb: { x0: number; y0: number; x1: number; y1: number },
  viewMode: FbViewMode,
  cols: number,
  containerWidth: number,
): string[] {
  if (rb.x1 - rb.x0 < 2 && rb.y1 - rb.y0 < 2) return []

  if (viewMode === 'list') {
    return files
      .filter((_, i) => {
        const top = i * ROW_HEIGHT
        const bottom = top + ROW_HEIGHT
        return rb.y1 > top && rb.y0 < bottom
      })
      .map((f) => f.path)
  }

  // Grid
  const colW = cols > 1
    ? (containerWidth - (cols - 1) * CARD_GAP) / cols
    : containerWidth

  return files
    .filter((_, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const top = r * (CARD_HEIGHT + CARD_GAP)
      const bottom = top + CARD_HEIGHT
      const left = c * (colW + CARD_GAP)
      const right = left + colW
      return rb.y1 > top && rb.y0 < bottom && rb.x1 > left && rb.x0 < left + colW - 0 && rb.x0 < right
    })
    .map((f) => f.path)
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export function FileBrowserView({ showHidden = false }: { showHidden?: boolean }) {
  const { vaultFs, config } = useVaultSession()
  const viewMode = useFileBrowserStore((s) => s.viewMode)
  const sort = useFileBrowserStore((s) => s.sort)
  const _filters = useFileBrowserStore((s) => s.filters)
  const selected = useFileBrowserStore((s) => s.selected)
  const currentFolder = useFileBrowserStore((s) => s.currentFolder)
  const setViewMode = useFileBrowserStore((s) => s.setViewMode)
  const setSort = useFileBrowserStore((s) => s.setSort)
  const selectAll = useFileBrowserStore((s) => s.selectAll)
  const clearSelection = useFileBrowserStore((s) => s.clearSelection)
  const setCurrentFolder = useFileBrowserStore((s) => s.setCurrentFolder)

  const [rawFiles, setRawFiles] = useState<FbFileItem[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [openPdfPath, setOpenPdfPath] = useState<string | null>(null)
  const [openCanvasPath, setOpenCanvasPath] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [movePaths, setMovePaths] = useState<string[] | null>(null)
  const [deletePaths, setDeletePaths] = useState<string[] | null>(null)
  const [newFilePath, setNewFilePath] = useState<string | null>(null)
  const pendingPdfPath = useFileBrowserStore((s) => s.pendingPdfPath)
  const setPendingPdfPath = useFileBrowserStore((s) => s.setPendingPdfPath)
  const pendingCanvasPath = useFileBrowserStore((s) => s.pendingCanvasPath)
  const setPendingCanvasPath = useFileBrowserStore((s) => s.setPendingCanvasPath)

  const listScrollRef = useRef<HTMLDivElement>(null)
  const [externalDragOver, setExternalDragOver] = useState(false)
  const dragEnterCount = useRef(0)

  // Selection tracking
  const lastClickedIndex = useRef<number>(-1)
  const gridColsRef = useRef<number>(3)

  // Rubber-band selection
  const rbAnchor = useRef<{
    clientX: number; clientY: number
    contentX: number; contentY: number
  } | null>(null)
  const [rbRect, setRbRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  /** Set when blur(commit) is triggered from capture-phase outside-click; consumed in `handleScrollPointerDown`. */
  const skipRubberBandForRenameCloseRef = useRef(false)
  const renameOutsideClickTimeoutRef = useRef<number>(0)

  useEffect(() => {
    if (!editingPath) return

    function onPointerDownCapture(e: PointerEvent) {
      const ae = document.activeElement
      if (!(ae instanceof HTMLElement) || !ae.hasAttribute('data-fb-rename')) return
      const card = ae.closest('[data-fb-item]')
      if (card?.getAttribute('data-fb-path') !== editingPath) return
      const t = e.target as Node | null
      if (!t) return
      if (ae === t || ae.contains(t)) return
      skipRubberBandForRenameCloseRef.current = true
      window.clearTimeout(renameOutsideClickTimeoutRef.current)
      renameOutsideClickTimeoutRef.current = window.setTimeout(() => {
        if (skipRubberBandForRenameCloseRef.current) skipRubberBandForRenameCloseRef.current = false
      }, 0)
      ae.blur()
    }

    document.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      window.clearTimeout(renameOutsideClickTimeoutRef.current)
    }
  }, [editingPath])

  useEffect(() => {
    if (pendingPdfPath) {
      setOpenPdfPath(pendingPdfPath)
      setNewFilePath(pendingPdfPath)
      setPendingPdfPath(null)
    }
  }, [pendingPdfPath, setPendingPdfPath])

  useEffect(() => {
    if (pendingCanvasPath) {
      setOpenCanvasPath(pendingCanvasPath)
      setNewFilePath(pendingCanvasPath)
      setPendingCanvasPath(null)
    }
  }, [pendingCanvasPath, setPendingCanvasPath])

  const refresh = useCallback(async () => {
    const items = await collectBrowserFiles(vaultFs, currentFolder, showHidden)
    setRawFiles(items)
  }, [vaultFs, currentFolder, showHidden])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  const files = useMemo(() => {
    const filtered = filterBrowserFiles(rawFiles, typeFilter.length > 0 ? typeFilter : undefined)
    return sortBrowserFiles(filtered, sort)
  }, [rawFiles, sort, typeFilter])

  const selectedCount = Object.keys(selected).length
  const inboxExists = rawFiles.some((f) => f.isDirectory && f.name === INBOX_DIR)
  const isRoot = currentFolder === ''

  /* ---- Item click handler (modifier key support) ---- */
  function handleItemClick(item: FbFileItem, index: number, e: React.MouseEvent) {
    e.preventDefault()
    const meta = e.metaKey || e.ctrlKey

    if (e.shiftKey && lastClickedIndex.current >= 0) {
      // Range select from last clicked to current
      const lo = Math.min(lastClickedIndex.current, index)
      const hi = Math.max(lastClickedIndex.current, index)
      const paths = files.slice(lo, hi + 1).map((f) => f.path)
      if (meta) {
        // Extend existing selection
        const cur = new Set(Object.keys(selected))
        for (const p of paths) cur.add(p)
        useFileBrowserStore.getState().setSelectedPaths([...cur])
      } else {
        useFileBrowserStore.getState().setSelectedPaths(paths)
      }
    } else if (meta) {
      // Toggle this item
      useFileBrowserStore.getState().toggleSelected(item.path)
      lastClickedIndex.current = index
    } else {
      // Plain click: select only this
      useFileBrowserStore.getState().setSelectedPaths([item.path])
      lastClickedIndex.current = index
    }
  }

  /* ---- Rubber-band pointer handlers (on listScrollRef) ---- */
  function handleScrollPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.target as Node)) return
    if (skipRubberBandForRenameCloseRef.current) {
      skipRubberBandForRenameCloseRef.current = false
      const onItem = (e.target as Element).closest('[data-fb-item]')
      if (!onItem) clearSelection()
      return
    }
    if ((e.target as Element).closest('[data-fb-item]')) return
    if (e.button !== 0) return
    e.preventDefault()

    const el = listScrollRef.current!
    const rect = el.getBoundingClientRect()
    rbAnchor.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      contentX: e.clientX - rect.left,
      contentY: e.clientY - rect.top + el.scrollTop,
    }
    el.setPointerCapture(e.pointerId)
    clearSelection()
    lastClickedIndex.current = -1
  }

  function handleScrollPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!rbAnchor.current) return

    const el = listScrollRef.current!
    const rect = el.getBoundingClientRect()
    const curContentX = e.clientX - rect.left
    const curContentY = e.clientY - rect.top + el.scrollTop

    // Visual rect in fixed/window coords
    setRbRect({
      left: Math.min(rbAnchor.current.clientX, e.clientX),
      top: Math.min(rbAnchor.current.clientY, e.clientY),
      width: Math.abs(e.clientX - rbAnchor.current.clientX),
      height: Math.abs(e.clientY - rbAnchor.current.clientY),
    })

    // Intersection in content coords
    const rb = {
      x0: Math.min(rbAnchor.current.contentX, curContentX),
      y0: Math.min(rbAnchor.current.contentY, curContentY),
      x1: Math.max(rbAnchor.current.contentX, curContentX),
      y1: Math.max(rbAnchor.current.contentY, curContentY),
    }
    const paths = computeRubberBandSelection(
      files, rb, viewMode, gridColsRef.current, el.clientWidth,
    )
    useFileBrowserStore.getState().setSelectedPaths(paths)
  }

  function handleScrollPointerUp() {
    rbAnchor.current = null
    setRbRect(null)
  }

  /* ---- File operations ---- */
  function handleOpen(item: FbFileItem) {
    if (item.isDirectory) {
      setCurrentFolder(item.path)
      return
    }
    const editorType = editorTabTypeFromVaultPath(item.path)

    useUiStore.getState().setActiveView(ViewMode.Vault)
    useUiStore.getState().setVaultMode('tree')
    useFileTreeStore.getState().setSelectedPath(item.path)
    useEditorStore.getState().openTab({
      id: crypto.randomUUID(),
      path: item.path,
      type: editorType,
      title: titleFromVaultPath(item.path),
      isDirty: false,
    })
    useEditorStore.getState().addRecentFile(item.path)
  }

  function handleGoUp() {
    if (!currentFolder) return
    const parent = currentFolder.includes('/')
      ? currentFolder.slice(0, currentFolder.lastIndexOf('/'))
      : ''
    setCurrentFolder(parent)
  }

  function handleStartRename(item: FbFileItem) {
    setEditingPath(item.path)
  }

  async function handleCommitRename(item: FbFileItem, newName: string) {
    const sanitized = newName.replace(/[/\\:*?"<>|]/g, '').trim()
    if (!sanitized || sanitized === item.name) return
    const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''
    const newPath = parent ? `${parent}/${sanitized}` : sanitized
    if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, item.path)) {
      toast.error('A file with that name already exists')
      return
    }
    try {
      await vaultFs.rename(item.path, newPath)
      removeSearchDocument(item.path)
      if (newPath.endsWith('.md')) await reindexMarkdownPath(vaultFs, newPath)
      const tab = useEditorStore.getState().tabs.find((t) => t.path === item.path)
      if (tab) useEditorStore.getState().retargetTabPath(tab.id, newPath, titleFromVaultPath(newPath))
      setRefreshKey((n) => n + 1)
    } catch (e) {
      console.error('Rename failed', e)
      toast.error('Failed to rename file')
    }
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
      setRefreshKey((n) => n + 1)
      toast.success(`Imported ${count} file${count !== 1 ? 's' : ''}`)
    } catch (e) {
      console.error('Import failed', e)
      toast.error('Failed to import files')
    }
  }

  async function handleDropMove(srcPath: string, destFolder: string) {
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
      if (newPath.endsWith('.md')) await reindexMarkdownPath(vaultFs, newPath)
      const tab = useEditorStore.getState().tabs.find((t) => t.path === srcPath)
      if (tab) useEditorStore.getState().retargetTabPath(tab.id, newPath, titleFromVaultPath(newPath))
      setRefreshKey((n) => n + 1)
      toast.success(`Moved to ${destFolder || 'current folder'}`)
    } catch (e) {
      console.error('Move failed', e)
      toast.error('Failed to move file')
    }
  }

  async function handleDuplicate(item: FbFileItem) {
    const ext = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')) : ''
    const base = item.name.slice(0, item.name.length - ext.length)
    let destName = `${base} copy${ext}`
    let counter = 2
    const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''
    const destPath = () => (parent ? `${parent}/${destName}` : destName)
    while (await vaultFs.exists(destPath())) {
      destName = `${base} copy ${counter}${ext}`
      counter++
    }
    await vaultFs.copy(item.path, destPath())
    setRefreshKey((n) => n + 1)
  }

  function handleMove(item: FbFileItem) {
    setMovePaths([item.path])
  }

  function handleDelete(item: FbFileItem) {
    setDeletePaths([item.path])
  }

  function handleBatchDelete() {
    const paths = Object.keys(selected)
    if (paths.length) setDeletePaths(paths)
  }

  async function executeDelete() {
    const paths = deletePaths
    if (!paths) return
    for (const p of paths) {
      const f = rawFiles.find((x) => x.path === p)
      if (!f) continue
      if (f.isDirectory) await vaultFs.removeDir(p)
      else { removeSearchDocument(p); await vaultFs.remove(p) }
    }
    clearSelection()
    setRefreshKey((n) => n + 1)
  }

  function handleBatchMove() {
    const paths = Object.keys(selected)
    if (!paths.length) return
    setMovePaths(paths)
  }

  async function executeMoveToFolder(destFolder: string) {
    const paths = movePaths
    if (!paths) return
    const folder = destFolder.trim().replace(/^\/+|\/+$/g, '')
    if (folder) await vaultFs.mkdir(folder)
    try {
      for (const p of paths) {
        const name = p.split('/').pop() ?? p
        const newPath = folder ? `${folder}/${name}` : name
        if (vaultPathsPointToSameFile(newPath, p)) continue
        const item = rawFiles.find((f) => f.path === p)
        await vaultFs.rename(p, newPath)

        if (item?.isDirectory) {
          const { tabs, retargetTabPath } = useEditorStore.getState()
          for (const tab of tabs) {
            if (tab.path.startsWith(p + '/')) {
              const updated = newPath + tab.path.slice(p.length)
              retargetTabPath(tab.id, updated, titleFromVaultPath(updated))
            }
          }
        } else {
          removeSearchDocument(p)
          if (newPath.endsWith('.md')) await reindexMarkdownPath(vaultFs, newPath)
          const tab = useEditorStore.getState().tabs.find((t) => t.path === p)
          if (tab) useEditorStore.getState().retargetTabPath(tab.id, newPath, titleFromVaultPath(newPath))
        }
      }
    } catch (e) {
      console.error('Move failed', e)
      toast.error(e instanceof Error ? e.message : 'Failed to move items')
    }
    clearSelection()
    setRefreshKey((n) => n + 1)
  }

  function cycleSortField() {
    const fields: FbSortField[] = ['name', 'modifiedAt', 'size', 'type']
    const idx = fields.indexOf(sort.field)
    setSort({ field: fields[(idx + 1) % fields.length]!, dir: sort.dir })
  }

  function toggleSortDir() {
    setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
  }

  function toggleType(t: string) {
    setTypeFilter((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  async function handleInlineRenameFile(
    oldPath: string,
    newName: string,
    setPath: (p: string) => void,
  ) {
    const sanitized = newName.replace(/[/\\:*?"<>|]/g, '').trim()
    if (!sanitized) return
    const ext = oldPath.includes('.') ? oldPath.slice(oldPath.lastIndexOf('.')) : ''
    const fullName = sanitized.endsWith(ext) ? sanitized : `${sanitized}${ext}`
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = parent ? `${parent}/${fullName}` : fullName
    if (vaultPathsPointToSameFile(newPath, oldPath)) return
    if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, oldPath)) {
      toast.error('A file with that name already exists')
      return
    }
    try {
      await vaultFs.rename(oldPath, newPath)
      removeSearchDocument(oldPath)
      if (newPath.endsWith('.md')) await reindexMarkdownPath(vaultFs, newPath)
      const tab = useEditorStore.getState().tabs.find((t) => t.path === oldPath)
      if (tab) useEditorStore.getState().retargetTabPath(tab.id, newPath, titleFromVaultPath(newPath))
      setPath(newPath)
    } catch {
      toast.error('Failed to rename')
    }
  }

  /* ---- PDF sub-view ---- */
  if (openPdfPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-border bg-bg-secondary flex items-center gap-2 border-b px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpenPdfPath(null)}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <InlineFileTitle
            path={openPdfPath}
            autoFocus={newFilePath === openPdfPath}
            onFocused={() => setNewFilePath(null)}
            onRename={(oldPath, newName) =>
              void handleInlineRenameFile(oldPath, newName, setOpenPdfPath)
            }
          />
        </div>
        <PdfViewer path={openPdfPath} />
      </div>
    )
  }

  /* ---- Canvas sub-view ---- */
  if (openCanvasPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-border bg-bg-secondary flex items-center gap-2 border-b px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpenCanvasPath(null)}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <InlineFileTitle
            path={openCanvasPath}
            autoFocus={newFilePath === openCanvasPath}
            onFocused={() => setNewFilePath(null)}
            onRename={(oldPath, newName) =>
              void handleInlineRenameFile(oldPath, newName, setOpenCanvasPath)
            }
          />
        </div>
        <CanvasEditor
          key={openCanvasPath}
          tabId={`fb-canvas-${openCanvasPath}`}
          path={openCanvasPath}
        />
      </div>
    )
  }

  /* ---- Main browser ---- */
  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-4 p-6"
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
        if (e.dataTransfer.types.includes(FB_DND_TYPE) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
        }
      }}
      onDrop={(e) => {
        dragEnterCount.current = 0
        setExternalDragOver(false)
        if (e.dataTransfer.files.length > 0 && !e.dataTransfer.types.includes(FB_DND_TYPE)) {
          e.preventDefault()
          void handleExternalImport(e.dataTransfer.files, currentFolder)
          return
        }
        const src = e.dataTransfer.getData(FB_DND_TYPE)
        if (!src) return
        e.preventDefault()
        void handleDropMove(src, currentFolder)
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          e.preventDefault()
          selectAll(files.map((f) => f.path))
          lastClickedIndex.current = files.length - 1
        }
        if (e.key === 'Escape') clearSelection()
      }}
      tabIndex={-1}
    >
      {/* External drag overlay */}
      {externalDragOver && (
        <div className="border-accent bg-accent/10 pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed">
          <span className="text-accent text-sm font-semibold">Drop files to import</span>
          <span className="text-fg-muted text-xs">
            Files will be added to{' '}
            <span className="font-medium">{currentFolder || 'Root'}</span>
          </span>
        </div>
      )}

      {/* Rubber-band selection visual (fixed, window-absolute) */}
      {rbRect && rbRect.width > 2 && rbRect.height > 2 && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-blue-400/60 bg-blue-400/10"
          style={{
            left: rbRect.left,
            top: rbRect.top,
            width: rbRect.width,
            height: rbRect.height,
          }}
        />
      )}

      <header className="flex shrink-0 flex-wrap items-center gap-3">
        {!isRoot && (
          <Button variant="ghost" size="sm" onClick={handleGoUp} aria-label="Go up">
            <ChevronLeft className="size-4" />
          </Button>
        )}
        <h2 className="text-fg min-w-0 max-w-full truncate text-xl font-semibold tracking-tight">
          {currentFolder ? `${config.name} / ${currentFolder}` : config.name}
        </h2>

        <div className="ml-auto flex items-center gap-1.5">
          {isRoot && inboxExists && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentFolder(INBOX_DIR)}
            >
              <Inbox className="size-4" />
              Inbox
            </Button>
          )}
          <button
            type="button"
            onClick={() => setShowFilters((f) => !f)}
            className={cn('hover:bg-bg-hover rounded-md p-2', showFilters && 'bg-bg-active text-accent')}
            aria-label="Toggle filters"
          >
            <SlidersHorizontal className="size-4" />
          </button>
          <button
            type="button"
            onClick={cycleSortField}
            className="hover:bg-bg-hover text-fg-secondary rounded-md px-2 py-1.5 text-xs font-medium"
            title="Cycle sort field"
          >
            {SORT_LABELS[sort.field]}
          </button>
          <button
            type="button"
            onClick={toggleSortDir}
            className="hover:bg-bg-hover rounded-md p-2"
            aria-label={sort.dir === 'asc' ? 'Sort descending' : 'Sort ascending'}
          >
            {sort.dir === 'asc' ? <ArrowDownAZ className="size-4" /> : <ArrowUpZA className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="hover:bg-bg-hover rounded-md p-2"
            aria-label={viewMode === 'grid' ? 'Switch to list' : 'Switch to grid'}
          >
            {viewMode === 'grid' ? <List className="size-4" /> : <Grid2X2 className="size-4" />}
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="border-border bg-bg-secondary flex shrink-0 flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs">
          {['pdf', 'markdown', 'canvas', 'image', 'other'].map((t) => (
            <label key={t} className="text-fg-secondary flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={typeFilter.includes(t)}
                onChange={() => toggleType(t)}
                className="accent-accent"
              />
              {t === 'markdown' ? 'Notes' : t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      )}

      <FbBatchToolbar
        count={selectedCount}
        onMove={() => void handleBatchMove()}
        onDelete={() => void handleBatchDelete()}
        onClear={clearSelection}
      />

      <MoveToFolderDialog
        open={movePaths !== null}
        onOpenChange={(open) => { if (!open) setMovePaths(null) }}
        vaultFs={vaultFs}
        itemNames={movePaths?.map((p) => p.split('/').pop() ?? p) ?? []}
        onConfirm={(dest) => void executeMoveToFolder(dest)}
      />

      <ConfirmDialog
        open={deletePaths !== null}
        onOpenChange={(open) => { if (!open) setDeletePaths(null) }}
        title={
          deletePaths?.length === 1
            ? `Delete "${deletePaths[0].split('/').pop()}"?`
            : `Delete ${deletePaths?.length ?? 0} items?`
        }
        description="This action cannot be undone. The file(s) will be permanently removed from the vault."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void executeDelete()}
      />

      <div
        ref={listScrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerUp}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <p className="text-fg-muted text-sm">
              {currentFolder ? 'This folder is empty.' : 'No files in your vault yet.'}
            </p>
            <p className="text-fg-muted text-xs">Drop files here to import them.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <VirtualGrid
            files={files}
            scrollRef={listScrollRef}
            selected={selected}
            editingPath={editingPath}
            vaultFs={vaultFs}
            onOpen={handleOpen}
            onRename={(i) => void handleCommitRename(i, i.name)}
            onDuplicate={(i) => void handleDuplicate(i)}
            onMove={(i) => void handleMove(i)}
            onDelete={(i) => void handleDelete(i)}
            onItemClick={handleItemClick}
            onStartEdit={handleStartRename}
            onCommitEdit={(item, name) => void handleCommitRename(item, name)}
            onCancelEdit={() => setEditingPath(null)}
            onDropFile={(src, dest) => void handleDropMove(src, dest)}
            onDropExternalFiles={(f, dest) => void handleExternalImport(f, dest)}
            onColsChange={(c) => { gridColsRef.current = c }}
          />
        ) : (
          <VirtualList
            files={files}
            scrollRef={listScrollRef}
            selected={selected}
            editingPath={editingPath}
            vaultFs={vaultFs}
            onOpen={handleOpen}
            onRename={(i) => void handleCommitRename(i, i.name)}
            onDuplicate={(i) => void handleDuplicate(i)}
            onMove={(i) => void handleMove(i)}
            onDelete={(i) => void handleDelete(i)}
            onItemClick={handleItemClick}
            onStartEdit={handleStartRename}
            onCommitEdit={(item, name) => void handleCommitRename(item, name)}
            onCancelEdit={() => setEditingPath(null)}
            onDropFile={(src, dest) => void handleDropMove(src, dest)}
            onDropExternalFiles={(f, dest) => void handleExternalImport(f, dest)}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Virtualized sub-components                                          */
/* ------------------------------------------------------------------ */

interface VirtualProps {
  files: FbFileItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  selected: Record<string, true>
  editingPath: string | null
  vaultFs: FileSystemAdapter
  onOpen: (item: FbFileItem) => void
  onRename: (item: FbFileItem) => void
  onDuplicate: (item: FbFileItem) => void
  onMove: (item: FbFileItem) => void
  onDelete: (item: FbFileItem) => void
  onItemClick: (item: FbFileItem, index: number, e: React.MouseEvent) => void
  onStartEdit: (item: FbFileItem) => void
  onCommitEdit: (item: FbFileItem, newName: string) => void
  onCancelEdit: () => void
  onDropFile: (srcPath: string, destFolder: string) => void
  onDropExternalFiles: (files: FileList, destFolder: string) => void
}

function VirtualList({
  files, scrollRef, selected, editingPath, vaultFs,
  onOpen, onRename, onDuplicate, onMove, onDelete,
  onItemClick, onStartEdit, onCommitEdit, onCancelEdit,
  onDropFile, onDropExternalFiles,
}: VirtualProps) {
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const item = files[vi.index]!
        return (
          <div
            key={item.path}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%',
              transform: `translateY(${vi.start}px)`,
              height: vi.size,
            }}
          >
            <FbContextMenu
              item={item}
              onOpen={onOpen}
              onRename={onStartEdit}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onDelete={onDelete}
            >
              <FbFileRow
                item={item}
                vaultFs={vaultFs}
                isSelected={Boolean(selected[item.path])}
                isEditing={editingPath === item.path}
                onClick={(e) => onItemClick(item, vi.index, e)}
                onDoubleClick={() => onOpen(item)}
                onStartEdit={() => onStartEdit(item)}
                onCommitEdit={(name) => onCommitEdit(item, name)}
                onCancelEdit={onCancelEdit}
                onDropFile={onDropFile}
                onDropExternalFiles={onDropExternalFiles}
              />
            </FbContextMenu>
          </div>
        )
      })}
    </div>
  )
}

function VirtualGrid({
  files, scrollRef, selected, editingPath, vaultFs,
  onOpen, onRename, onDuplicate, onMove, onDelete,
  onItemClick, onStartEdit, onCommitEdit, onCancelEdit,
  onDropFile, onDropExternalFiles, onColsChange,
}: VirtualProps & { onColsChange?: (cols: number) => void }) {
  const [cols, setCols] = useState(3)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth - CARD_GAP
      const next = Math.max(1, Math.floor(w / (CARD_MIN_W + CARD_GAP)))
      setCols(next)
      onColsChange?.(next)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef, onColsChange])

  const rowCount = Math.ceil(files.length / cols)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT + CARD_GAP,
    overscan: 3,
  })

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const startIdx = vi.index * cols
        const rowItems = files.slice(startIdx, startIdx + cols)
        return (
          <div
            key={vi.index}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%',
              transform: `translateY(${vi.start}px)`,
              height: vi.size,
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: CARD_GAP,
              alignItems: 'start',
            }}
          >
            {rowItems.map((item, rowIdx) => {
              const absoluteIndex = startIdx + rowIdx
              return (
                <FbContextMenu
                  key={item.path}
                  item={item}
                  onOpen={onOpen}
                  onRename={onStartEdit}
                  onDuplicate={onDuplicate}
                  onMove={onMove}
                  onDelete={onDelete}
                >
                  <FbFileCard
                    item={item}
                    vaultFs={vaultFs}
                    isSelected={Boolean(selected[item.path])}
                    isEditing={editingPath === item.path}
                    onClick={(e) => onItemClick(item, absoluteIndex, e)}
                    onDoubleClick={() => onOpen(item)}
                    onStartEdit={() => onStartEdit(item)}
                    onCommitEdit={(name) => onCommitEdit(item, name)}
                    onCancelEdit={onCancelEdit}
                    onDropFile={onDropFile}
                    onDropExternalFiles={onDropExternalFiles}
                  />
                </FbContextMenu>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
