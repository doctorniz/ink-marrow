'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder, GitFork, Search } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import { NotesWorkspaceProvider, useNotesWorkspace } from '@/contexts/notes-workspace-context'
import { NotesFileTree } from '@/components/notes/notes-file-tree'
import { VaultLeftSearch } from '@/components/notes/vault-left-search'
import { EditorTabBar } from '@/components/notes/editor-tab-bar'
import {
  MarkdownNoteEditor,
  type MarkdownNoteEditorHandle,
} from '@/components/notes/markdown-note-editor'
import { ChatPanel } from '@/components/chat/chat-panel'
import { EditorRightColumn } from '@/components/notes/editor-right-column'
import { BacklinksSection } from '@/components/notes/backlinks-section'
import { ensureChatAssetIdForPath } from '@/lib/chat/asset-index'
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
import { CodeFileEditor } from '@/components/notes/code-file-editor'
import { DocxEditorView } from '@/components/notes/docx-editor'
import { SpreadsheetEditor } from '@/components/notes/spreadsheet-editor'
import { PptxEditorView } from '@/components/pptx/pptx-editor'
import { PptxCompactViewer } from '@/components/pptx/pptx-compact-viewer'
import { VideoPlayerView } from '@/components/notes/video-player-view'
import { AudioPlayerView } from '@/components/notes/audio-player-view'
import { MOBILE_NAV_MEDIA_QUERY, PPTX_COMPACT_MEDIA_QUERY, WIDE_EDITOR_MEDIA_QUERY, CANVAS_TREE_MEDIA_QUERY, CANVAS_SIDEBAR_MEDIA_QUERY } from '@/lib/browser/breakpoints'
import { useMediaQuery } from '@/lib/browser/use-media-query'
import { createUntitledNote } from '@/lib/notes/new-note'
import { detectEditorTabType, titleFromVaultPath } from '@/lib/notes/editor-tab-from-path'
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

function VideoPreviewTabPane({
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
      <div className="bg-bg flex min-h-0 flex-1 flex-col overflow-hidden">
        <VideoPlayerView vaultFs={vaultFs} path={path} title={titleFromVaultPath(path)} />
      </div>
    </div>
  )
}

function AudioPreviewTabPane({
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
      <div className="bg-bg flex min-h-0 flex-1 flex-col overflow-hidden">
        <AudioPlayerView vaultFs={vaultFs} path={path} title={titleFromVaultPath(path)} />
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
  const setActiveView = useUiStore((s) => s.setActiveView)

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

  // Collapsible backlinks section (lives inside the unified right column
  // for markdown tabs). Persisted so the user's choice survives reloads.
  const BACKLINKS_COLLAPSED_KEY = 'ink-marrow:backlinks-collapsed'
  const [backlinksCollapsed, setBacklinksCollapsed] = useState(true)
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(BACKLINKS_COLLAPSED_KEY)
      if (raw === '0') setBacklinksCollapsed(false)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(BACKLINKS_COLLAPSED_KEY, backlinksCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [backlinksCollapsed])

  // Chat collapsed state — collapsed = just a header bar at the bottom.
  const CHAT_COLLAPSED_KEY = 'ink-marrow:chat-collapsed'
  const [chatCollapsed, setChatCollapsed] = useState(true)
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_COLLAPSED_KEY)
      if (raw === '0') setChatCollapsed(false)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_COLLAPSED_KEY, chatCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [chatCollapsed])

  // Right column collapsed state — collapsed = thin rail with icons.
  const COLUMN_COLLAPSED_KEY = 'ink-marrow:right-column-collapsed'
  const [columnCollapsed, setColumnCollapsed] = useState(false)
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMN_COLLAPSED_KEY)
      if (raw === '1') setColumnCollapsed(true)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_COLLAPSED_KEY, columnCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [columnCollapsed])

  // Chat panel — always present in the right column. Markdown tabs use
  // frontmatter via `MarkdownNoteEditor.ensureChatAssetId`; PDFs use
  // `_marrow/_chats/index.json`. The asset id is resolved eagerly
  // whenever the active tab changes so chat is ready without a toggle.
  const markdownEditorRef = useRef<MarkdownNoteEditorHandle | null>(null)
  const [chatAssetIdByPath, setChatAssetIdByPath] = useState<Record<string, string>>({})

  // Auto-ensure chatAssetId for the active markdown tab.
  useEffect(() => {
    if (!activeTab || activeTab.type !== 'markdown') return
    // Wait a tick for the editor ref to be set by the MarkdownNoteEditor mount.
    const timer = setTimeout(() => {
      const id = markdownEditorRef.current?.ensureChatAssetId()
      if (id) {
        setChatAssetIdByPath((m) =>
          m[activeTab.path] === id ? m : { ...m, [activeTab.path]: id },
        )
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [activeTab?.path, activeTab?.type])

  // Auto-ensure chatAssetId for the active PDF tab.
  useEffect(() => {
    if (!activeTab || activeTab.type !== 'pdf') return
    if (chatAssetIdByPath[activeTab.path]) return
    void ensureChatAssetIdForPath(vaultFs, activeTab.path)
      .then((id) => {
        setChatAssetIdByPath((m) => ({ ...m, [activeTab.path]: id }))
      })
      .catch(() => {
        // Silently fail — chat will show "not configured" state.
      })
  }, [activeTab?.path, activeTab?.type, vaultFs])

  const isMobileTree = useMediaQuery(MOBILE_NAV_MEDIA_QUERY)
  const isPptxCompact = useMediaQuery(PPTX_COMPACT_MEDIA_QUERY)
  const isWideEditorNarrow = useMediaQuery(WIDE_EDITOR_MEDIA_QUERY)
  const isCanvasTreeNarrow = useMediaQuery(CANVAS_TREE_MEDIA_QUERY)
  const isCanvasSidebarNarrow = useMediaQuery(CANVAS_SIDEBAR_MEDIA_QUERY)
  const isPptxTab = activeTab?.type === 'pptx'
  const isCanvasTab = activeTab?.type === 'canvas'
  const isWideEditorTab = activeTab?.type === 'pptx' || activeTab?.type === 'docx' || activeTab?.type === 'spreadsheet'

  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const isSidebarOpen = useUiStore((s) => s.isSidebarOpen)
  const canvasSidebarAutoCollapsedRef = useRef(false)

  const [notesTreeExpanded, setNotesTreeExpanded] = useState(true)
  // Whether the user has manually toggled the tree (prevents auto-expand
  // from fighting the user's intent until the tab or breakpoint changes).
  const manualTreeToggleRef = useRef(false)

  useLayoutEffect(() => {
    setNotesTreeExpanded(!window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches)
  }, [])

  // Auto-collapse tree: mobile always; canvas at ≤1200px; wide editors at ≤1380px.
  // Skip if the user has manually toggled the tree (until the active tab changes).
  useEffect(() => {
    if (manualTreeToggleRef.current) return
    if (isMobileTree) setNotesTreeExpanded(false)
    else if (isCanvasTab && isCanvasTreeNarrow) setNotesTreeExpanded(false)
    else if (isWideEditorTab && isWideEditorNarrow) setNotesTreeExpanded(false)
    else setNotesTreeExpanded(true)
  }, [isMobileTree, isCanvasTab, isCanvasTreeNarrow, isWideEditorTab, isWideEditorNarrow])

  // Auto-collapse nav sidebar for canvas tabs at ≤1050px. Restores when
  // the tab changes away from canvas or the viewport widens again.
  useEffect(() => {
    if (!isCanvasTab) {
      if (canvasSidebarAutoCollapsedRef.current) {
        canvasSidebarAutoCollapsedRef.current = false
        setSidebarOpen(true)
      }
      return
    }
    if (isCanvasSidebarNarrow && isSidebarOpen) {
      canvasSidebarAutoCollapsedRef.current = true
      setSidebarOpen(false)
    } else if (!isCanvasSidebarNarrow && !isSidebarOpen && canvasSidebarAutoCollapsedRef.current) {
      canvasSidebarAutoCollapsedRef.current = false
      setSidebarOpen(true)
    }
  }, [isCanvasTab, isCanvasSidebarNarrow, isSidebarOpen, setSidebarOpen])

  // Reset the manual override when the active tab changes so auto-logic
  // kicks in again for the new tab.
  const prevTabIdRef = useRef(activeTabId)
  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      manualTreeToggleRef.current = false
      prevTabIdRef.current = activeTabId
    }
  }, [activeTabId])

  // Left panel: 'tree' shows the file tree, 'search' shows the search panel
  const [leftPanel, setLeftPanel] = useState<'tree' | 'search'>('tree')

  // Listen for Ctrl+F → open search panel (dispatched from AppShell)
  useEffect(() => {
    function onVaultSearchOpen() {
      setNotesTreeExpanded(true)
      setLeftPanel('search')
    }
    window.addEventListener('ink:vault-search-open', onVaultSearchOpen)
    return () => window.removeEventListener('ink:vault-search-open', onVaultSearchOpen)
  }, [])

  async function handleNewNote() {
    const path = await createUntitledNote(vaultFs)
    vaultChanged()
    openNotePath(path)
  }

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
    onRequestCollapse: () => { manualTreeToggleRef.current = true; setNotesTreeExpanded(false) },
    onSearchOpen: () => setLeftPanel('search'),
    onGraphOpen: () => { manualTreeToggleRef.current = true; setNotesTreeExpanded(false); setActiveView(ViewMode.Graph) },
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
            onClick={() => { manualTreeToggleRef.current = true; setNotesTreeExpanded(true); setLeftPanel('tree') }}
            aria-label="Open vault tree"
            title="Vault"
          >
            <Folder className="size-5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-fg size-9 shrink-0 p-0"
            onClick={() => { manualTreeToggleRef.current = true; setNotesTreeExpanded(true); setLeftPanel('search') }}
            aria-label="Search vault"
            title="Search (Ctrl+F)"
          >
            <Search className="size-5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-fg-muted hover:text-fg size-9 shrink-0 p-0"
            onClick={() => setActiveView(ViewMode.Graph)}
            aria-label="Open graph"
            title="Graph"
          >
            <GitFork className="size-5" aria-hidden />
          </Button>
        </div>
      )}

      {notesTreeExpanded && !isMobileTree && (
        leftPanel === 'search'
          ? <VaultLeftSearch onClose={() => setLeftPanel('tree')} />
          : <NotesFileTree {...treeProps} />
      )}

      {isMobileTree && notesTreeExpanded && (
        <>
          <button
            type="button"
            className="absolute inset-0 z-[15] bg-black/20"
            aria-label="Close vault tree"
            onClick={() => { manualTreeToggleRef.current = true; setNotesTreeExpanded(false) }}
          />
          <div className="border-border bg-bg absolute top-0 left-0 z-20 flex h-full w-[min(100%,280px)] max-w-[min(100vw-2rem,280px)] flex-col border-r shadow-lg">
            {leftPanel === 'search'
              ? <VaultLeftSearch
                  onClose={() => setLeftPanel('tree')}
                  rootClassName="h-full w-full min-w-0 max-w-none shrink-0 border-r-0"
                />
              : <NotesFileTree
                  {...treeProps}
                  rootClassName="h-full w-full min-w-0 max-w-none shrink-0 border-r-0"
                />
            }
          </div>
        </>
      )}

      <div className="bg-bg flex min-h-0 min-w-0 flex-1 flex-col">
        <EditorTabBar />
        {activeTab?.type === 'markdown' ? (
          <div className="relative flex min-h-0 flex-1">
            <EditorRightColumn
              storageKey="ink-marrow:right-panel-width:md"
              defaultRightPx={360}
              minRightPx={240}
              maxRightRatio={0.6}
              columnCollapsed={columnCollapsed}
              onColumnCollapsedChange={setColumnCollapsed}
              chat={
                chatAssetIdByPath[activeTab.path] ? (
                  <ChatPanel
                    chatAssetId={chatAssetIdByPath[activeTab.path]}
                    documentPath={activeTab.path}
                    collapsed={chatCollapsed}
                    onCollapsedChange={setChatCollapsed}
                  />
                ) : null
              }
              trailing={
                <BacklinksSection
                  vaultFs={vaultFs}
                  markdownPaths={markdownPaths}
                  activeNotePath={activeTab.path}
                  scanPulse={scanPulse}
                  onOpenNote={openNotePath}
                  collapsed={backlinksCollapsed}
                  onCollapsedChange={setBacklinksCollapsed}
                  maxExpandedHeightClass={
                    !chatCollapsed ? 'max-h-[40%]' : 'flex-1'
                  }
                />
              }
            >
              <MarkdownNoteEditor
                key={activeTab.id}
                ref={markdownEditorRef}
                tabId={activeTab.id}
                path={activeTab.path}
                markdownPaths={markdownPaths}
                onOpenNotePath={openNotePath}
                onPersisted={bumpScan}
                onRenamed={vaultChanged}
              />
            </EditorRightColumn>
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
          <div key={activeTab.id} className="relative flex min-h-0 flex-1">
            <EditorRightColumn
              storageKey="ink-marrow:right-panel-width:pdf"
              defaultRightPx={420}
              minRightPx={300}
              maxRightRatio={0.6}
              columnCollapsed={columnCollapsed}
              onColumnCollapsedChange={setColumnCollapsed}
              chat={
                chatAssetIdByPath[activeTab.path] ? (
                  <ChatPanel
                    chatAssetId={chatAssetIdByPath[activeTab.path]}
                    documentPath={activeTab.path}
                    collapsed={chatCollapsed}
                    onCollapsedChange={setChatCollapsed}
                  />
                ) : null
              }
            >
              <PdfViewer path={activeTab.path} />
            </EditorRightColumn>
          </div>
        ) : activeTab?.type === 'canvas' ? (
          <div key={activeTab.id} className="min-h-0 flex-1">
            <CanvasEditor
              tabId={activeTab.id}
              path={activeTab.path}
              isNew={activeTab.isNew}
              onRenamed={vaultChanged}
              onPersisted={bumpScan}
              onRename={(tabId, oldPath, stem, ext) =>
                void handleRenameVaultFile(tabId, oldPath, stem, ext)
              }
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
        ) : activeTab?.type === 'video' ? (
          <VideoPreviewTabPane
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRename={(tabId, oldPath, stem, ext) =>
              void handleRenameVaultFile(tabId, oldPath, stem, ext)
            }
          />
        ) : activeTab?.type === 'audio' ? (
          <AudioPreviewTabPane
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRename={(tabId, oldPath, stem, ext) =>
              void handleRenameVaultFile(tabId, oldPath, stem, ext)
            }
          />
        ) : activeTab?.type === 'code' ? (
          <CodeFileEditor
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRenamed={vaultChanged}
          />
        ) : activeTab?.type === 'docx' ? (
          <DocxEditorView
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRenamed={vaultChanged}
            onPersisted={vaultChanged}
          />
        ) : activeTab?.type === 'pptx' ? (
          isPptxCompact ? (
            <PptxCompactViewer
              key={`${activeTab.id}-compact`}
              path={activeTab.path}
            />
          ) : (
            <PptxEditorView
              key={activeTab.id}
              tabId={activeTab.id}
              path={activeTab.path}
              onRenamed={vaultChanged}
              onPersisted={bumpScan}
            />
          )
        ) : activeTab?.type === 'spreadsheet' ? (
          <SpreadsheetEditor
            key={activeTab.id}
            tabId={activeTab.id}
            path={activeTab.path}
            onRenamed={vaultChanged}
            onPersisted={bumpScan}
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
