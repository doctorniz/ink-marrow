# PPTX Support Plan

Read-only slide viewer with best-effort rendering via JSZip + custom slide parser, with PDF export.

## Reality check

There is no production-quality browser-only PPTX renderer. The old `pptx2html` / `pptxjs` libraries are abandoned and break on anything beyond basic text and images. LibreOffice WASM is 100MB+. reveal.js, Slidev, and Marp don't accept PPTX input. This is genuinely an unsolved problem in the browser ecosystem.

The options come down to:

| Approach | Fidelity | Complexity | Bundle |
|---|---|---|---|
| **A. JSZip DIY parser** — parse OOXML XML, render slides to HTML/SVG | Medium (~70-80% of slides look reasonable) | High — weeks of work, but fully local | ~50KB (JSZip) |
| **B. Convert to images at import** — extract embedded thumbnails or rasterize via offscreen rendering | Low-medium (static images, no text selection) | Low | ~50KB (JSZip) |
| **C. Prompt user to import as PDF** — detect PPTX, show a toast suggesting PDF conversion externally | Perfect (it's a PDF) | Trivial — reuses existing PDF viewer | Zero new deps |

**Recommended: Approach A** with a fallback to B for slides that fail to render. This gives Mentis a real PPTX viewer that handles the majority of presentation content (text boxes, images, shapes, backgrounds, basic formatting), looks native to the app, and degrades gracefully. Complex elements (charts, SmartArt, 3D effects) show placeholders instead of breaking.

## Dependencies

| Package | Purpose | Size |
|---|---|---|
| `jszip` | Extract PPTX archive (XML + media) | ~50KB |
| `html2pdf.js` | Slide grid → PDF export (shared with DOCX/XLSX) | ~300KB (shared) |

Both lazy-imported. No heavy rendering engines.

## PPTX structure primer

A `.pptx` file is a ZIP containing:

```
[Content_Types].xml
ppt/
  presentation.xml          ← slide order, slide size
  slides/
    slide1.xml … slideN.xml ← per-slide shapes and content
  slideLayouts/             ← layout templates (title, two-column, etc.)
  slideMasters/             ← master slide styles
  theme/
    theme1.xml              ← color scheme, fonts
  media/
    image1.png …            ← embedded images/videos
  _rels/                    ← relationship files linking slides to layouts/masters
```

Each slide XML describes shapes in EMUs (English Metric Units, 914400 EMU = 1 inch) with absolute positioning, text runs with formatting, and references to images/layouts/masters.

## Implementation

### 1. Type system wiring

**`src/types/files.ts`** — Add `Presentation = 'presentation'` to `FileType` enum. Add `case 'pptx':` returning `FileType.Presentation` in `getFileType()`. Skip `.ppt` (legacy binary format — show toast).

**`src/types/editor.ts`** — Add `'presentation'` to the `EditorTab['type']` union.

**`src/lib/notes/editor-tab-from-path.ts`** — Add `case FileType.Presentation: return 'presentation'`. Keep extension visible in title (like code files).

**`src/lib/notes/tree-filter.ts`** — Add `entry.type === FileType.Presentation` to `isNotesTreeEntry`.

### 2. File tree icon

**`src/components/notes/notes-file-tree.tsx`** — Import `Presentation` from lucide-react. Add to the icon switch with an orange accent (`text-orange-400/70`) matching the PowerPoint association.

### 3. PPTX parsing engine

**New file: `src/lib/presentation/parse-pptx.ts`**

The core parser. Takes `Uint8Array`, returns a structured representation of the presentation.

```ts
interface PptxPresentation {
  slideWidth: number        // in pixels (converted from EMU)
  slideHeight: number
  slides: PptxSlide[]
  theme: PptxTheme
}

interface PptxSlide {
  index: number
  elements: SlideElement[]
  background?: SlideBackground
  notes?: string
}

type SlideElement =
  | TextBoxElement
  | ImageElement
  | ShapeElement
  | GroupElement
  | TableElement
  | PlaceholderElement      // fallback for unsupported elements

interface TextBoxElement {
  type: 'textbox'
  x: number; y: number; w: number; h: number
  rotation?: number
  paragraphs: TextParagraph[]
}

interface TextParagraph {
  align?: 'left' | 'center' | 'right' | 'justify'
  runs: TextRun[]
  bullet?: { char?: string; numbered?: boolean }
  spacing?: { before?: number; after?: number; line?: number }
}

interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: number         // in pt
  fontFamily?: string
  color?: string            // resolved hex (not theme ref)
  highlight?: string
  link?: string
}

interface ImageElement {
  type: 'image'
  x: number; y: number; w: number; h: number
  rotation?: number
  src: string               // blob URL from extracted media
  alt?: string
}

interface ShapeElement {
  type: 'shape'
  x: number; y: number; w: number; h: number
  rotation?: number
  preset?: string           // e.g. 'rect', 'roundRect', 'ellipse', 'arrow'
  fill?: string             // hex color
  stroke?: { color: string; width: number }
  text?: TextParagraph[]    // shapes can contain text
}

interface TableElement {
  type: 'table'
  x: number; y: number; w: number; h: number
  rows: TableRow[]
}

interface TableRow {
  height: number
  cells: TableCell[]
}

interface TableCell {
  width: number
  paragraphs: TextParagraph[]
  fill?: string
  borderTop?: string
  borderRight?: string
  borderBottom?: string
  borderLeft?: string
  colspan?: number
  rowspan?: number
}

interface SlideBackground {
  color?: string
  image?: string            // blob URL
  gradient?: { stops: Array<{ pos: number; color: string }> }
}

interface PptxTheme {
  colors: Record<string, string>    // dk1, lt1, accent1-6, etc. resolved to hex
  fontHeading: string
  fontBody: string
}

interface GroupElement {
  type: 'group'
  x: number; y: number; w: number; h: number
  children: SlideElement[]
}

interface PlaceholderElement {
  type: 'placeholder'
  x: number; y: number; w: number; h: number
  label: string             // e.g. "Chart", "SmartArt", "Video"
}
```

**Parsing flow:**
1. Open ZIP with JSZip
2. Parse `ppt/presentation.xml` for slide size and slide order
3. Parse `ppt/theme/theme1.xml` for color scheme and font definitions
4. For each slide:
   a. Parse `ppt/slides/slideN.xml`
   b. Resolve layout/master inheritance via `_rels` for placeholder text and background
   c. Walk the shape tree (`<p:sp>`, `<p:pic>`, `<p:grpSp>`, `<p:graphicFrame>`)
   d. Convert EMU positions to pixels (÷ 914400 × 96)
   e. Resolve theme color references (`scheme="accent1"`) to hex via the theme
   f. Extract images from `ppt/media/` as blob URLs
   g. For unsupported element types (charts, SmartArt, OLE), emit a `PlaceholderElement`
5. Return `PptxPresentation`

**What this handles well:** text boxes, images, basic shapes (rectangles, ellipses, arrows, lines), tables, backgrounds (solid + image), grouped shapes, bullet lists, text formatting (bold, italic, underline, font size, color), slide master inheritance for backgrounds and placeholder text.

**What it renders as placeholders:** charts, SmartArt, embedded video, 3D effects, complex gradients with multiple stops, pattern fills. These show a grey box with a label like "Chart" or "SmartArt" — honest about the limitation instead of rendering garbage.

### 4. Slide renderer component

**New file: `src/components/notes/slide-renderer.tsx`**

Renders a single `PptxSlide` to HTML/CSS with absolute positioning, matching the original slide dimensions.

```
SlideRenderer({ slide, theme, width, height, scale })
```

- Container `<div>` with `position: relative`, sized to `slideWidth × slideHeight`, scaled via CSS `transform: scale()`
- Each `SlideElement` maps to a positioned `<div>`:
  - **TextBoxElement** → `<div>` with `position: absolute`, inner `<p>` per paragraph, `<span>` per run with inline styles
  - **ImageElement** → `<img>` with object-fit, positioned absolutely
  - **ShapeElement** → `<div>` with `border-radius` for preset shapes, `background-color` for fill, `border` for stroke. Text inside rendered like TextBoxElement. Common presets: `rect` → `border-radius: 0`, `roundRect` → `border-radius: 6px`, `ellipse` → `border-radius: 50%`
  - **TableElement** → `<table>` with explicit cell widths, borders, fills
  - **GroupElement** → nested `<div>` with relative positioning, children positioned inside
  - **PlaceholderElement** → grey box with centered label text and a lucide icon (e.g. `BarChart3` for charts)
- Rotation applied via `transform: rotate(Xdeg)` with `transform-origin: center`
- Background: solid color `<div>`, or `background-image` for image/gradient backgrounds

### 5. Presentation viewer component

**New file: `src/components/notes/presentation-viewer.tsx`**

The main viewer wrapping the slide renderer with navigation and controls.

```
PresentationViewer({ tabId, path, onRenamed })
```

**Layout — two modes:**

**Filmstrip mode (default):** Left sidebar with vertical slide thumbnails (small-scale `SlideRenderer` at ~15% size), main area shows the selected slide scaled to fit. Click a thumbnail to jump. Current slide highlighted with accent border.

**Grid mode:** All slides in a responsive grid, useful for overview. Toggle between modes via a toolbar button.

**Toolbar (top bar):**
- `InlineFileTitle` for rename + `.pptx` badge
- Slide counter: "3 / 12"
- Previous / Next buttons (arrow icons)
- Filmstrip / Grid toggle
- Zoom: fit-to-width (default), fit-to-height, percentage
- "Export PDF" button
- Speaker notes toggle (if notes exist)

**Keyboard navigation:**
- `←` / `→` or `↑` / `↓` — previous / next slide
- `Home` / `End` — first / last slide
- `F` — toggle filmstrip / grid
- `N` — toggle speaker notes panel

**Speaker notes:** If `slide.notes` is present, show in a collapsible panel below the slide (subtle `bg-bg-secondary`, `text-fg-secondary`, `text-sm`). Collapsed by default.

**Slide scaling:** The selected slide scales to fit the available viewport width while preserving aspect ratio. This is purely CSS — `SlideRenderer` renders at native resolution, a parent `<div>` applies `transform: scale(fitRatio)` with `transform-origin: top center`.

### 6. PDF export

**New file: `src/lib/presentation/export-pdf.ts`**

```ts
export async function exportPresentationAsPdf(
  slides: PptxSlide[],
  theme: PptxTheme,
  slideWidth: number,
  slideHeight: number,
  filename: string,
): Promise<Uint8Array>
```

- Create an offscreen container
- Render each slide at native resolution via `SlideRenderer` into the offscreen DOM
- Dynamically import `html2pdf.js`
- Configure jsPDF with page size matching the slide aspect ratio (landscape by default — most presentations are 16:9 or 4:3)
- Capture each slide as a page using html2canvas
- Combine into a multi-page PDF
- Clean up offscreen DOM
- Return `Uint8Array` for vault write

**In the viewer**, the Export PDF button:
1. Shows "Exporting…" state with a progress bar (per-slide progress)
2. Calls the export utility
3. Writes `<name>.pdf` next to the source file
4. Toast + `ink:vault-changed`

### 7. View routing

**`src/components/views/notes-view.tsx`** — Import `PresentationViewer`. Add branch:

```tsx
) : activeTab?.type === 'presentation' ? (
  <PresentationViewer
    key={activeTab.id}
    tabId={activeTab.id}
    path={activeTab.path}
    onRenamed={vaultChanged}
  />
)
```

### 8. Styling

**`src/app/globals.css`** — Scoped styles:

- `.slide-container`: centered, subtle drop shadow (`0 2px 12px rgba(0,0,0,0.08)`), `border-radius: 2px`, matching the docx-preview paper look
- Filmstrip thumbnails: `border: 2px solid transparent`, active: `border-color: var(--color-accent)`, hover: `border-color: var(--color-border-strong)`
- Grid mode: `gap: 1rem`, slides at uniform size, hover lifts shadow slightly
- Speaker notes panel: `border-top: 1px solid var(--color-border)`, `max-height: 30%`, scrollable
- Placeholder boxes: `bg-bg-tertiary`, dashed border, centered icon + label, `text-fg-muted`
- Dark mode: slide backgrounds render as-is (white slides stay white), the surrounding canvas goes dark (`bg-bg-secondary`)

## File summary

| File | Action |
|---|---|
| `src/types/files.ts` | Add `Presentation` to enum + `getFileType` |
| `src/types/editor.ts` | Add `'presentation'` to type union |
| `src/lib/notes/editor-tab-from-path.ts` | Add Presentation case |
| `src/lib/notes/tree-filter.ts` | Add Presentation to filter |
| `src/components/notes/notes-file-tree.tsx` | Add icon |
| `src/lib/presentation/parse-pptx.ts` | **New** — OOXML parser |
| `src/components/notes/slide-renderer.tsx` | **New** — single slide HTML renderer |
| `src/components/notes/presentation-viewer.tsx` | **New** — viewer with filmstrip/grid/nav |
| `src/lib/presentation/export-pdf.ts` | **New** — multi-page PDF export |
| `src/components/views/notes-view.tsx` | Add routing branch |
| `src/app/globals.css` | Add slide/filmstrip styles |
| `package.json` | Add `jszip` |

## Rendering coverage

What looks correct:

- Text boxes with full formatting (bold, italic, underline, font, size, color, alignment)
- Bullet and numbered lists
- Images (PNG, JPEG, SVG, EMF rasterized)
- Basic shapes (rectangles, rounded rects, ellipses, lines, arrows) with solid fills and strokes
- Tables with borders and cell fills
- Slide backgrounds (solid color, image, simple gradients)
- Grouped shapes
- Master/layout slide inheritance for backgrounds and placeholder defaults
- Rotation on any element

What shows as a placeholder:

- Charts (bar, line, pie, etc.) — grey box labeled "Chart"
- SmartArt diagrams — grey box labeled "SmartArt"
- Embedded video/audio — grey box labeled "Video" / "Audio"
- 3D effects and complex transforms
- Pattern fills and multi-stop gradients
- WordArt with transforms
- Animations and transitions (static render only)

## Incremental enhancement path

The parser can be improved over time without changing the viewer architecture:

1. **v1** — text, images, shapes, tables, backgrounds (this plan)
2. **v2** — gradients with multiple stops, connectors, more shape presets, better EMF/WMF handling
3. **v3** — basic chart rendering (bar/line/pie via a lightweight chart lib like recharts, already in deps)
4. **v4** — SmartArt as simplified box diagrams

Each step adds new element types to the parser and corresponding renderers to `slide-renderer.tsx` without touching the viewer chrome.

## Out of scope (v1)

- Editing slides
- Legacy `.ppt` format
- Animations and transitions
- Presenter mode / fullscreen slideshow
- Chart rendering
- SmartArt rendering
- Embedded video playback
- Search within slides
