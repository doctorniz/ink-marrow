'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useEditorStore } from '@/stores/editor'
import { InlineFileTitle } from '@/components/shell/inline-file-title'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast'
import { vaultPathsPointToSameFile } from '@/lib/fs/vault-path-equiv'
import { readXlsxFile, writeSpreadsheetFile, bookTypeFromPath } from '@/lib/spreadsheet/xlsx-io'
import type { SpreadsheetWorkbook, CellData } from '@/lib/spreadsheet/types'
import { DEFAULT_COL_WIDTH, MIN_ROWS, MIN_COLS } from '@/lib/spreadsheet/types'

/** Debounce interval for auto-save (ms) — matches markdown/docx editors. */
const SAVE_DEBOUNCE_MS = 750

/**
 * Spreadsheet editor powered by jspreadsheet-ce.
 *
 * Loads `.xlsx` / `.xls` / `.csv` files via SheetJS, presents them in a
 * jspreadsheet-ce grid, and auto-saves edits back to the vault as `.xlsx`.
 * The library is lazy-loaded so the bundle is only pulled when a spreadsheet
 * tab is actually opened.
 */
export function SpreadsheetEditor({
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

  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jssInstancesRef = useRef<any[]>([])
  const workbookRef = useRef<SpreadsheetWorkbook | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onPersistedRef = useRef(onPersisted)
  onPersistedRef.current = onPersisted

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [jspreadsheet, setJspreadsheet] = useState<any>(null)

  // ---- Collect current grid state into workbook model ----
  const syncGridToWorkbook = useCallback(() => {
    const wb = workbookRef.current
    if (!wb) return
    jssInstancesRef.current.forEach((instance, idx) => {
      if (!instance || !wb.sheets[idx]) return
      // jspreadsheet getData returns string[][]
      const rawData: string[][] = instance.getData()
      const grid: CellData[][] = rawData.map((row: string[]) =>
        row.map((cell: string) => {
          if (typeof cell === 'string' && cell.startsWith('=')) {
            return { value: cell, formula: cell }
          }
          // Try to parse as number
          const num = Number(cell)
          if (cell !== '' && !isNaN(num)) {
            return { value: num }
          }
          return { value: cell ?? '' }
        }),
      )
      wb.sheets[idx].data = grid
    })
    wb.activeSheetIndex = activeSheet
  }, [activeSheet])

  // ---- Save logic ----
  const doSave = useCallback(async () => {
    try {
      syncGridToWorkbook()
      const wb = workbookRef.current
      if (!wb) return
      const fmt = bookTypeFromPath(pathRef.current)
      const bytes = writeSpreadsheetFile(wb, fmt)
      await vaultFs.writeFile(pathRef.current, bytes)
      updateTab(tabId, { isDirty: false })
      onPersistedRef.current?.()
    } catch (e) {
      console.error('Spreadsheet auto-save failed', e)
      toast.error('Failed to save spreadsheet')
    }
  }, [vaultFs, tabId, updateTab, syncGridToWorkbook])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, SAVE_DEBOUNCE_MS)
  }, [doSave])

  // ---- onChange from grid ----
  const handleChange = useCallback(() => {
    updateTab(tabId, { isDirty: true })
    scheduleSave()
  }, [tabId, updateTab, scheduleSave])

  // ---- Create jspreadsheet instance for a sheet ----
  const mountSheet = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jss: any, container: HTMLDivElement, sheet: SpreadsheetWorkbook['sheets'][number]) => {
      // Convert CellData[][] to string[][] for jspreadsheet
      const data = sheet.data.map((row) =>
        row.map((cell) => {
          if (cell.formula) return cell.formula
          if (cell.value === null || cell.value === undefined) return ''
          return String(cell.value)
        }),
      )

      // Build columns config
      const columns = sheet.colWidths.map((w) => ({
        width: w,
      }))

      const instance = jss(container, {
        data,
        columns,
        minDimensions: [MIN_COLS, MIN_ROWS],
        defaultColWidth: DEFAULT_COL_WIDTH,
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: '100%',
        allowInsertRow: true,
        allowInsertColumn: true,
        allowDeleteRow: true,
        allowDeleteColumn: true,
        allowRenameColumn: true,
        columnSorting: true,
        columnDrag: true,
        rowDrag: true,
        contextMenu: true,
        search: true,
        // Merge cells (jspreadsheet uses { A1: [colSpan, rowSpan] } format)
        ...(sheet.merges.length
          ? {
              mergeCells: Object.fromEntries(
                sheet.merges.map((m) => {
                  const [start, end] = m.split(':')
                  // Decode range to compute span
                  const sCol = start.replace(/[0-9]/g, '')
                  const sRow = parseInt(start.replace(/[^0-9]/g, ''), 10)
                  const eCol = end.replace(/[0-9]/g, '')
                  const eRow = parseInt(end.replace(/[^0-9]/g, ''), 10)
                  const colSpan =
                    eCol.charCodeAt(0) - sCol.charCodeAt(0) + 1 // Simplified single-letter
                  const rowSpan = eRow - sRow + 1
                  return [start, [colSpan, rowSpan]]
                }),
              ),
            }
          : {}),
        onchange: handleChange,
        oninsertrow: handleChange,
        oninsertcolumn: handleChange,
        ondeleterow: handleChange,
        ondeletecolumn: handleChange,
        onsort: handleChange,
        onmoverow: handleChange,
        onmovecolumn: handleChange,
        onmerge: handleChange,
        onresizecolumn: handleChange,
        onresizerow: handleChange,
        onundo: handleChange,
        onredo: handleChange,
      })

      return instance
    },
    [handleChange],
  )

  // ---- Load file + jspreadsheet library ----
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [bytes, jssModule, _jsuites] = await Promise.all([
          vaultFs.readFile(path),
          import('jspreadsheet-ce'),
          import('jsuites'),
        ])
        if (cancelled) return

        // Import CSS
        await Promise.all([
          // @ts-expect-error CSS module import
          import('jspreadsheet-ce/dist/jspreadsheet.css'),
          // @ts-expect-error CSS module import
          import('jsuites/dist/jsuites.css'),
        ]).catch(() => {
          // CSS imports may fail in some bundler configs; jspreadsheet
          // still works, we just need to inject styles manually as fallback.
        })

        const jss = jssModule.default || jssModule
        setJspreadsheet(() => jss)

        const wb = readXlsxFile(bytes)
        workbookRef.current = wb
        setSheetNames(wb.sheets.map((s) => s.name))
        setActiveSheet(wb.activeSheetIndex)
        setLoading(false)
      } catch (e) {
        console.error('Spreadsheet editor load failed', e)
        if (!cancelled) {
          setError('Failed to load this spreadsheet file.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // Re-load only when the tab identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Mount the active sheet's grid ----
  useEffect(() => {
    if (loading || !jspreadsheet || !workbookRef.current || !containerRef.current) return

    const container = containerRef.current
    // Clear previous instance
    container.innerHTML = ''
    jssInstancesRef.current = []

    const sheet = workbookRef.current.sheets[activeSheet]
    if (!sheet) return

    try {
      const instance = mountSheet(jspreadsheet, container, sheet)
      jssInstancesRef.current[activeSheet] = instance
    } catch (e) {
      console.error('Failed to mount jspreadsheet', e)
      setError('Failed to render spreadsheet grid.')
    }
  }, [loading, jspreadsheet, activeSheet, mountSheet])

  // ---- Flush save on unmount ----
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void doSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // ---- Sheet tab operations ----
  const addSheet = useCallback(() => {
    const wb = workbookRef.current
    if (!wb) return
    syncGridToWorkbook()
    const name = `Sheet${wb.sheets.length + 1}`
    const emptyRow = (): CellData[] =>
      Array.from({ length: MIN_COLS }, () => ({ value: '' }))
    wb.sheets.push({
      name,
      data: Array.from({ length: MIN_ROWS }, emptyRow),
      colWidths: Array.from({ length: MIN_COLS }, () => DEFAULT_COL_WIDTH),
      merges: [],
    })
    setSheetNames(wb.sheets.map((s) => s.name))
    setActiveSheet(wb.sheets.length - 1)
    handleChange()
  }, [syncGridToWorkbook, handleChange])

  const deleteSheet = useCallback(
    (idx: number) => {
      const wb = workbookRef.current
      if (!wb || wb.sheets.length <= 1) return
      syncGridToWorkbook()
      wb.sheets.splice(idx, 1)
      setSheetNames(wb.sheets.map((s) => s.name))
      const newActive = Math.min(activeSheet, wb.sheets.length - 1)
      setActiveSheet(newActive)
      handleChange()
    },
    [activeSheet, syncGridToWorkbook, handleChange],
  )

  const switchSheet = useCallback(
    (idx: number) => {
      if (idx === activeSheet) return
      syncGridToWorkbook()
      setActiveSheet(idx)
    },
    [activeSheet, syncGridToWorkbook],
  )

  // ---- Download ----
  const handleDownload = useCallback(async () => {
    try {
      const bytes = await vaultFs.readFile(pathRef.current)
      const ext = pathRef.current.split('.').pop()?.toLowerCase() ?? 'xlsx'
      const mimeMap: Record<string, string> = {
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        csv: 'text/csv',
        tsv: 'text/tab-separated-values',
        ods: 'application/vnd.oasis.opendocument.spreadsheet',
      }
      const blob = new Blob([bytes as BlobPart], { type: mimeMap[ext] ?? 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pathRef.current.split('/').pop() ?? `spreadsheet.${ext}`
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
        // Flush pending save before rename
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
          await doSave()
        }
        await vaultFs.rename(oldPath, newPath)
        retargetTabPath(
          tabId,
          newPath,
          newPath.replace(/\.[^/.]+$/i, '').split('/').pop() ?? newPath,
        )
        pathRef.current = newPath
        onRenamed?.()
        window.dispatchEvent(new CustomEvent('ink:vault-changed'))
      } catch {
        toast.error('Failed to rename')
      }
    })()
  }

  // ---- Determine file extension label ----
  const extLabel = (pathRef.current.split('.').pop() ?? 'xlsx').toLowerCase()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — file title + download */}
      <div className="border-border bg-bg-secondary flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <InlineFileTitle path={path} onRename={handleRename} />
        <span className="text-fg-muted font-mono text-xs">.{extLabel}</span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={() => void handleDownload()}
            aria-label="Download spreadsheet"
            title="Download"
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Sheet tabs */}
      {!loading && !error && sheetNames.length > 0 && (
        <div className="border-border bg-bg flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 py-1">
          {sheetNames.map((name, idx) => (
            <button
              key={idx}
              type="button"
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${
                idx === activeSheet
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-fg-secondary hover:bg-bg-tertiary'
              }`}
              onClick={() => switchSheet(idx)}
            >
              {name}
              {sheetNames.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  className="text-fg-muted hover:text-danger ml-1 inline-flex"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteSheet(idx)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      deleteSheet(idx)
                    }
                  }}
                  aria-label={`Delete sheet ${name}`}
                >
                  <Trash2 className="size-3" />
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="text-fg-muted hover:text-fg ml-1 rounded p-1 transition-colors"
            onClick={addSheet}
            aria-label="Add sheet"
            title="Add sheet"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      )}

      {/* Grid area */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-fg-muted text-sm">Loading spreadsheet…</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-danger text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && (
          <div
            ref={containerRef}
            className="spreadsheet-container h-full w-full"
          />
        )}
      </div>
    </div>
  )
}
