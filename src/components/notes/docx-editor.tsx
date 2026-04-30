'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useEditorStore } from '@/stores/editor'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'

/** Debounce interval for auto-save (ms) — matches markdown editor. */
const SAVE_DEBOUNCE_MS = 750

/**
 * DOCX editor powered by `@eigenpal/docx-js-editor`.
 *
 * Full WYSIWYG editing with auto-save back to the vault. The library is
 * lazy-loaded via dynamic import so the bundle is only pulled when a DOCX
 * tab is actually opened. ProseMirror-based — architecturally similar to
 * the Tiptap markdown editor already in use.
 *
 * Auto-save follows the same debounced pattern as the markdown editor:
 * every edit marks the tab dirty and schedules a 750ms debounced save.
 * On unmount, any pending timer is flushed synchronously-ish to avoid
 * data loss.
 */
export function DocxEditorView({
  tabId,
  path,
  onRenamed,
  onPersisted,
}: {
  tabId: string
  path: string
  onRenamed?: () => void
  onPersisted?: () => void
}) {
  const { vaultFs } = useVaultSession()
  const retargetTabPath = useEditorStore((s) => s.retargetTabPath)
  const updateTab = useEditorStore((s) => s.updateTab)
  const pathRef = useRef(path)
  pathRef.current = path

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onPersistedRef = useRef(onPersisted)
  onPersistedRef.current = onPersisted

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [docBuffer, setDocBuffer] = useState<ArrayBuffer | null>(null)

  // Lazy-loaded component ref
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [EditorComponent, setEditorComponent] = useState<any>(null)

  // ---- Load library + file ----
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Load file bytes and library in parallel
        const [bytes, mod] = await Promise.all([
          vaultFs.readFile(path),
          import('@eigenpal/docx-js-editor'),
        ])
        if (cancelled) return

        // Convert Uint8Array to ArrayBuffer
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer

        setDocBuffer(buffer)
        setEditorComponent(() => mod.DocxEditor)
        setLoading(false)
      } catch (e) {
        console.error('DOCX editor load failed', e)
        if (!cancelled) {
          setError('Failed to load this DOCX file.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // Re-load only when the tab identity changes (new file opened).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Auto-save logic ----
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void (async () => {
        try {
          const buffer = await editorRef.current?.save()
          if (!buffer) return
          const bytes = new Uint8Array(buffer)
          await vaultFs.writeFile(pathRef.current, bytes)
          updateTab(tabId, { isDirty: false })
          onPersistedRef.current?.()
        } catch (e) {
          console.error('DOCX auto-save failed', e)
          toast.error('Failed to save document')
        }
      })()
    }, SAVE_DEBOUNCE_MS)
  }, [vaultFs, tabId, updateTab])

  // ---- onChange from editor ----
  const handleChange = useCallback(() => {
    updateTab(tabId, { isDirty: true })
    scheduleSave()
  }, [tabId, updateTab, scheduleSave])

  // ---- Flush save on unmount ----
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      // Flush final save
      void (async () => {
        try {
          const buffer = await editorRef.current?.save()
          if (!buffer) return
          const bytes = new Uint8Array(buffer)
          await vaultFs.writeFile(pathRef.current, bytes)
        } catch {
          // Best-effort on unmount
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Download original ----
  const handleDownload = useCallback(async () => {
    try {
      const bytes = await vaultFs.readFile(pathRef.current)
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pathRef.current.split('/').pop() ?? 'document.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download file')
    }
  }, [vaultFs])

  // ---- Rename ----
  function handleRename(oldPath: string, newStem: string) {
    const nameWithExt = oldPath.split('/').pop() ?? oldPath
    const ext = nameWithExt.includes('.') ? nameWithExt.slice(nameWithExt.lastIndexOf('.')) : ''
    const fullName = newStem.endsWith(ext) ? newStem : `${newStem}${ext}`
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = parent ? `${parent}/${fullName}` : fullName

    if (vaultPathsPointToSameFile(newPath, oldPath)) return

    void (async () => {
      try {
        if ((await vaultFs.exists(newPath)) && !vaultPathsPointToSameFile(newPath, oldPath)) {
          toast.error('A file with that name already exists')
          return
        }
        // Flush pending save before rename so we don't write to old path
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
          const buffer = await editorRef.current?.save()
          if (buffer) {
            await vaultFs.writeFile(oldPath, new Uint8Array(buffer))
          }
        }
        await vaultFs.rename(oldPath, newPath)
        retargetTabPath(tabId, newPath, newPath.replace(/\.[^/.]+$/i, '').split('/').pop() ?? newPath)
        pathRef.current = newPath
        onRenamed?.()
        window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      } catch {
        toast.error('Failed to rename')
      }
    })()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — file title + download */}
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <InlineFileTitle path={path} onRename={handleRename} />
        <span className="text-fg-muted text-xs font-mono">.docx</span>

        <div className="ml-auto flex items-center gap-1">
          {/* Download original */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={() => void handleDownload()}
            aria-label="Download original DOCX"
            title="Download original"
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Editor area */}
      <div className="docx-editor-container relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-fg-muted text-sm">Loading document…</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-danger text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && EditorComponent && docBuffer && (
          <EditorComponent
            ref={editorRef}
            documentBuffer={docBuffer}
            mode="editing"
            onChange={handleChange}
            showToolbar
            showRuler
          />
        )}
      </div>
    </div>
  )
}
