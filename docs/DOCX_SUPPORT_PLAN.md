# DOCX Support Plan

Read-only DOCX preview using `docx-preview`, with PDF export.

## Approach

DOCX files open in a faithful Word-style viewer powered by `docx-preview`. No editing — the file is rendered as-is with original formatting, fonts, page margins, headers/footers, and table layouts preserved. A toolbar offers rename, download-as-PDF, and zoom controls.

PDF export uses `html2pdf.js` (html2canvas + jsPDF under the hood) to rasterize the rendered preview into a real PDF file, saved to the vault.

## Dependencies

| Package | Purpose | Size |
|---|---|---|
| `docx-preview` | Renders DOCX to styled HTML with page fidelity | ~200KB |
| `html2pdf.js` | Converts rendered HTML → PDF (canvas-based, not print) | ~300KB |

Both are lazy-imported only when a DOCX tab opens.

## Implementation

### 1. Type system wiring

Same four-file pattern used for the code editor.

**`src/types/files.ts`** — Add `Docx = 'docx'` to `FileType` enum. Add `case 'docx':` returning `FileType.Docx` in `getFileType()`. Skip `.doc` (different binary format — show a toast if someone tries).

**`src/types/editor.ts`** — Add `'docx'` to the `EditorTab['type']` union.

**`src/lib/notes/editor-tab-from-path.ts`** — Add `case FileType.Docx: return 'docx'` in the switch. `titleFromVaultPath` strips the extension (like markdown/PDF, not like code files).

**`src/lib/notes/tree-filter.ts`** — Add `entry.type === FileType.Docx` to `isNotesTreeEntry`.

### 2. File tree icon

**`src/components/notes/notes-file-tree.tsx`** — Import `FileSpreadsheet` (or `FileType2`) from lucide-react. Add to the icon switch with a blue-indigo accent color (`text-indigo-400/70`).

### 3. DOCX viewer component

**New file: `src/components/notes/docx-viewer.tsx`**

Structure:

```
DocxViewer({ tabId, path, onRenamed })
```

**Loading flow:**
1. Read file as `Uint8Array` via `vaultFs.readFile(path)`
2. Dynamically import `docx-preview`
3. Call `renderAsync(arrayBuffer, containerElement, styleContainer, options)` where options include `className: 'docx-preview-wrapper'` and `inWrapper: true`
4. Drop the loading spinner once rendering completes

**Toolbar (top bar):**
- `InlineFileTitle` for rename + `.docx` badge (matches code editor pattern)
- Zoom controls: `−` / percentage / `+` (CSS `transform: scale()` on the container)
- "Export PDF" button (lucide `Download` icon)

**Zoom:** Store zoom level in component state (default 100%). Apply via CSS transform on the docx-preview container with `transform-origin: top center`. Persist per-file zoom in `localStorage` keyed by path.

**No dirty state, no auto-save** — this is read-only.

### 4. PDF export utility

**New file: `src/lib/docx/export-pdf.ts`**

```ts
export async function exportDocxAsPdf(
  containerEl: HTMLElement,
  filename: string,
): Promise<Uint8Array>
```

- Dynamically import `html2pdf.js`
- Configure: `margin: 0`, `filename`, `image: { type: 'jpeg', quality: 0.95 }`, `html2canvas: { scale: 2, useCORS: true }`, `jsPDF: { unit: 'mm', format: 'a4' }`
- Use `.outputPdf('arraybuffer')` to get bytes (not trigger a browser download)
- Return `Uint8Array` so the caller can write to vault via `vaultFs.writeFile`

**In the viewer**, the Export PDF button:
1. Shows a brief "Exporting…" state
2. Calls `exportDocxAsPdf` with the preview container element
3. Writes to the same directory as the source: `<name>.pdf` next to `<name>.docx`
4. Opens a toast with "PDF saved — <name>.pdf" and optionally opens the PDF tab
5. Dispatches `ink:vault-changed` so the file tree updates

### 5. View routing

**`src/components/views/notes-view.tsx`** — Import `DocxViewer`. Add branch:

```tsx
) : activeTab?.type === 'docx' ? (
  <DocxViewer
    key={activeTab.id}
    tabId={activeTab.id}
    path={activeTab.path}
    onRenamed={vaultChanged}
  />
)
```

### 6. Styling

**`src/app/globals.css`** — Scoped overrides for the docx-preview output:

- `.docx-preview-wrapper` container: centered with `margin: 0 auto`, subtle drop shadow on pages, background `var(--color-bg-secondary)` behind the pages to create a "document on desk" look
- Page elements get `box-shadow` for the paper effect
- Scrollbar styling consistent with the rest of the app
- Dark mode: invert the page background area (not the page content itself) — pages stay white, the surrounding canvas goes dark

### 7. File browser integration

No changes needed. `file-browser-view.tsx` already uses `editorTabTypeFromVaultPath`, which will return `'docx'` after step 1. Opening a DOCX from Files view will switch to Vault view and render the viewer.

## File summary

| File | Action |
|---|---|
| `src/types/files.ts` | Add `Docx` to enum + `getFileType` |
| `src/types/editor.ts` | Add `'docx'` to type union |
| `src/lib/notes/editor-tab-from-path.ts` | Add Docx case |
| `src/lib/notes/tree-filter.ts` | Add Docx to filter |
| `src/components/notes/notes-file-tree.tsx` | Add icon |
| `src/components/notes/docx-viewer.tsx` | **New** — viewer component |
| `src/lib/docx/export-pdf.ts` | **New** — PDF export utility |
| `src/components/views/notes-view.tsx` | Add routing branch |
| `src/app/globals.css` | Add preview styles |
| `package.json` | Add `docx-preview`, `html2pdf.js` |

## Out of scope (v1)

- Editing DOCX content
- Legacy `.doc` support
- Searching within DOCX files (search index)
- DOCX-to-markdown conversion
- Print-to-PDF (we use canvas-based export instead)
