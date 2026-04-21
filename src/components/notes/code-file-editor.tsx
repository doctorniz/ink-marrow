'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useEditorStore } from '@/stores/editor'
import { useAutoSave } from '@/hooks/use-auto-save'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { toast } from '@/stores/toast'
import { languageFromExtension, extFromPath } from '@/lib/code/language-support'
import { inkEditorTheme, inkHighlightStyle } from '@/lib/code/codemirror-theme'

export function CodeFileEditor({
  tabId,
  path,
  onRenamed,
}: {
  tabId: string
  path: string
  onRenamed?: () => void
}) {
  const { vaultFs } = useVaultSession()
  const markDirty = useEditorStore((s) => s.markDirty)
  const retargetTabPath = useEditorStore((s) => s.retargetTabPath)
  const isDirty = useEditorStore((s) => s.tabs.find((t) => t.id === tabId)?.isDirty ?? false)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const pathRef = useRef(path)
  const [loaded, setLoaded] = useState(false)

  pathRef.current = path

  // ---- Save handler ----
  const handleSave = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const text = view.state.doc.toString()
    try {
      const encoder = new TextEncoder()
      await vaultFs.writeFile(pathRef.current, encoder.encode(text))
      markDirty(tabId, false)
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
    } catch (e) {
      console.error('Code file save failed', e)
      toast.error('Failed to save file')
    }
  }, [vaultFs, markDirty, tabId])

  useAutoSave({
    intervalMs: 3_000,
    saveOnBlur: true,
    enabled: true,
    onSave: handleSave,
    isDirty,
  })

  // ---- Ctrl+S ----
  const saveKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: () => {
        void handleSave()
        return true
      },
    },
  ])

  // ---- Initialize CodeMirror ----
  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false
    let view: EditorView | null = null

    async function init() {
      const raw = await vaultFs.readFile(path)
      if (destroyed) return
      const text = new TextDecoder().decode(raw)

      const ext = extFromPath(path)
      const langExt = await languageFromExtension(ext)
      if (destroyed) return

      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        highlightSelectionMatches(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        saveKeymap,
        inkEditorTheme,
        inkHighlightStyle,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            markDirty(tabId, true)
          }
        }),
        EditorView.lineWrapping,
      ]

      if (langExt) extensions.push(langExt)

      const state = EditorState.create({
        doc: text,
        extensions,
      })

      if (destroyed || !containerRef.current) return

      view = new EditorView({
        state,
        parent: containerRef.current,
      })
      viewRef.current = view
      setLoaded(true)
    }

    void init()

    return () => {
      destroyed = true
      if (view) {
        view.destroy()
        viewRef.current = null
      }
    }
    // Intentional: we only re-create the editor when tabId changes (new file).
    // path changes via rename are handled by pathRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Flush save on unmount ----
  useEffect(() => {
    return () => {
      const view = viewRef.current
      if (!view) return
      const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId)
      if (!tab?.isDirty) return
      const text = view.state.doc.toString()
      const encoder = new TextEncoder()
      void vaultFs.writeFile(pathRef.current, encoder.encode(text)).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Rename handler ----
  function handleRename(oldPath: string, newStem: string) {
    const nameWithExt = oldPath.split('/').pop() ?? oldPath
    const ext = nameWithExt.includes('.') ? nameWithExt.slice(nameWithExt.lastIndexOf('.')) : ''
    const fullName = newStem.endsWith(ext) ? newStem : `${newStem}${ext}`
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = parent ? `${parent}/${fullName}` : fullName

    void (async () => {
      try {
        if (await vaultFs.exists(newPath)) {
          toast.error('A file with that name already exists')
          return
        }
        await vaultFs.rename(oldPath, newPath)
        retargetTabPath(tabId, newPath, newPath.split('/').pop() ?? newPath)
        pathRef.current = newPath
        onRenamed?.()
        window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      } catch {
        toast.error('Failed to rename')
      }
    })()
  }

  const ext = extFromPath(path)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <InlineFileTitle
          path={path}
          onRename={handleRename}
        />
        <span className="text-fg-muted text-xs font-mono">.{ext}</span>
        {isDirty && (
          <span className="bg-accent size-2 shrink-0 rounded-full" title="Unsaved changes" />
        )}
      </div>
      <div
        ref={containerRef}
        className="bg-bg min-h-0 flex-1 overflow-auto"
      />
      {!loaded && (
        <div className="bg-bg absolute inset-0 flex items-center justify-center">
          <span className="text-fg-muted text-sm">Loading…</span>
        </div>
      )}
    </div>
  )
}
