# Mentis — Architecture

## 1. High-Level Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                            Mentis                                   │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │  Markdown     │ │  PDF Engine  │ │  Canvas     │ │  Shell     │  │
│  │  Editor       │ │              │ │  Engine     │ │  (Vault,   │  │
│  │  (Tiptap /    │ │  (PDF.js +   │ │             │ │   Search,  │  │
│  │  ProseMirror) │ │  pdf-lib +   │ │  (PixiJS)   │ │   Graph,   │  │
│  │              │ │  Fabric.js)  │ │             │ │   New)     │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬──────┘ └─────┬──────┘  │
│         │                │                │              │          │
│  ┌──────┴────────────────┴────────────────┴──────────────┴───────┐  │
│  │                    Core Data Layer                             │  │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────────┐            │  │
│  │  │ File I/O │  │ Search    │  │ Snapshot Manager │            │  │
│  │  │ Adapter  │  │ Index     │  │ (version safety  │            │  │
│  │  │          │  │ (MiniSearch│  │  net for PDFs)   │            │  │
│  │  │          │  │  / Lunr)  │  │                  │            │  │
│  │  └──────────┘  └───────────┘  └──────────────────┘            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │             Platform Adapter                                   │  │
│  │   Web: OPFS / File System Access API                           │  │
│  │   Desktop (Tauri): Native FS                                   │  │
│  │   Mobile (Capacitor/Tauri): Sandboxed FS                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Layer Responsibilities

### 2.1 Presentation Layer

Primary navigation (**Vault**, **Board**, **Tasks**, **Bookmarks**, **Graph**, **Files**, **Search**, **New** popover) plus editor surfaces (markdown, PDF, canvas, image preview). Planned: **Calendar** (Ctrl+5), **Chat** (conditional, Ctrl+1 when LLM endpoint is configured).

| Module | Responsibility |
|---|---|
| **View Manager** | Top-level router. Manages the primary views (Vault, Board, Bookmarks, Graph, Files, Search, New) and editor panes. **Vault** (`Ctrl+1`) always renders the Notes/Preview pane (file tree + editor). **Files** (`Ctrl+7`) renders `FileBrowserView` with `showHidden=true`, exposing all vault folders including `_marrow`, `_board`, `_bookmarks`, etc. — a power-user raw view. When Dropbox sync is configured a sync button appears in the sidebar header. **Desktop (≥768px):** `MainSidebar` shows the full nav in order: Vault / Board / Tasks (soon) / Bookmarks / Calendar (soon) / Graph / Files / Search, plus New popover, theme, Settings, Close vault. **Narrow viewports (≤767px, `MOBILE_NAV_MEDIA_QUERY` in `lib/browser/breakpoints.ts`):** the main sidebar is hidden; `MobileNavMasthead` in `app-shell.tsx` shows a hamburger that opens a left sheet with **New** first (inline accordion — tap expands Note / File / Drawing sub-items), then Vault / Search / Graph, then theme / Settings / Close vault. Note and Drawing create immediately and close the drawer; File opens a native file picker for import. **Ctrl+N** opens the sheet (and auto-expands the New accordion) on narrow viewports; the desktop `MainSidebar` `NewFilePopover` disables the global shortcut listener while narrow so a hidden trigger does not open a stray popover. Creation logic is shared via `useNewFileActions` hook (`lib/notes/use-new-file-actions.ts`). Handles sidebar navigation, keyboard shortcuts, and view transitions. **Image** files in the tree (see `isNotesTreeEntry`) open as `EditorTab` type `image`. **PNG / JPEG / WebP:** `ImageEditorView` (`components/notes/image-editor-view.tsx`) — canvas pipeline in `lib/browser/image-edit-pipeline.ts` (rotate, edge-trim crop, brightness/contrast/saturation, save overwrites vault file, evicts `image-thumbnail` cache). **GIF, SVG, BMP, ICO:** plain preview via `VaultImageView`. `lib/notes/editor-tab-from-path.ts` maps paths to tab type/title. |
| **Markdown Editor** | Tiptap/ProseMirror WYSIWYG plus optional **Source** toggle (raw `.md`). Wiki-links (`[[note]]` / `[[note|alias]]`): inline node, `[[` autocomplete (Suggestion), click navigates via `resolveWikiLinkPath`. Slash commands, debounced save. **Mode bar** (compact): icon-only Visual / Source segment; icon + chevron opens Radix dropdown — **Markdown** downloads `.md` (`downloadTextFile`), **Print** opens browser print with styled HTML (`buildExportHtml` + `printExportHtml`, save as PDF from the dialog). Embedded PDF page nodes in-editor remain planned. |
| **File Browser** | Grid/list view of vault files (🗂️ **Browse** in Vault). Header shows `VaultConfig.name` at vault root and `name / folder/path` when inside a subfolder (not the literal “File Browser” label). Sort (name/date/size/type), type filters, right-click context menu (Open/Rename/Duplicate/Move/Delete), batch multi-select, drag-and-drop import zone, `_inbox/` shortcut. PDF thumbnail via PDF.js first-page render (blob URL cache in `lib/pdf/thumbnail.ts`). Image thumbnails via blob URL cache in `lib/file-browser/image-thumbnail.ts` (grid: 56×56 rounded; list: 20×20 inline). |
| **PDF Engine** | PDF.js renders pages into `<canvas>` elements; Fabric.js overlays handle highlight rectangles, freehand ink paths, editable text boxes (FreeText), comment markers (`PdfTextComment`), and signature stamps (Stamp). **Comments (P6/P7):** Comment tool sets `pendingPdfComment` in `usePdfStore`; `PdfCommentDialog` (Radix) collects text; `PdfPageCommentRail` lists per-page comments beside the page (Word-like margin). **Persistence:** `annotation-writer.ts` draws highlights, ink, FreeText, and stamps into page **content**; **text comments** are written as native `/Text` annotations (`Contents`, `NM`, custom `InkMarrow` for idempotent saves). `annotation-reader.ts` hydrates `/Highlight`, `/Ink`, and `/Text` via `getAnnotations`; loader uses `addAnnotation(..., { fromLoader: true })` so the doc is not marked unsaved. After autosave the viewer reloads file bytes so the raster layer matches disk. `PdfToolbar` manages Select/Highlight/Draw/Text/Comment/Sign modes (Text tool hint strip; **P14** separate swatches: `highlightColor`, `drawColor`, `textColor` in `usePdfStore`), stroke width, zoom, page nav, signature picker, form dialog, **find-in-document** (`search-pdf-text.ts`, pdf.js `getTextContent`, canvas overlays), and **Undo/Redo** for page operations. Save and Flatten buttons have been removed (autosave uses vault `autoSave`, default 5s interval + optional blur); the Side Panel toggle is also removed (the side column has its own expand/collapse rail). **Undo/Redo:** `PdfUndoStack` (`lib/pdf/undo-stack.ts`) stores up to 20 snapshots of raw PDF bytes; `applyPageOp` pushes pre-operation bytes before each transform; `Ctrl+Z` / `Ctrl+Shift+Z` keyboard shortcuts are wired at the viewer level. **Side column (`PdfSideColumn`):** a single collapsible left column with two tabs — **Pages** (default, page thumbnails via `PdfPagePanel`) and **Outline** (`PdfOutlineContent` tree). Collapsed: slim `w-9` rail with Layers icon to re-expand. Auto-collapses when `pages.length <= 1` (e.g. a new blank PDF). Outline reads the PDF bookmark tree for navigation. `SignaturePadDialog` lets users draw or upload signatures stored in `_marrow/signatures/index.json`. Placing a stamp switches to **Select**; `object:modified` writes `Stamp` `rect` back to the store so moves/scales persist on save. Auto-save uses `VaultConfig.autoSave` (`intervalMs`, default 5s; `saveOnBlur`; can be disabled in Settings); `PdfViewer` reads it from `useVaultStore`. A snapshot is created on first edit via `lib/snapshot`. **Pen / ink:** Fabric pencil paths are simplified to M/L/Q/C/Z; `fabric-path-to-pdf-points.ts` expands curves to polylines so `annotation-writer` always receives enough points for `drawLine`. **Page management**: toolbar **Add page** calls `appendBlankPage` so the insert index comes from pdf-lib `getPageCount()` on current bytes (avoids stale React `pages.length`). `PdfPagePanel` displays draggable thumbnails with **multi-select** (Ctrl/Cmd+click toggles, Shift+click selects range); selected pages show accent tint + badge, and a **Save** icon appears in the toolbar to extract them into a new PDF (opens as a new tab via `extractPages`). Operations (insert blank, delete, rotate, reorder, merge) go through `lib/pdf/page-operations.ts` which uses pdf-lib's `copyPages`/`removePage`/`insertPage`/`setRotation`. `PdfFormDialog` uses `getFormFields` (returns `[]` if none or unreadable — P10); fills via `setText`/`check`/`select` when fields exist. |
| **Canvas Engine** | `CanvasEditor` uses **PixiJS v8** (WebGL) for a raster-first, layer-based drawing surface (Magma/Photoshop style). 3-column layout: vertical **ToolStrip** (48px, left), **PixiJS canvas** (center, infinite pan/zoom 0.1×–10×), **PropertiesPanel** (260px, right — Color/Brush/Layers). Each layer is a `RenderTexture` displayed as a `Sprite` inside a viewport `Container`. **Brush engine** (`lib/canvas/brush-engine.ts`) offers Pencil (Catmull-Rom spline), Pen/Ink (velocity-sensitive width), and Marker (large soft stamp) strokes; Eraser uses PixiJS `erase` blend mode. Live strokes are drawn into a `Graphics` object and committed to the active layer's `RenderTexture` on `pointerup`. Pressure sensitivity via Pointer Events API. **Layers:** add, remove, duplicate, rename, reorder, per-layer opacity + blend mode (11 modes). Undo/redo stores per-layer pixel snapshots (base64 PNG). Keyboard: V/B/N/M/E/T/G (select / pencil / pen / marker / eraser / text / fill), `[`/`]` brush size, Ctrl+Z/Y undo/redo, Ctrl+S save. Auto-save ~3s + visibility/blur + flush before rename. Export PNG/PDF. `.canvas` v2 JSON stores `layers[]` (each with base64 `imageData`) and `viewport`. |
| **Graph View** | Interactive force-directed visualization of note connections. `buildNoteGraph` scans all markdown files for wiki-links and builds a node+edge model. `GraphCanvas` renders via Canvas 2D with drag, pan, zoom, and click-to-open. Filter by folder dropdown. No external dependencies. |
| **Kanban Editor** | Markdown-based Kanban boards. A `.md` file with `type: kanban` in frontmatter is rendered as a drag-and-drop board instead of the markdown editor. Columns are `## Headings` with optional `<!--kanban:color-->` (slate, amber, sky, emerald, violet, rose, zinc); cards are `- [ ]` / `- [x]` items. Cards drag via grip handle (`application/x-ink-kanban-card`); columns reorder via header grip (`application/x-ink-kanban-column`). Narrow columns; cards use max-height with scroll. Color swatches per column. New file name `Kanban YYYY-MM-DD.md` with default column tints (amber / sky / emerald). `detectEditorTabType` in `lib/notes/editor-tab-from-path.ts`; `notes-view.tsx` renders `KanbanEditor`. Auto-save ~750ms via `lib/kanban/index.ts`. Regular vault `.md` — searchable, syncable, readable externally. |
| **Files View** | Full file browser (`Ctrl+7`). Same `FileBrowserView` component as before but rendered with `showHidden=true`, exposing all vault folders including `_marrow`, `_board`, `_bookmarks`, `_inbox`. Intended as a power-user raw view. |
| **Board View** | Quick-capture notice board (`Ctrl+2`). Items called **Thoughts** are `.md` files in `_board/` (hidden from file tree/browser/search). Frontmatter stores `type` (future: bookmark, list, reminder, task, audio), `color`, timestamps. Title derived from the first `# H1` line if present. Masonry CSS-columns layout with pastel-tinted cards. Click to edit inline via a minimal Tiptap instance (bold/italic/underline/lists via keyboard shortcuts only — no toolbar, no font changes). Image thoughts: image stored in `_board/_assets/`, rendered as card with embedded preview. `useBoardStore` (`stores/board.ts`) manages CRUD; `lib/board/index.ts` handles parse/serialize; `lib/editor/board-extensions.ts` provides the slim extension set. |
| **Calendar View** | Local-first event calendar (`Ctrl+5`). Events are `.md` files in `_calendar/` (hidden from Vault/Search, visible in Files). Frontmatter: `uid`, `start`/`end` (ISO date or `YYYY-MM-DDTHH:mm`), `allDay`, `color` (violet/sky/emerald/amber/rose/slate), timestamps. Monthly grid view; tasks with due dates appear as greyed "task due" chips. Click any day to create an event; click a chip to edit/delete. Color-coded event chips per row. **Settings → Calendar** shows Google Calendar / Apple Calendar / Outlook sync controls (greyed, Coming soon). `useCalendarStore`; `lib/calendar/index.ts`; `components/calendar/`. |
| **Tasks View** | CalDAV-compatible local-first task manager (`Ctrl+3`). `.md` files in `_tasks/` (hidden from Vault/Search, visible in Files). Lists are subfolders. Frontmatter maps to iCalendar VTODO fields: `uid`, `status`, `priority` (1–4), `due`, `created`, `modified`, `completed`, `tags`, `parent`, `order`. Subtasks are separate `.md` files linked by `parent` UID in the same folder. **Quick-add bar** at the top parses natural language: `!1` priority, `#tag` tags, `>tomorrow` / ISO due dates, **on Wednesday** (next occurrence), **every Monday** / **on Wednesdays** (weekly `repeat` + `repeatWeekday`; checking off rolls `due` forward). Today/Upcoming filters use effective due dates so one recurring file does not appear as multiple rows. Two-panel layout: **sidebar** (Inbox with count, Today, Upcoming smart filters + user-created lists with counts) and **main list** (sorted by order/modified, completed greyed + struck through, "Clear completed" button). **Task row** shows checkbox, priority dot, title, due badge, subtask count, tag pills, hover edit/delete actions. Click opens **TaskDetailDialog** (Radix) for full editing: title, notes, priority, due, list, tags, subtask management. `.ics` export via `lib/tasks/ical.ts` (`taskToVTodo`, `exportTasksAsIcs`). `useTasksStore` (`stores/tasks.ts`) manages CRUD, toggle, reorder, move-to-list, clear-completed. `lib/tasks/index.ts` handles parse/serialize, tree building, date helpers. |
| **Bookmarks View** | Web bookmark manager (`Ctrl+4`). `.md` files in `_bookmarks/` with frontmatter storing URL, title, description, favicon, OG image, and tags. Categories are subfolders (`_bookmarks/tech/`, etc.). On add, `og-fetch.ts` attempts to scrape Open Graph metadata (title, description, image) and uses Google's favicon service for site icons — graceful degradation if CORS blocks the request. Two-panel layout: category sidebar (folder list with counts) + bookmark list (favicon, title, domain, description, OG thumbnail, tag pills). Add/edit via Radix Dialog. `useBookmarksStore` (`stores/bookmarks.ts`) manages CRUD + category operations; `lib/bookmarks/index.ts` handles parse/serialize. |
| **New View** | Tabbed creation screen with Markdown Note (name, folder picker, template), PDF Note (style, size → pdf-lib), Canvas, and Template Manager tabs. Templates stored in `_marrow/templates/`. **New file popover** (Ctrl+N / sidebar): Note, File, Drawing — no subtitles. File opens upload screen (drop zone + Browse) for importing into default folder; "Create blank PDF" shortcut uses `VaultConfig.pdfPageStyle` (Blank/Lined/Grid, configurable in Settings > Vault). |

### 2.2 Core Data Layer

| Module | Responsibility |
|---|---|
| **File I/O Adapter** | Abstract interface for filesystem operations (read, write, list, move, delete, watch). Implementations: `OpfsAdapter`, `FsapiAdapter`, `TauriAdapter`, `CapacitorAdapter`. `rename()` handles both files (`getFileHandle`) and directories (`getDirectoryHandle`), preferring the atomic `move()` API when available, with a `copyDirRecursive` + `removeDir` fallback for older engines. Vault rename UIs use `vaultPathsPointToSameFile` (`lib/fs/vault-path-equiv.ts`) so `exists(newPath)` does not block when the “collision” is the same file (e.g. case-only paths on case-insensitive hosts). |
| **Search Index** | MiniSearch in `src/lib/search/` indexes markdown title/body (length-capped), flattened tags (`#tag` + YAML `tags`), and PDF/canvas titles/paths. Full rebuild when the vault opens (`VaultSearchBootstrap`); incremental `upsert` on markdown save/rename. Search view runs debounced queries, optional filters, and match snippets. |
| **Snapshot Manager** | Creates and manages PDF version snapshots in `_marrow/snapshots/`. Handles retention policies (max per file, retention days) and pruning. |
| **Vault Manager** | Manages vault lifecycle: open, create, switch, close. Reads `_marrow/config.json` for settings. Exposes vault metadata (name, path, stats). |
| **Sync Engine** | Optional cloud sync: **Dropbox** only (`lib/sync/providers/dropbox.ts` — HTTP API v2, OAuth 2 PKCE; **Full Dropbox** scoped access; absolute paths like `/Apps/Mentis/<vault>`). Content endpoints use `Dropbox-API-Arg` with UTF-8 JSON encoded for `fetch()` header rules (Unicode paths). `SyncManager` (`lib/sync/sync-manager.ts`) runs `fullSync` on vault open, `pushFile` after saves, `pull` on a poll interval. `RemoteSyncProvider` in `lib/sync/types.ts`. `SyncState` + `TokenStore` in IndexedDB (tokens keyed by `vaultId` = active vault path); `ChangeDetector` hashes local files. Last-write-wins by `modifiedAt`. `SyncProvider` (`contexts/sync-context.tsx`) starts when `VaultConfig.sync.provider === 'dropbox'` and a token exists for that vault. `useSyncPush` for editor saves; **Vault** toolbar shows a manual sync control when Dropbox is configured. Settings → Sync uses `VaultDropboxSyncPanel` for connect/disconnect and remote folder. [`CLOUD_SYNC.md`](./CLOUD_SYNC.md). OAuth: `app/auth/dropbox/page.tsx`; `lib/sync/oauth-session.ts` stashes `vaultId` + `remoteRoot`. |

### 2.3 Platform Adapter Layer

Abstracts platform-specific file system access behind a common interface.

| Platform | Adapter | Notes |
|---|---|---|
| **Web (Chromium)** | `FsapiAdapter` | File System Access API for "open folder" vault access. Full read/write to user's chosen directory. **Persistence:** `FileSystemDirectoryHandle` stored in IndexedDB (`lib/fs/handle-store.ts`); on reload, `queryPermission` restores silently if already granted, otherwise a "Reconnect" prompt appears on the landing page. |
| **Web (fallback)** | `OpfsAdapter` | Origin Private File System. Works in all modern browsers including Safari. Vault lives in browser-managed storage. |
| **Desktop** | `TauriAdapter` | Tauri v2 FS plugin. Direct native filesystem access. |
| **Mobile** | `CapacitorAdapter` | Capacitor Filesystem plugin. Sandboxed storage with cloud sync integration points. |

## 3. Vault File Structure

```
my-vault/
├── _marrow/                    # App metadata (hidden from note tree)
│   ├── config.json             # Vault settings, theme, preferences
│   ├── signatures/             # Saved signature images
│   ├── templates/              # Note templates
│   ├── search-index.json       # Cached full-text search index
│   └── snapshots/              # Auto-saved PDF version snapshots
│
├── _inbox/                     # PDF import landing zone
│
├── Projects/                   # User folders
│   ├── Project Alpha/
│   │   ├── overview.md
│   │   ├── contract.pdf
│   │   ├── brainstorm.canvas
│   │   └── _assets/
│   │       └── diagram.png
│   └── Project Beta/
│       └── notes.md
│
├── Journal/
│   ├── 2026-03-20.md
│   └── 2026-03-19.md
│
└── inbox.md                    # Default capture note
```

### Reserved Directories

| Directory | Purpose | Hidden from UI tree |
|---|---|---|
| `_marrow/` | App metadata, config, templates, snapshots, signatures | Yes |
| `_inbox/` | PDF import landing zone | No (shown as special folder) |
| `_assets/` | Per-folder asset storage for embedded images/files | Yes (assets shown inline in notes) |
| `_board/` | Board (Thoughts) quick notes | Yes |
| `_bookmarks/` | Saved web bookmarks; subfolders = categories | Yes |
| `_tasks/` | Tasks and lists; subfolders = lists | Yes |

## 4. Destructive PDF Write Model

### Write Lifecycle

1. **Open** — PDF.js renders the file. Existing standard PDF annotations are detected and displayed as editable Fabric.js objects on the canvas overlay.
2. **First edit** — Before the first mutation in a session, Mentis copies the current PDF to `_marrow/snapshots/<filename>_<ISO-timestamp>.pdf`.
3. **Edit** — User highlights, draws, signs, adds text boxes, reorders pages. Changes are held in memory on the Fabric.js canvas layer.
4. **Persist** — On auto-save (`VaultConfig.autoSave`: interval, default 5s; optional window blur; can be disabled in Settings), `pdf-lib` loads the current PDF bytes, `writeAnnotationsIntoPdf` applies them (highlights / ink / FreeText / stamps drawn into **content**; text comments as native `/Text` with `InkMarrow`), then bytes are written back to the file system. There is no PDF-specific **Save** button in `PdfToolbar` (canvas and Settings still use **Ctrl/Cmd+S** for their own save actions).
5. **Close** — Any unsaved changes are flushed. The file on disk is fully up to date.

### Annotation Type Mapping

| Mentis feature | PDF Annotation Type | Standard |
|---|---|---|
| Highlight | Drawn into page content (visual parity with `/Highlight`) | — |
| Freehand drawing | Drawn into page content (visual parity with `/Ink`) | — |
| Text comment | Native `/Text` (`InkMarrow` for strip on save) | PDF 1.7 §12.5.6.4 |
| Text box | Drawn text (visual parity with FreeText) | — |
| Signature | Drawn image (visual parity with stamp) | — |

### Snapshot Configuration

```json
{
  "snapshots": {
    "enabled": true,
    "maxPerFile": 5,
    "retentionDays": 30
  }
}
```

### Write Safety

- Write to a temp file first, then atomic rename to prevent corruption on interrupted writes.
- Snapshot created before first edit provides rollback safety net.
- Oldest snapshots beyond `maxPerFile` or `retentionDays` are pruned on vault open.

## 5. Data Flow Diagrams

### 5.1 Markdown Note Lifecycle

**Implemented (Phase 1, Notes view):** wiki `[[links]]` are rewritten to `<span data-type="wiki-link">` before **marked** runs; **turndown** has a custom rule to emit `[[…]]` again. Load uses **marked** → **@tiptap/html** `generateJSON` → `setContent`; save uses **@tiptap/html** `generateHTML` → **turndown** for the note body, then **gray-matter** (`serializeNote`) to merge YAML frontmatter before `vaultFs.writeTextFile`. **Source** mode edits the full `.md` string in a textarea (including YAML); switching back to **Visual** parses with **gray-matter** and reloads the body into Tiptap. **NotesWorkspaceProvider** refreshes a vault-wide list of `.md` paths for wiki completion and backlinks. **Notes file tree (left column)** is collapsible: header control collapses to a slim folder rail; tap the rail to expand. At ≤767px the tree defaults collapsed on load and when crossing that breakpoint; expanding uses a left overlay + scrim (same idea as backlinks on narrow). Expanded folders load children lazily (`TreeNode` + `readdir`); `refreshToken` from `NotesView` (`treeRefresh`, bumped by `vaultChanged` / `onNoteCreated`) is passed into each `TreeNode` so internal DnD moves and imports refresh open subtrees without collapse/reopen. **BacklinksPanel** (right column) is collapsible: at viewport width ≤1024px it starts collapsed as a slim rail (link icon + count); expanding opens an overlay above the editor with a scrim to dismiss. **Resizing** the window into the narrow backlinks breakpoint auto-collapses the backlinks panel to the rail (so an open overlay does not stay open on a too-narrow width). Wider viewports start expanded with a fixed-width column; the header chevron collapses to the same rail. **remark/unified** remains planned for search indexing and richer transforms.

```
User types in editor
        │
        ▼
Tiptap ProseMirror state update
        │
        ▼
Debounced body → Markdown (turndown) + frontmatter (gray-matter)
        │
        ▼
File I/O Adapter.writeTextFile(path, full .md)
        │
        ▼
Platform FS writes to disk (OPFS vault)
        │
        ▼
Search index upsert on markdown save / rebuild on vault open   ← implemented (PDF body text ← planned)
```

### 5.2 PDF Annotation Lifecycle

```
User draws/highlights/signs on PDF
        │
        ▼
Fabric.js canvas captures objects
        │
        ▼
Auto-save timer fires (vault `autoSave.intervalMs`, default 5s / optional blur)
        │
        ▼
Snapshot Manager: create snapshot if first edit
        │
        ▼
pdf-lib: load PDF bytes → write annotations → serialize
        │
        ▼
File I/O Adapter.write(path, pdfBytes)
        │
        ▼
Platform FS writes to disk
```

### 5.3 Canvas Lifecycle

```
User draws/erases on PixiJS canvas (brush/eraser/fill)
        │
        ▼
Stroke committed to active layer RenderTexture
        │
        ▼
Serialize layers to .canvas v2 JSON (base64 PNG per layer)
        │
        ▼
File I/O Adapter.write(path, canvasJson)
        │
        ▼
Platform FS writes to disk
```

On editor unmount (e.g. switching tabs away from a `.canvas` tab) or when the **vault path** to the same tab changes (inline rename), the Pixi `useEffect` cleanup runs **asynchronously** after `await handleSave()`. Pointer-up draws with an async pipeline (undo extract → render stroke → `markDirty`); **all saves** await a shared `strokeCommitLock` first so `handleSave` never reads layer pixels between extract and commit (which previously dropped random strokes). `forcePresent` repaints guard on mount generation and wrap `app.render` in try/catch so ResizeObserver / rAF cannot throw after teardown (`geometry` null). The flush **captures** `path`, `app`, and `layerRuntimes` **synchronously** at cleanup start: the next effect can overwrite `pathRef` / `appRef` / `layerRuntimesRef` (React Strict Mode remount, or path change) while the previous save is still `await`ing — without that snapshot, `collectLayerData` could read **empty** runtimes or write to the **wrong** path, dropping earlier strokes from the saved file. A **new** effect may already have incremented a **mount generation** and repointed shared refs (`appRef`, `layerRuntimesRef`, `viewportRef`). The stale cleanup must **only** call `destroy()` on its **closed** `Application` from the effect closure — it must **not** clear those shared refs or `resetStore()` when `canvasMountGenRef.current !== mountGen`, or it destroys the **new** mount’s sprites (`setChildIndex` throws; canvas goes blank). On each fresh init, `canvasReadyRef` is cleared and `layerRuntimesRef` is reset before loading layers. The flush save **must await** serialization while the Pixi `Application` and layer `RenderTexture`s still exist. Destroying GPU resources before `extract.base64` completes would persist null layer pixels and reload as a blank canvas. Saves must not run before the initial file load and layer runtimes are ready (avoids writing an empty `layers` array). If GPU readback fails, keep the last known `imageData` from the store instead of replacing with `null`. Before `writeTextFile`, if **every** collected layer has **no** PNG but the **on-disk** file still has large PNGs, **`mergeCanvasLayerDataWithDiskFallback`** copies bytes from disk (by layer id, then index, then single-layer last resort) so a bad save cannot shrink a ~400KB file into a ~400B empty JSON. Pixi is initialized with `preference: 'webgl'` for reliable texture readback across environments.

**Pixi v8:** `Texture.from(string)` is **cache alias lookup only** (not image decode). Layer PNGs stored as `data:image/png;base64,...` must be decoded via `HTMLImageElement` / `ImageBitmap` first — see `lib/canvas/texture-from-data-url.ts` (`textureFromPngDataUrl`). Passing a raw data URL string caused `[Assets] Asset id … was not found in the Cache` and undefined textures (blank layers).

Runtime logs have shown successful `writeTextFile` while the user still saw a blank drawing area. Causes included: (1) switching **editor tabs** does not fire `document.visibilitychange`, so repaints must also be driven by `ResizeObserver` and **`IntersectionObserver`** on the Pixi host when it re-enters the layout; (2) calling `renderer.resize` manually while `resizeTo` is set can **fight** Pixi’s ResizePlugin — prefer `app.render()` and let `resizeTo` own dimensions; (3) optional `webgl.preserveDrawingBuffer` helps some GPUs composite after focus/tab changes; (4) **viewport** pan/zoom can move the entire fixed-size layer (4096²) off-screen so the GL view is white while layer pixels still exist — deserialize clamps zoom to a finite range, and after load we reset the viewport if the visible screen rect does not intersect the layer bounds; (5) **`handleSave` runs are serialized** so concurrent `extract` passes cannot interleave. The `.canvas` file remains JSON v2 with embedded PNG data URLs; sidecar `.png` files would be a larger product change (multi-file atomicity, sync) without fixing display bugs by itself.

## 6. Module Dependency Graph

```
View Manager (AppShell → ViewRouter → 4 views)
├── Markdown Editor
│   ├── Tiptap / ProseMirror
│   ├── marked + turndown + gray-matter (markdown ↔ HTML ↔ Tiptap JSON)
│   ├── File I/O Adapter
│   └── Search Index
├── PDF Engine
│   ├── PDF.js (rendering)
│   ├── Fabric.js (annotation overlay)
│   ├── pdf-lib (write-back)
│   ├── File I/O Adapter
│   ├── Snapshot Manager
│   └── Search Index
├── Canvas Engine
│   ├── PixiJS v8 (WebGL layer-based canvas)
│   ├── Brush Engine (Catmull-Rom splines)
│   ├── File I/O Adapter
│   └── Search Index
├── File Browser View
│   ├── File I/O Adapter
│   └── Search Index
├── Notes View
│   ├── File I/O Adapter
│   └── Search Index
├── Search View
│   └── Search Index
├── New View
│   ├── File I/O Adapter
│   └── pdf-lib (new PDF creation)
└── Sync Engine (optional, per-vault)
    ├── SyncManager → ChangeDetector → File I/O Adapter
    ├── SyncState (IndexedDB manifest)
    ├── TokenStore (IndexedDB OAuth tokens)
    └── DropboxProvider (HTTP API v2 + PKCE)
```

## 7. State Management

**Zustand** stores, organized by domain:

| Store | Responsibility |
|---|---|
| `useVaultStore` | Current vault state, config, vault path |
| `useFileTreeStore` | File/folder tree structure, selection state |
| `useEditorStore` | Active editor state, open tabs, unsaved changes |
| `usePdfStore` | Current PDF state, annotations, page info |
| `useCanvasStore` | Canvas layers, active layer, viewport, brush/tool settings, dirty flag |
| `useSearchStore` | Search query, results, filters |
| `useFileBrowserStore` | Browser view mode, sort, filter, multi-select |
| `useBoardStore` | Board items, active item, CRUD |
| `useBookmarksStore` | Bookmark items, categories, active category, CRUD |
| `useTasksStore` | Task items, lists, active list/filter, CRUD, toggle, reorder |
| `useUiStore` | View mode, sidebar state, theme, modals |

## 8. Performance Strategy

| Concern | Strategy |
|---|---|
| Large vault (10k+ files) | Lazy file tree loading. Virtualized lists. Incremental search indexing. |
| Large PDFs | Lazy page rendering (visible + 1 adjacent). PDF.js Web Worker. |
| Canvas with many layers | PixiJS WebGL GPU-accelerated rendering. Layer textures stay on GPU. Per-layer undo snapshots. |
| Search responsiveness | MiniSearch with pre-built index. Debounced incremental updates. |
| Memory management | Release PDF page canvases when scrolled out of view. LRU cache for thumbnails. |
| Startup time | Service Worker caches app shell. Search index loaded async. File tree loaded progressively. |

## 9. Security Considerations

| Concern | Mitigation |
|---|---|
| File system access scope | FSAPI requires user gesture to grant access. OPFS is sandboxed by origin. |
| PDF file integrity | Write to `.__ink_tmp`, verify `%PDF-` header, then rename. Pre-edit snapshots. Load-time header check logs corruption. |
| Storage persistence | `navigator.storage.persist()` called on vault open to prevent OPFS eviction. FSAPI `FileSystemDirectoryHandle` persisted in IndexedDB; cleared on close-vault. |
| Unsaved changes | `beforeunload` guard checks dirty tabs, PDF, and canvas stores. Canvas flushes on unmount. |
| Runtime crashes | `ErrorBoundary` wraps AppShell; shows recovery UI ("Try Again" / "Reload") instead of blank screen. |
| Cross-origin content | PDF.js sandboxes rendering. No external resource loading in notes. |
| Vault encryption (Phase 2) | Marrow Sync uses E2E encryption. Local vault encryption is a Phase 3 consideration. |

## 10. License & development practices

| Topic | Detail |
|---|---|
| **Source license** | The repository is under the **Business Source License 1.1** — see root [`LICENSE`](../LICENSE). BSL is not the same as an OSI “open source” license until the **Change Date**; after that, the stated **Change License** (MPL 2.0) applies to the covered version per the license text. |
| **Parameters (summary)** | **Licensor:** Marrow Group. **Licensed Work:** Mentis (this repo). **Additional Use Grant:** production use for any purpose (see full `LICENSE`). **Change Date:** 2030-04-09 (adjust in `LICENSE` if policy changes). |
| **`package.json`** | `"license": "SEE LICENSE IN LICENSE"` — full terms are only in `LICENSE`. |
| **AI-assisted development** | The README states that the project was built with AI-assisted tooling; maintainers review changes. That notice does **not** replace or narrow the BSL. Third parties remain responsible for their own compliance, security review, and due diligence. |

For conventions and where to document changes, see [`CONVENTIONS.md`](./CONVENTIONS.md) and [`CURSOR.md`](./CURSOR.md).
