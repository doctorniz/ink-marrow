'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { getNoteEditorExtensions } from '@/lib/editor/tiptap-extensions'
import { setImageVaultFs } from '@/lib/editor/vault-image-extension'
import { setPdfEmbedVaultFs } from '@/lib/editor/pdf-embed-extension'
import { markdownToTiptapJSON, tiptapJSONToMarkdown } from '@/lib/editor/markdown-bridge'
import { parseNote, resolveWikiLinkPath, serializeNote } from '@/lib/markdown'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'
import { removeSearchDocument } from '@/lib/search/index'
import { saveAsset, isImagePath } from '@/lib/notes/assets'
import { buildExportHtml, printExportHtml } from '@/lib/notes/export-pdf'
import { downloadTextFile } from '@/lib/browser/download-file'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import type { NoteFrontmatter } from '@/types/editor'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { toast } from '@/stores/toast'
import { cn } from '@/utils/cn'
import { NoteEditorToolbar } from '@/components/notes/note-editor-toolbar'
import { NoteEditorModeBar } from '@/components/notes/note-editor-mode-bar'
import { useSyncPush } from '@/contexts/sync-context'

function titleFromPath(p: string): string {
  return p.replace(/\.md$/i, '').split('/').pop() ?? p
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/** Strip characters that are illegal in file names on any major OS */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[/\\:*?"<>|]/g, '')   // illegal on Windows / POSIX
    .replace(/\s+/g, ' ')            // collapse runs of whitespace
    .trim()
}

export interface MarkdownNoteEditorHandle {
  /**
   * Returns the document's `chatAssetId`, minting a new UUID into the
   * in-memory frontmatter and scheduling a save if one wasn't already
   * present. Used by the chat panel to find its sidecar folder.
   */
  ensureChatAssetId: () => string
}

export const MarkdownNoteEditor = forwardRef<
  MarkdownNoteEditorHandle,
  {
    tabId: string
    path: string
    markdownPaths: string[]
    onOpenNotePath: (path: string) => void
    onPersisted?: () => void
    onRenamed?: () => void
  }
>(function MarkdownNoteEditor(
  { tabId, path, markdownPaths, onOpenNotePath, onPersisted, onRenamed },
  ref,
) {
  const { vaultFs } = useVaultSession()
  const syncPush = useSyncPush()
  const markDirty = useEditorStore((s) => s.markDirty)
  const updateTab = useEditorStore((s) => s.updateTab)
  const showRawSource = useEditorStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.showRawSource ?? false,
  )
  const isNew = useEditorStore((s) => s.tabs.find((t) => t.id === tabId)?.isNew ?? false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [rawText, setRawText] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [inlineTitle, setInlineTitle] = useState(() => titleFromPath(path))
  const inlineTitleRef = useRef(inlineTitle)
  inlineTitleRef.current = inlineTitle
  const pathsRef = useRef(markdownPaths)
  const pathRef = useRef(path)
  const onOpenNotePathRef = useRef(onOpenNotePath)
  const onPersistedRef = useRef(onPersisted)
  pathsRef.current = markdownPaths
  pathRef.current = path
  onOpenNotePathRef.current = onOpenNotePath
  onPersistedRef.current = onPersisted

  useEffect(() => {
    setImageVaultFs(vaultFs)
    setPdfEmbedVaultFs(vaultFs)
  }, [vaultFs])

  const extensions = useMemo(
    () =>
      getNoteEditorExtensions(
        'Write something…',
        {
          getMarkdownPaths: () => pathsRef.current,
          currentNotePath: () => pathRef.current,
        },
        { liveEditor: true },
      ),
    [],
  )
  const editorRef = useRef<Editor | null>(null)
  const loadingRef = useRef(true)
  const frontmatterRef = useRef<NoteFrontmatter>({})
  /**
   * Holds a `chatAssetId` minted before the on-disk frontmatter has
   * finished loading. The bootstrap effect merges it into
   * `frontmatterRef.current` once the disk state is available so the
   * next save carries the id to disk.
   */
  const pendingChatAssetIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabIdRef = useRef(tabId)
  const showRawRef = useRef(showRawSource)
  const rawTextRef = useRef('')

  pathRef.current = path
  tabIdRef.current = tabId
  showRawRef.current = showRawSource
  rawTextRef.current = rawText

  const scheduleSaveRef = useRef<() => void>(() => {})

  scheduleSaveRef.current = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void (async () => {
        try {
          if (showRawRef.current) {
            await vaultFs.writeTextFile(pathRef.current, rawTextRef.current)
          } else {
            const ed = editorRef.current
            if (!ed || loadingRef.current) return
            const body = tiptapJSONToMarkdown(ed.getJSON())
            const raw = serializeNote(frontmatterRef.current, body)
            await vaultFs.writeTextFile(pathRef.current, raw)
          }
          syncPush(pathRef.current)
          markDirty(tabIdRef.current, false)
          onPersistedRef.current?.()
        } catch (e) {
          console.error('Save failed', e)
          toast.error('Failed to save note')
        }
      })()
    }, 750)
  }

  const insertImageFiles = useRef(async (files: File[], editorInstance: Editor) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        const assetPath = await saveAsset(vaultFs, file.name, data)
        editorInstance.chain().focus().insertContent({
          type: 'image',
          attrs: { src: assetPath, alt: file.name },
        }).run()
      } catch (e) {
        console.error('Failed to save image asset', e)
        toast.error('Failed to embed image')
      }
    }
  })

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: {
      attributes: {
        class: cn(
          'tiptap-editor focus:outline-none',
          'min-h-[min(480px,calc(100vh-14rem))] flex-1 px-10 pb-6 pt-2',
        ),
        'aria-label': 'Note content',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        const images = files.filter((f) => f.type.startsWith('image/'))
        if (images.length === 0) return false
        event.preventDefault()
        const ed = editorRef.current
        if (ed) void insertImageFiles.current(images, ed)
        return true
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? [])
        const images = files.filter((f) => f.type.startsWith('image/'))
        if (images.length === 0) return false
        event.preventDefault()
        const ed = editorRef.current
        if (ed) void insertImageFiles.current(images, ed)
        return true
      },
      handleDOMEvents: {
        click(_view, event) {
          const el = (event.target as HTMLElement).closest('[data-type="wiki-link"]')
          if (el && event.button === 0) {
            event.preventDefault()
            const rawTarget = el.getAttribute('data-target')?.trim()
            if (rawTarget) {
              const pageRef = rawTarget.match(/^(.*)#page=(\d+(?:-\d+)?)$/)
              const stem = pageRef ? pageRef[1]!.trim() : rawTarget
              const resolved = resolveWikiLinkPath(stem, pathsRef.current)
              if (resolved) onOpenNotePathRef.current(resolved)
            }
            return true
          }
          return false
        },
      },
    },
    onUpdate: () => {
      if (loadingRef.current || showRawRef.current) return
      markDirty(tabIdRef.current, true)
      scheduleSaveRef.current()
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Imperative handle for the chat panel: mint `chatAssetId` on demand
  // and schedule a save so the UUID lands in frontmatter on disk. Minting
  // is one-shot — subsequent calls return the same id that's already in
  // `frontmatterRef.current`.
  useImperativeHandle(
    ref,
    () => ({
      ensureChatAssetId: () => {
        const existing = frontmatterRef.current.chatAssetId
        if (typeof existing === 'string' && existing.length > 0) {
          return existing
        }
        if (pendingChatAssetIdRef.current) return pendingChatAssetIdRef.current

        const id = crypto.randomUUID()
        if (loadingRef.current) {
          // Bootstrap hasn't loaded the on-disk frontmatter yet — stash
          // the id; the load effect will merge it on completion.
          pendingChatAssetIdRef.current = id
          return id
        }
        frontmatterRef.current = {
          ...frontmatterRef.current,
          chatAssetId: id,
        }
        markDirty(tabIdRef.current, true)
        scheduleSaveRef.current()
        return id
      },
    }),
    [markDirty],
  )

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!showRawSource)
  }, [editor, showRawSource])

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    loadingRef.current = true

    setIsBootstrapping(true)
    void (async () => {
      try {
        const fileRaw = await vaultFs.readTextFile(path)
        if (cancelled) return
        const doc = parseNote(path, fileRaw)
        // If chat minted an id while we were loading, merge it in now
        // and schedule a save so the id lands on disk.
        if (
          pendingChatAssetIdRef.current &&
          !doc.frontmatter.chatAssetId
        ) {
          doc.frontmatter.chatAssetId = pendingChatAssetIdRef.current
          markDirty(tabIdRef.current, true)
          scheduleSaveRef.current()
        }
        pendingChatAssetIdRef.current = null
        frontmatterRef.current = doc.frontmatter
        const title =
          (typeof doc.frontmatter.title === 'string' && doc.frontmatter.title) ||
          path.replace(/\.md$/i, '').split('/').pop() ||
          path

        const inRawMode =
          useEditorStore.getState().tabs.find((t) => t.id === tabId)?.showRawSource ?? false

        if (inRawMode) {
          setRawText(fileRaw)
        } else {
          const json = markdownToTiptapJSON(doc.content)
          editor.commands.setContent(json, false)
        }
        setInlineTitle(title)
        updateTab(tabId, { title, isDirty: false })
      } catch (e) {
        console.error(e)
        toast.error('Failed to load note')
        if (!useEditorStore.getState().tabs.find((t) => t.id === tabId)?.showRawSource) {
          editor.commands.setContent(markdownToTiptapJSON(''), false)
        } else {
          setRawText('')
        }
      } finally {
        if (!cancelled) {
          loadingRef.current = false
          setIsBootstrapping(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (pathRef.current !== path) return
      const ed = editorRef.current
      void (async () => {
        try {
          if (showRawRef.current) {
            await vaultFs.writeTextFile(path, rawTextRef.current)
          } else if (ed && !loadingRef.current) {
            const body = tiptapJSONToMarkdown(ed.getJSON())
            const raw = serializeNote(frontmatterRef.current, body)
            await vaultFs.writeTextFile(path, raw)
          }
        } catch (e) {
          console.error('Save on close failed', e)
          toast.error('Could not save note before closing')
        }
      })()
    }
  }, [editor, path, vaultFs, tabId, updateTab])

  // Auto-focus and select the title for newly created notes
  const clearNew = useEditorStore((s) => s.clearNew)
  useEffect(() => {
    if (!isBootstrapping && isNew) {
      requestAnimationFrame(() => {
        const input = titleInputRef.current
        if (input) {
          input.focus()
          input.select()
        }
      })
      clearNew(tabId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBootstrapping, isNew])

  function handleShowRaw() {
    const ed = editorRef.current
    if (!ed || loadingRef.current) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const body = tiptapJSONToMarkdown(ed.getJSON())
    setRawText(serializeNote(frontmatterRef.current, body))
    updateTab(tabId, { showRawSource: true })
    markDirty(tabId, false)
  }

  function handleShowVisual() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    void (async () => {
      try {
        const latest = rawTextRef.current
        await vaultFs.writeTextFile(pathRef.current, latest)
        const doc = parseNote(pathRef.current, latest)
        frontmatterRef.current = doc.frontmatter
        const ed = editorRef.current
        if (ed) {
          ed.commands.setContent(markdownToTiptapJSON(doc.content), false)
        }
        const title =
          (typeof doc.frontmatter.title === 'string' && doc.frontmatter.title) ||
          pathRef.current.replace(/\.md$/i, '').split('/').pop() ||
          pathRef.current
        updateTab(tabId, { showRawSource: false, title, isDirty: false })
        onPersistedRef.current?.()
        void reindexMarkdownPath(vaultFs, pathRef.current)
      } catch (e) {
        console.error(e)
        toast.error('Failed to switch to visual mode')
      }
    })()
  }

  function handleRawChange(next: string) {
    setRawText(next)
    markDirty(tabId, true)
    scheduleSaveRef.current()
  }

  const commitTitleRename = useCallback(async () => {
    const sanitized = sanitizeTitle(inlineTitleRef.current)
    const currentTitle = titleFromPath(pathRef.current)

    // Always show the sanitized value (strips illegal chars that may have been typed)
    if (sanitized !== inlineTitleRef.current) setInlineTitle(sanitized)

    if (!sanitized || sanitized === currentTitle) {
      setInlineTitle(currentTitle)
      return
    }

    const fileName = sanitized.endsWith('.md') ? sanitized : `${sanitized}.md`
    const parent = parentDir(pathRef.current)
    const newPath = joinPath(parent, fileName)
    if (vaultPathsPointToSameFile(newPath, pathRef.current)) return

    if (
      (await vaultFs.exists(newPath)) &&
      !vaultPathsPointToSameFile(newPath, pathRef.current)
    ) {
      toast.error('A note with that name already exists')
      setInlineTitle(currentTitle)
      return
    }

    try {
      // Cancel any pending auto-save so we control the final write
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      // Build the updated file content with the new title in the frontmatter
      const updatedFrontmatter: typeof frontmatterRef.current = {
        ...frontmatterRef.current,
        title: sanitized,
      }
      let fileContent: string
      const ed = editorRef.current
      if (showRawRef.current) {
        // In raw mode, re-parse to extract just the body then re-serialize with new fm
        const { content: body } = parseNote(pathRef.current, rawTextRef.current)
        fileContent = serializeNote(updatedFrontmatter, body)
      } else if (ed && !loadingRef.current) {
        const body = tiptapJSONToMarkdown(ed.getJSON())
        fileContent = serializeNote(updatedFrontmatter, body)
      } else {
        fileContent = serializeNote(updatedFrontmatter, '')
      }

      // Write the updated content THEN rename — loading effect will pick up the
      // correct title from frontmatter when it re-runs after the path changes.
      await vaultFs.writeTextFile(pathRef.current, fileContent)
      frontmatterRef.current = updatedFrontmatter

      await vaultFs.rename(pathRef.current, newPath)
      removeSearchDocument(pathRef.current)
      await reindexMarkdownPath(vaultFs, newPath)

      useEditorStore.getState().retargetTabPath(tabIdRef.current, newPath, sanitized)
      const sel = useFileTreeStore.getState().selectedPath
      if (sel === pathRef.current) useFileTreeStore.getState().setSelectedPath(newPath)

      setInlineTitle(sanitized)
      onRenamed?.()
    } catch (e) {
      console.error('Rename failed', e)
      toast.error('Failed to rename note')
      setInlineTitle(currentTitle)
    }
  }, [vaultFs, onRenamed])

  function getTiptapDocForExport(): JSONContent | null {
    if (loadingRef.current) return null
    if (showRawSource) {
      const doc = parseNote(pathRef.current, rawTextRef.current)
      return markdownToTiptapJSON(doc.content)
    }
    const ed = editorRef.current
    if (!ed) return null
    return ed.getJSON()
  }

  function buildMarkdownExportContent(): string | null {
    if (loadingRef.current) return null
    if (showRawSource) return rawTextRef.current
    const ed = editorRef.current
    if (!ed) return null
    const body = tiptapJSONToMarkdown(ed.getJSON())
    return serializeNote(frontmatterRef.current, body)
  }

  function handleExportMarkdown() {
    const content = buildMarkdownExportContent()
    if (content == null) {
      toast.error('Nothing to export yet')
      return
    }
    const baseName = path.split('/').pop() ?? 'note.md'
    downloadTextFile(baseName, content, 'text/markdown;charset=utf-8')
  }

  async function handlePrint() {
    const docJson = getTiptapDocForExport()
    if (!docJson) {
      toast.error('Nothing to print yet')
      return
    }
    const noteTitle = path.replace(/\.md$/i, '').split('/').pop() ?? 'note'
    try {
      const html = await buildExportHtml(docJson, noteTitle, vaultFs)
      printExportHtml(html)
    } catch (e) {
      console.error('Print preparation failed', e)
      toast.error('Could not open print dialog')
    }
  }

  if (!editor) {
    return (
      <div className="text-fg-muted flex h-48 min-w-0 flex-1 items-center justify-center text-sm">
        Loading editor…
      </div>
    )
  }

  return (
    <div className="bg-bg flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <NoteEditorModeBar
        raw={showRawSource}
        busy={isBootstrapping}
        onExportMarkdown={() => handleExportMarkdown()}
        onPrint={() => void handlePrint()}
        onVisual={() => {
          if (!showRawSource) return
          handleShowVisual()
        }}
        onRaw={() => {
          if (showRawSource) return
          handleShowRaw()
        }}
      />
      {!showRawSource && <NoteEditorToolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-10 pt-6">
          <input
            ref={titleInputRef}
            type="text"
            value={inlineTitle}
            onChange={(e) => {
              // Strip illegal filename characters as the user types
              const cleaned = e.target.value.replace(/[/\\:*?"<>|]/g, '')
              setInlineTitle(cleaned)
            }}
            onBlur={() => void commitTitleRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Escape') {
                setInlineTitle(titleFromPath(pathRef.current))
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            aria-label="Note title"
            className="text-fg placeholder:text-fg-muted w-full border-none bg-transparent text-[2rem] font-bold leading-tight tracking-tight outline-none"
            placeholder="Untitled"
          />
        </div>
        {showRawSource ? (
          <textarea
            value={rawText}
            onChange={(e) => handleRawChange(e.target.value)}
            className={cn(
              'font-mono text-fg placeholder:text-fg-muted box-border min-h-[min(480px,calc(100vh-14rem))] w-full resize-none px-10 pb-6 pt-2 text-sm leading-relaxed',
              'focus:outline-none',
            )}
            spellCheck={false}
            aria-label="Raw markdown source"
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  )
})
