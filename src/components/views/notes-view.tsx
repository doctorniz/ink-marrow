'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import { NotesWorkspaceProvider, useNotesWorkspace } from '@/contexts/notes-workspace-context'
import { NotesFileTree } from '@/components/notes/notes-file-tree'
import { EditorTabBar } from '@/components/notes/editor-tab-bar'
import { MarkdownNoteEditor } from '@/components/notes/markdown-note-editor'
import {
  BacklinksPanel,
  BACKLINKS_NARROW_MEDIA_QUERY,
} from '@/components/notes/backlinks-panel'
import { PdfViewer } from '@/components/pdf/pdf-viewer'
import { CanvasEditor } from '@/components/canvas/canvas-editor'
import { KanbanEditor } from '@/components/kanban/kanban-editor'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { useUiStore } from '@/stores/ui'
import { ViewMode } from '@/types/vault'
import { Button } from '@/components/ui/button'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { ImageEditorView } from '@/components/notes/image-editor-view'
import { MOBILE_NAV_MEDIA_QUERY } from '@/lib/browser/breakpoints'
import { useMediaQuery } from '@/lib/browser/use-media-query'
import { createUntitledNote } from '@/lib/notes/new-note'
import { openOrCreateDailyNote } from '@/lib/notes/daily-note'
import { detectEditorTabType, editorTabTypeFromVaultPath, titleFromVaultPath } from '@/lib/notes/editor-tab-from-path'
import { toast } from '@/stores/toast'
import { removeSearchDocument } from '@/lib/search/index'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'

function stemFromVaultPath(path: string): string {
  return path.replace(/\.[^/.]+$/i, '').split('/').pop() ?? path
}

function starredStorageKey(vaultPath: string) {
  return `ink-marrow:starred:${vaultPath}`
}

function imageExtFromPath(path: string): string {
  const n = path.split('/').pop() ?? path
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i) : ''
}

function ImagePreviewTabPane({
  tabId,
  path,
  onRename,
}: {
  tabId: string
  path: string
  onRename: (tabId: string, oldPath: string, stem: string, ext: string) => void
}) {
  const { vaultFs } = useVaultSession()
  const ext = imageExtFromPath(path)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <InlineFileTitle
          path={path}
          onRename={(oldPath, newStem) => void onRename(tabId, oldPath, newStem, ext)}
        />
      </div>
      <div className="bg-bg flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <ImageEditorView vaultFs={vaultFs} path={path} title={titleFromVaultPath(path)} />
      </div>
    </div>
  )
}

export function NotesView() {
  const { vaultFs } = useVaultSession()
  return (
    <NotesWorkspaceProvider vaultFs={vaultFs}>
      <NotesViewInner />
    </NotesWorkspaceProvider>
  )
}

function NotesViewInner() {
  const [treeRefresh, setTreeRefresh] = useState(0)
  const [scanPulse, setScanPulse] = useState(0)
  const { vaultFs, vaultPath } = useVaultSession()
  const { markdownPaths, refreshMarkdownPaths } = useNotesWorkspace()

  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const openTab = useEditorStore((s) => s.openTab)
  const addRecentFile = useEditorStore((s) => s.addRecentFile)
  const clearNew = useEditorStore((s) => s.clearNew)
  const retargetTabPath = useEditorStore((s) => s.retargetTabPath)
  const setSelectedPath = useFileTreeStore((s) => s.setSelectedPath)
  const starredPaths = useFileTreeStore((s) => s.starredPaths)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const starredList = useMemo(
    () => starredPaths,
    [starredPaths],
  )

  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(starredStorageKey(vaultPath))
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          useFileTreeStore.setState({ starredPaths: parsed.filter((x) => typeof x === 'string') })
        }
      } else {
        useFileTreeStore.setState({ starredPaths: [] })
      }
    } catch {
      useFileTreeStore.setState({ starredPaths: [] })
    }
  }, [vaultPath])

  useEffect(() => {
    localStorage.setItem(starredStorageKey(vaultPath), JSON.stringify(starredPaths))
  }, [vaultPath, starredPaths])

  async function handleRenameVaultFile(
    tabId: string,
    oldPath: string,
    newNameStem: string,
    ext: string,
  ) {
    const sanitized = newNameStem.replace(/[/\\:*?"<>|]/g, '').trim()
    if (!sanitized) return
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
      retargetTabPath(tabId, newPath, stemFromVaultPath(newPath))
      setSelectedPath(newPath)
      vaultChanged()
    } catch {
      toast.error('Failed to rename')
    }
  }

  const vaultChanged = useCallback(() => {
    setTreeRefresh((n) => n + 1)
    void refreshMarkdownPaths()
  }, [refreshMarkdownPaths])

  const openNotePath = useCallback(
    (path: string) => {
      setSelectedPath(path)
      addRecentFile(path)

      void (async () => {
        const type = await detectEditorTabType(vaultFs, path)
        openTab({
          id: crypto.randomUUID(),
          path,
          type,
          title: titleFromVaultPath(path),
          isDirty: false,
        })
      })()
    },
    [addRecentFile, openTab, setSelectedPath, vaultFs],
  )

  const bumpScan = useCallback(() => {
    setScanPulse((n) => n + 1)
    // Notify the graph view (and any other listener) that vault content changed
    window.dispatchEvent(new CustomEvent('ink:vault-changed'))
  }, [])

  const isNarrowBacklinks = useMediaQuery(BACKLINKS_NARROW_MEDIA_QUERY)
  const [backlinksExpanded, setBacklinksExpanded] = useState(true)
  useLayoutEffect(() => {
    setBacklinksExpanded(!window.matchMedia(BACKLINKS_NARROW_MEDIA_QUERY).matches)
  }, [])
  useEffect(() => {
    if (isNarrowBacklinks) setBacklinksExpanded(false)
  }, [isNarrowBacklinks])

  const isMobileTree = useMediaQuery(MOBILE_NAV_MEDIA_QUERY)
  const [notesTreeExpanded, setNotesTreeExpanded] = useState(true)
  useLayoutEffect(() => {
    setNotesTreeExpanded(!window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches)
  }, [])
  useEffect(() => {
    if (isMobileTree) setNotesTreeExpanded(false)
    else setNotesTreeExpanded(true)
  }, [isMobileTree])

  async function handleNewNote() {
    const path = await createUntitledNote(vaultFs)
    vaultChanged()
    openNotePath(path)
  }

  const handleDailyNote = useCallback(async () => {
    const path = await openOrCreateDailyNote(vaultFs)
    vaultChanged()
    openNotePath(path)
  }, [vaultFs, vaultChanged, openNotePath])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        void handleDailyNote()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleDailyNote])

  // Refresh the tree whenever any part of the app creates/renames/deletes a vault file
  useEffect(() => {
    const handler = () => vaultChanged()
    window.addEventListener('ink:vault-changed', handler)
    return () => window.removeEventListener('ink:vault-changed', handler)
  }, [vaultChanged])

  const treeProps = {
    vaultFs,
    refreshToken: treeRefresh,
    starredPaths: starredList,
    onNoteCreated: () => {
      vaultChanged()
    },
    onDailyNote: () => void handleDailyNote(),
    onRequestCollapse: () => setNotesTreeExpanded(false),
  }

  return (
    <div className="relative flex h-full min-h-0 w-full">
      {!notesTreeExpanded && (
        <div className="border-border bg-bg flex h-full w-10 shrink-0 flex-col items-center border-r pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-fg size-9 shrink-0 p-0"
            onClick={() => setNotesTreeExpanded(true)}
            aria-label="Open vault tree"
            title="Vault"
          >
            <Folder className="size-5" aria-hidden />
          </Button>
        </div>
      )}

      {notesTreeExpanded && !isMobileTree && <NotesFileTree {...treeProps} />}

      {isMobileTree && notesTreeExpanded && (
        <>
          <button
            type="button"
            className="absolute inset-0 z-[15] bg-black/20"
            aria-label="Close vault tree"
            onClick={() => setNotesTreeExpanded(false)}
          />
          <div className="border-border bg-bg absolute top-0 left-0 z-20 flex h-full w-[min(100%,280px)] max-w-[min(100vw-2rem,280px)] flex-col border-r shadow-lg">
            <NotesFileTree
              {...treeProps}
              rootClassName="h-full w-full min-w-0 max-w-none shrink-0 border-r-0"
            />
          </div>
        </>
      )}

      <div className="bg-bg flex min-w-0 flex-1 flex-col">
        <EditorTabBar />
        {activeTab?.type === 'markdown' ? (
          <div className="relative flex min-h-0 flex-1">
            {isNarrowBacklinks && backlinksExpanded && (
              <button
                type="button"
                className="absolute inset-0 z-10 bg-black/20"
                aria-label="Close backlinks panel"
                onClick={() => setBacklinksExpanded(false)}
              />
            )}
            <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col">
              <MarkdownNoteEditor
                key={activeTab.id}
                tabId={activeTab.id}
                path={activeTab.path}
                markdownPaths={markdownPaths}
                onOpenNotePath={openNotePath}
                onPersisted={bumpScan}
                onRenamed={vaultChanged}
              />
            </div>
            <BacklinksPanel
              vaultFs={vaultFs}
              markdownPaths={markdownPaths}
              activeNotePath={activeTab.path}
              scanPulse={scanPulse}
              onOpenNote={openNotePath}
              expanded={backlinksExpanded}
              onExpandedChange={setBacklinksExpanded}
              isNarrow={isNarrowBacklinks}
            />
          </div>
        ) : activeTab?.type === 'kanban' ? (
          <div key={activeTab.id} className="min-h-0 flex-1">
            <KanbanEditor
              tabId={activeTab.id}
              path={activeTab.path}
              isNew={activeTab.isNew}
              onRenamed={vaultChanged}
              onPersisted={bumpScan}
            />
          </div>
        ) : activeTab?.type === 'pdf' ? (
          <div key={activeTab.id} className="min-h-0 flex-1">
            <PdfViewer path={activeTab.path} />
          </div>
        ) : activeTab?.type === 'canvas' ? (
          <div key={activeTab.id} className="min-h-0 flex-1">
            <CanvasEditor
              tabId={activeTab.id}
              path={activeTab.path}
              isNew={activeTab.isNew}
              onRenamed={vaultChanged}
              onPersisted={bumpScan}
            />
          </div>
        ) : activeTab?.type === 'image' ? (
          <ImagePreviewTabPane
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRename={(tabId, oldPath, stem, ext) =>
              void handleRenameVaultFile(tabId, oldPath, stem, ext)
            }
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8">
            <div className="bg-bg-tertiary flex size-16 items-center justify-center rounded-2xl">
              <FileText className="text-fg-muted size-8 stroke-[1.25]" aria-hidden />
            </div>
            <div className="max-w-xs text-center">
              <p className="text-fg text-sm font-semibold">No file open</p>
              <p className="text-fg-secondary mt-1.5 text-sm leading-relaxed">
                Pick a file from the sidebar or create a new one. Edits auto-save.
              </p>
            </div>
            <Button type="button" onClick={() => void handleNewNote()}>
              New note
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
