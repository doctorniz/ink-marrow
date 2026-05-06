'use client'

import { useCallback, useState } from 'react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { useBoardStore } from '@/stores/board'
import { DEFAULT_VAULT_CONFIG, ViewMode } from '@/types/vault'
import { createBlankPdf } from '@/lib/pdf/page-operations'
import { createEmptyCanvasJson } from '@/lib/canvas/serializer'
import { createEmptyKanban } from '@/lib/kanban'
import { createBlankXlsx } from '@/lib/spreadsheet/xlsx-io'
import { reindexMarkdownPath } from '@/lib/search/build-vault-index'
import { allocateUniqueFilePath } from '@/lib/notes/new-note'
import { toast } from '@/stores/toast'

function useDefaultFolder() {
  return useVaultStore((s) => s.config?.defaultNewFileFolder ?? DEFAULT_VAULT_CONFIG.defaultNewFileFolder)
}

function usePdfPageStyle() {
  return useVaultStore((s) => s.config?.pdfPageStyle ?? DEFAULT_VAULT_CONFIG.pdfPageStyle)
}

function fileTypeForPath(path: string): 'pdf' | 'markdown' | 'canvas' | 'spreadsheet' | 'audio' | null {
  if (path.endsWith('.pdf')) return 'pdf'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  if (path.endsWith('.canvas')) return 'canvas'
  if (path.endsWith('.xlsx') || path.endsWith('.xls') || path.endsWith('.csv')) return 'spreadsheet'
  if (path.endsWith('.mp3') || path.endsWith('.wav') || path.endsWith('.m4a')) return 'audio'
  return null
}

/**
 * Shared creation actions for new files (note, drawing, PDF, import).
 * Used by both the desktop `NewFilePopover` and the mobile inline accordion.
 *
 * Each action navigates to the Vault tree view and dispatches `ink:vault-changed`.
 * The caller supplies an `onDone` callback (e.g. close popover / close drawer).
 */
export function useNewFileActions(onDone: () => void) {
  const { vaultFs } = useVaultSession()
  const defaultFolder = useDefaultFolder()
  const pdfPageStyle = usePdfPageStyle()
  const [busy, setBusy] = useState(false)

  function defaultDir(): string {
    return !defaultFolder || defaultFolder === '/' ? '' : defaultFolder
  }

  const createNote = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const stem = `Note ${new Date().toISOString().slice(0, 10)}`
      const dir = defaultDir()
      const rawPath = dir ? `${dir}/${stem}.md` : `${stem}.md`
      const filePath = await allocateUniqueFilePath(vaultFs, rawPath)
      const title = filePath.replace(/\.md$/i, '').split('/').pop() ?? stem
      const content = `---\ntitle: "${title}"\ndate: "${new Date().toISOString()}"\ntags: []\n---\n\n`
      await vaultFs.writeTextFile(filePath, content)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path: filePath,
        type: 'markdown',
        title,
        isDirty: false,
        isNew: true,
      })
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useUiStore.getState().setVaultMode('tree')
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, onDone])

  const createDrawing = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const stem = `Drawing ${new Date().toISOString().slice(0, 10)}`
      const dir = defaultDir()
      const rawPath = dir ? `${dir}/${stem}.canvas` : `${stem}.canvas`
      const path = await allocateUniqueFilePath(vaultFs, rawPath)
      const title = path.replace(/\.canvas$/i, '').split('/').pop() ?? stem
      await vaultFs.writeTextFile(path, createEmptyCanvasJson())
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useUiStore.getState().setVaultMode('tree')
      useFileTreeStore.getState().setSelectedPath(path)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path,
        type: 'canvas',
        title,
        isDirty: false,
        isNew: true,
      })
      useEditorStore.getState().addRecentFile(path)
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, onDone])

  const createPdf = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const stem = `PDF ${new Date().toISOString().slice(0, 10)}`
      const dir = defaultDir()
      const rawPath = dir ? `${dir}/${stem}.pdf` : `${stem}.pdf`
      const path = await allocateUniqueFilePath(vaultFs, rawPath)
      const title = path.replace(/\.pdf$/i, '').split('/').pop() ?? stem
      const pdfBytes = await createBlankPdf({ style: pdfPageStyle, size: 'a4' })
      await vaultFs.writeFile(path, pdfBytes)
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useUiStore.getState().setVaultMode('tree')
      useFileTreeStore.getState().setSelectedPath(path)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path,
        type: 'pdf',
        title,
        isDirty: false,
        isNew: true,
      })
      useEditorStore.getState().addRecentFile(path)
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, pdfPageStyle, onDone])

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (!fileArr.length) return
    setBusy(true)
    try {
      const dir = defaultDir()
      let count = 0
      let lastPath = ''
      for (const file of fileArr) {
        const buf = new Uint8Array(await file.arrayBuffer())
        const dest = dir ? `${dir}/${file.name}` : file.name
        await vaultFs.writeFile(dest, buf)
        if (dest.endsWith('.md')) await reindexMarkdownPath(vaultFs, dest)
        lastPath = dest
        count++
      }
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      useUiStore.getState().setActiveView(ViewMode.Vault)

      if (count === 1) {
        const type = fileTypeForPath(lastPath)
        if (type) {
          const title = lastPath.replace(/\.[^/.]+$/i, '').split('/').pop() ?? lastPath
          useUiStore.getState().setVaultMode('tree')
          useFileTreeStore.getState().setSelectedPath(lastPath)
          useEditorStore.getState().openTab({
            id: crypto.randomUUID(),
            path: lastPath,
            type,
            title,
            isDirty: false,
          })
        }
      }

      toast.success(`Imported ${count} file${count !== 1 ? 's' : ''}`)
      onDone()
    } catch (e) {
      console.error('Import failed', e)
      toast.error('Failed to import files')
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, onDone])

  const createKanban = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const stem = `Kanban ${new Date().toISOString().slice(0, 10)}`
      const dir = defaultDir()
      const rawPath = dir ? `${dir}/${stem}.md` : `${stem}.md`
      const filePath = await allocateUniqueFilePath(vaultFs, rawPath)
      const title = filePath.replace(/\.md$/i, '').split('/').pop() ?? stem
      await vaultFs.writeTextFile(filePath, createEmptyKanban())
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path: filePath,
        type: 'kanban',
        title,
        isDirty: false,
        isNew: true,
      })
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useUiStore.getState().setVaultMode('tree')
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, onDone])

  const createSpreadsheet = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const stem = `Spreadsheet ${new Date().toISOString().slice(0, 10)}`
      const dir = defaultDir()
      const rawPath = dir ? `${dir}/${stem}.xlsx` : `${stem}.xlsx`
      const path = await allocateUniqueFilePath(vaultFs, rawPath)
      const bytes = createBlankXlsx()
      await vaultFs.writeFile(path, bytes)
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useUiStore.getState().setVaultMode('tree')
      const title = path.replace(/\.xlsx$/i, '').split('/').pop() ?? stem
      useFileTreeStore.getState().setSelectedPath(path)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path,
        type: 'spreadsheet',
        title,
        isDirty: false,
        isNew: true,
      })
      useEditorStore.getState().addRecentFile(path)
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, onDone])

  const createThought = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await useBoardStore.getState().addThought(vaultFs)
      useUiStore.getState().setActiveView(ViewMode.Board)
      window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultFs, busy, onDone])

  return { createNote, createThought, createDrawing, createPdf, createKanban, createSpreadsheet, importFiles, busy }
}
