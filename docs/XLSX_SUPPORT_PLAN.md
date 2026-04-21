# XLSX Support Plan

Read-only spreadsheet preview using SheetJS for parsing + a custom lightweight grid renderer, with PDF export.

## Approach

XLSX files open in a clean spreadsheet viewer that preserves cell formatting (colors, borders, fonts, merged cells, column widths, number formats). No editing — the data is rendered faithfully in a virtualized grid. A toolbar offers sheet tab switching, rename, download-as-PDF, and zoom controls.

**Why SheetJS + custom grid instead of Univer?** Univer is a full spreadsheet engine (~2MB+ with plugins) designed for editing. For read-only preview, it's massive overkill. SheetJS parses XLSX files into structured data (~300KB, battle-tested, 35K+ GitHub stars) and we render that data in a lightweight virtualized grid using `@tanstack/react-virtual` (already in the project). This keeps the bundle lean and gives full control over styling to match Mentis's design.

PDF export reuses the same `html2pdf.js` pipeline from the DOCX plan.

## Dependencies

| Package | Purpose | Size |
|---|---|---|
| `xlsx` (SheetJS CE) | Parse XLSX → structured JSON with formatting metadata | ~300KB |
| `html2pdf.js` | Converts rendered grid → PDF (canvas-based, not print) | ~300KB (shared with DOCX) |

Both are lazy-imported only when an XLSX tab opens. `@tanstack/react-virtual` is already installed.

## Implementation

### 1. Type system wiring

Same four-file pattern used for the code editor and DOCX viewer.

**`src/types/files.ts`** — Add `Spreadsheet = 'spreadsheet'` to `FileType` enum. Add `case 'xlsx': case 'xls': case 'csv':` returning `FileType.Spreadsheet` in `getFileType()`.

**`src/types/editor.ts`** — Add `'spreadsheet'` to the `EditorTab['type']` union.

**`src/lib/notes/editor-tab-from-path.ts`** — Add `case FileType.Spreadsheet: return 'spreadsheet'` in the switch. `titleFromVaultPath` keeps the extension visible (like code files) since `.xlsx` vs `.csv` is meaningful information.

**`src/lib/notes/tree-filter.ts`** — Add `entry.type === FileType.Spreadsheet` to `isNotesTreeEntry`.

### 2. File tree icon

**`src/components/notes/notes-file-tree.tsx`** — Import `Sheet` from lucide-react. Add to the icon switch with a green accent (`text-emerald-500/70`) to match the Excel association.

### 3. XLSX parsing utility

**New file: `src/lib/spreadsheet/parse-workbook.ts`**

Wraps SheetJS to produce a render-ready data structure:

```ts
interface ParsedCell {
  value: string | number | boolean | null
  type: 'string' | 'number' | 'boolean' | 'date' | 'empty'
  format?: string           // number format string (e.g. "#,##0.00")
  formatted?: string        // pre-formatted display string
  style?: CellStyle
  merge?: { cols: number; rows: number }  // only on top-left cell of a merge
  merged?: boolean          // true for non-origin cells swallowed by a merge
}

interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  fontSize?: number
  fontColor?: string        // hex
  bgColor?: string          // hex
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
  borderTop?: BorderStyle
  borderRight?: BorderStyle
  borderBottom?: BorderStyle
  borderLeft?: BorderStyle
  wrap?: boolean
}

interface ParsedSheet {
  name: string
  rows: ParsedCell[][]
  colWidths: number[]       // in pixels
  rowHeights: number[]      // in pixels
  merges: Array<{ r1: number; c1: number; r2: number; c2: number }>
  frozenRows?: number
  frozenCols?: number
}

interface ParsedWorkbook {
  sheets: ParsedSheet[]
  activeSheet: number
}
```

**Parsing flow:**
1. Read XLSX with `XLSX.read(uint8Array, { type: 'array', cellStyles: true, cellDates: true })`
2. For each sheet, iterate the cell range and extract values, types, and styles
3. Map SheetJS style objects to the simplified `CellStyle` above
4. Extract merge ranges from `sheet['!merges']`
5. Extract column widths from `sheet['!cols']` and row heights from `sheet['!rows']`
6. Return `ParsedWorkbook`

**Note on SheetJS CE vs Pro:** The community edition (`xlsx` on npm) parses cell styles with `cellStyles: true` but only exposes partial style data (bold, italic, font size). Full formatting (cell background colors, borders) requires the Pro version or a supplementary parse of the XLSX XML. For v1, extract what CE provides and enhance later if needed. Colors can be pulled from the raw XML in the zip via SheetJS's internal zip access (`workbook.Sheets[name]['!ref']` etc.).

### 4. Spreadsheet viewer component

**New file: `src/components/notes/spreadsheet-viewer.tsx`**

Structure:

```
SpreadsheetViewer({ tabId, path, onRenamed })
```

**Loading flow:**
1. Read file as `Uint8Array` via `vaultFs.readFile(path)`
2. Dynamically import the parse utility
3. Parse into `ParsedWorkbook`
4. Render the active sheet in the grid
5. Drop the loading spinner

**Grid renderer** — a custom virtualized grid using `@tanstack/react-virtual`:
- Two virtualizers: one for rows, one for columns
- Render only visible cells in a `position: absolute` layout inside a scrollable container
- Each cell is a `<div>` positioned absolutely, styled from `CellStyle`
- Frozen rows/columns rendered in sticky `<div>`s above/left of the scrollable area
- Merged cells span their area via width/height calculation (skip rendering swallowed cells)

**Column/row headers:**
- Column headers (A, B, C, … AA, AB, …) in a sticky top row with `bg-bg-secondary`
- Row numbers (1, 2, 3, …) in a sticky left column
- Both scroll-locked to their respective axis

**Sheet tabs:**
- Bottom tab bar showing all sheet names
- Active sheet highlighted with `bg-accent/10 text-accent`
- Click to switch sheets

**Toolbar (top bar):**
- `InlineFileTitle` for rename + extension badge (`.xlsx`, `.csv`)
- Zoom controls: `−` / percentage / `+` (scale the grid via CSS transform or by adjusting cell sizes)
- "Export PDF" button
- Cell count / row count indicator (subtle, right-aligned)

**Cell selection (optional, for v1):**
- Click a cell to highlight it with an accent border
- Show cell value / formula in a read-only formula bar below the toolbar
- This is polish — can be deferred

**No dirty state, no auto-save** — read-only.

### 5. CSV handling

CSV files use the same viewer. SheetJS parses CSV into the same workbook structure (single sheet, no styles). The grid renders it identically — just without formatting. The extension badge shows `.csv` and the file tree icon is the same.

### 6. PDF export

**New file: `src/lib/spreadsheet/export-pdf.ts`**

```ts
export async function exportSpreadsheetAsPdf(
  containerEl: HTMLElement,
  filename: string,
  landscape?: boolean,
): Promise<Uint8Array>
```

- Dynamically import `html2pdf.js`
- Default to landscape orientation for spreadsheets (wide data is common)
- Configure: `margin: 10mm`, `image: { type: 'jpeg', quality: 0.95 }`, `html2canvas: { scale: 2 }`, `jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }`
- For multi-sheet export: render each sheet sequentially, add page breaks between them
- Return `Uint8Array` for vault write

**In the viewer**, the Export PDF button:
1. Shows "Exporting…" state
2. Temporarily un-virtualizes the grid (render all rows) for the PDF capture, or re-render to an offscreen container with all rows
3. Calls the export utility
4. Writes `<name>.pdf` next to the source file
5. Toast + `ink:vault-changed`

### 7. View routing

**`src/components/views/notes-view.tsx`** — Import `SpreadsheetViewer`. Add branch:

```tsx
) : activeTab?.type === 'spreadsheet' ? (
  <SpreadsheetViewer
    key={activeTab.id}
    tabId={activeTab.id}
    path={activeTab.path}
    onRenamed={vaultChanged}
  />
)
```

### 8. Styling

**`src/app/globals.css`** — Scoped styles for the spreadsheet grid:

- Grid container: `bg-bg`, thin `1px` gridlines using `var(--color-border)`, clean and light
- Column/row headers: `bg-bg-secondary`, `text-fg-muted`, `text-xs`, `font-medium`
- Selected cell: `outline: 2px solid var(--color-accent)` (no fill, just the border — like Excel)
- Sheet tabs: bottom bar with `border-top`, tabs styled like the editor tab bar
- Frozen pane separator: a slightly heavier `border-right` / `border-bottom` on the freeze boundary
- Dark mode: gridlines lighten, headers adjust, cell backgrounds with colors stay as-is (spreadsheet data colors should be preserved verbatim)
- Scrollbars: match existing app scrollbar styling

### 9. File browser integration

No changes needed — same as DOCX. `editorTabTypeFromVaultPath` returns `'spreadsheet'`, file browser routes through Vault view.

## File summary

| File | Action |
|---|---|
| `src/types/files.ts` | Add `Spreadsheet` to enum + `getFileType` |
| `src/types/editor.ts` | Add `'spreadsheet'` to type union |
| `src/lib/notes/editor-tab-from-path.ts` | Add Spreadsheet case |
| `src/lib/notes/tree-filter.ts` | Add Spreadsheet to filter |
| `src/components/notes/notes-file-tree.tsx` | Add icon |
| `src/lib/spreadsheet/parse-workbook.ts` | **New** — SheetJS parsing wrapper |
| `src/components/notes/spreadsheet-viewer.tsx` | **New** — grid viewer component |
| `src/lib/spreadsheet/export-pdf.ts` | **New** — PDF export utility |
| `src/components/views/notes-view.tsx` | Add routing branch |
| `src/app/globals.css` | Add grid styles |
| `package.json` | Add `xlsx` (SheetJS CE) |

## Out of scope (v1)

- Cell editing or formula evaluation
- Charts and graphs embedded in XLSX
- Conditional formatting rules
- Pivot tables
- VBA macros
- `.ods` (LibreOffice) format
- Multi-sheet PDF export (v1 exports active sheet only)
