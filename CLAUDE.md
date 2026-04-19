# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm dev:webpack      # Fallback if Turbopack fails
pnpm build            # Static export SPA
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # TypeScript type check
pnpm test             # Vitest (all tests)
pnpm test:ui          # Vitest UI
pnpm test:e2e         # Playwright E2E
```

To run a single test file: `pnpm test tests/search.test.ts`

**Requirements:** Node.js 20+, pnpm 9.15.0. Use `pnpm`, never `npm` or `yarn`.

## Architecture

**Mentis by Marrow** is a local-first, offline-capable PWA for note-taking and PDF management. Every note is a file the user owns — markdown (`.md`), PDF, or canvas (`.canvas` JSON). There is no database; the vault directory *is* the data store. Licensed under **BSL 1.1** (see root `LICENSE`).

### Layer Overview

```
Components + Stores  ←→  lib/ (business logic)  ←→  FileSystemAdapter
```

- **`src/components/`** — React UI, organized by domain (`notes/`, `pdf/`, `canvas/`, `board/`, `tasks/`, `bookmarks/`, `kanban/`, `calendar/`, `shell/`, `views/`, `file-browser/`, `graph/`, `search/`, `ui/`)
- **`src/stores/`** — Zustand + Immer stores, one per domain (`vault`, `editor`, `pdf`, `canvas`, `board`, `tasks`, `bookmarks`, `calendar`, `search`, `file-tree`, `file-browser`, `ui`, `toast`)
- **`src/lib/`** — Framework-free business logic: `fs/`, `vault/`, `editor/`, `markdown/`, `pdf/`, `search/`, `canvas/`, `board/`, `tasks/`, `bookmarks/`, `kanban/`, `calendar/`, `graph/`, `snapshot/`, `sync/`, `browser/`
- **`src/types/`** — TypeScript type definitions
- **`src/contexts/`** — `VaultFsContext` (active adapter + config), `NotesWorkspaceContext` (wiki-link paths), `SyncContext` (Dropbox sync push)
- **`src/hooks/`** — `use-auto-save.ts` (debounced save), `use-keyboard-shortcuts.ts` (global shortcuts)

### File System Abstraction

All file I/O goes through `FileSystemAdapter` (`src/lib/fs/`). Never call browser storage APIs directly.

- **`OpfsAdapter`** — Origin Private File System (all browsers, fallback)
- **`FsapiAdapter`** — File System Access API via `showDirectoryPicker()` (Chromium only). Handle persisted in IndexedDB; `queryPermission` restores on reload.
- **`ScopedAdapter`** — wraps another adapter with a root path prefix; `vaultFs` is always scoped to vault root

Access via `useVaultFsContext()` which exposes both `rootFs` (vault discovery) and `vaultFs` (scoped to active vault).

### Vault Structure

```
my-vault/
├── _marrow/          # App metadata — hidden from file tree
│   ├── config.json
│   ├── search-index.json
│   ├── snapshots/    # Pre-edit PDF backups
│   ├── signatures/
│   └── templates/
├── _inbox/           # PDF import zone — visible in UI
├── _board/           # Board thoughts — hidden from tree/browser/search
│   └── _assets/      # Board image attachments
├── _bookmarks/       # Web bookmarks — hidden from tree/browser/search
│   └── <category>/   # Category subfolders
├── _tasks/           # Tasks and lists — hidden from tree/browser/search
│   └── <list>/       # List subfolders
├── _calendar/        # Events — hidden from tree/browser/search; visible in Files
└── **/_assets/       # Per-folder assets — hidden; shown inline in notes
```

### State Management

Zustand + Immer throughout. Pattern:

```typescript
const useMyStore = create<MyState>()(
  immer((set, get) => ({
    value: null,
    setValue: (v) => set((state) => { state.value = v })
  }))
)
```

**Do not use `Set` or `Map` in Zustand/Immer stores** unless `enableMapSet()` is called. Use `Record<string, true>` or arrays instead.

### Three Editors

**Markdown** — Tiptap (ProseMirror). Wiki-links `[[note]]` are inline nodes via `[[` autocomplete (Suggestion). Slash commands. KaTeX for math (`$...$` inline, `$$...$$` display). Tables, task lists, code blocks with syntax highlighting (lowlight). Auto-save debounced ~750ms via `useAutoSave`. Source mode toggle (full `.md` in textarea). Export: Markdown download + Print (styled HTML via `buildExportHtml` + `printExportHtml`). Embedded PDF pages via `![[file.pdf#page=N]]`. Images drag-and-drop into `_assets/`.

**PDF** — PDF.js renders pages to `<canvas>`; Fabric.js overlay handles annotations (highlight, ink, text, comment, signature). Annotations are written destructively into PDF bytes via `pdf-lib` (no sidecar). Tools: Select / Highlight / Draw / Text / Comment / Sign — each with separate color state (`highlightColor`, `drawColor`, `textColor`). Auto-save via `VaultConfig.autoSave` (default 5s interval + optional blur; no dedicated Save button). `PdfUndoStack` stores up to 20 pre-operation raw PDF byte snapshots. On first edit, a snapshot is created in `_marrow/snapshots/`. Side column: Pages tab (thumbnails, drag-to-reorder, multi-select extract) + Outline tab. Page operations: insert, delete, rotate, merge, split — all via `lib/pdf/page-operations.ts`. Form filling via `PdfFormDialog`. Find-in-document via `search-pdf-text.ts`. Pen paths flattened via `fabric-path-to-pdf-points.ts`. Text comments written as native `/Text` annotations with `InkMarrow` marker for idempotent saves.

**Canvas** — PixiJS v8 (WebGL) raster-first, layer-based drawing surface (`.canvas` v4 sidecar-PNG format; v2/v3 files are migrated on first save). 3-column layout: vertical tool strip (48px left), PixiJS canvas (center, infinite pan/zoom 0.1×–10×), properties panel (260px right — Color/Brush/Layers). Each layer is a `RenderTexture` displayed as a `Sprite` inside a viewport `Container`. Brush pipeline: `stroke-engine.ts` collects pointer samples, interpolates with Catmull-Rom, and passes stamps to `brush-system.ts` which renders into a scratchpad RT with pressure and optional soft-falloff. Eraser strokes skip the scratchpad and render directly into the active layer with PixiJS `erase` blend. Layers support opacity, visibility, lock, and 15 blend modes (some HSL modes may fall back to `normal` — see BUG-16). Stroke undo via PNG `Blob` snapshots (off-heap). Remove-layer / reorder-layers undo via full-metadata entries. Pressure sensitivity via Pointer Events API. Tools: Brush (B), Eraser (E), Pan (H), Fill (G), Eyedropper (I). Default canvas background is white. Keyboard: `B`/`E`/`H`/`G`/`I` tool switch, `[`/`]` brush or eraser size, Ctrl+Z undo / Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+S force-save. Auto-save ~3s + saveOnBlur + flush before unmount. Export PNG/PDF.

**On-disk format (v4):** `<basename>.canvas` is a small metadata JSON; per-layer pixel PNGs live at `<basename>.canvas.assets/<layerId>.png`. Save order is PNGs-first, JSON-last so a crash mid-save never leaves the JSON pointing at unwritten PNGs. Deleted layers leave orphan PNGs on disk — same policy as `_marrow/snapshots/`, to be reaped by a future vault cleanup pass.

#### Canvas Lifecycle (Critical)

The PixiJS canvas editor has an async init + async flush-save teardown. Key invariants:

1. **Ticker stopped in cleanup** — the Pixi `Application` ticker auto-calls `app.render()` every frame. `engine.destroy()` calls `app.ticker?.stop()` synchronously before any async teardown, otherwise it renders destroyed geometry (`TypeError: Cannot read properties of null (reading 'geometry')`).

2. **Observers disconnected before async teardown** — `ResizeObserver` (watching the host container for pane-resize sync, BUG-05) is disconnected synchronously at the top of `destroy()`. Doing it after `ticker.stop()` or `app.destroy()` risks a queued observer callback calling `renderer.resize` on a torn-down renderer.

3. **Save → destroy is sequential on unmount, not fire-and-forget** (BUG-11). The unmount cleanup awaits `flushSave(engine, vaultFs, savePath)` before calling `engine.destroy()`. Previously the flush was fire-and-forget and `extract.base64` raced with `app.destroy()`, silently falling back to stale pixels — in-flight changes were lost if the autosave interval hadn't fired.

4. **New mount awaits pending save** — `pendingCanvasSaves` (module-scope `Map<path, Promise>`) lets the next mount of the same path `await` the previous mount's async flush before reading the file from disk. Without this, the new mount reads stale bytes and overwrites the user's latest changes on its first save.

5. **Unmount saves to `pathRef.current`** — not the closure's `path`. After a rename, the closure still holds the old path; saving to it would recreate the old file as a duplicate.

6. **Pixi v8 texture loading** — `Texture.from(string)` is a cache-alias lookup, not image decoding. For inline base64 PNGs (v3 load path) we decode via `HTMLImageElement + img.decode()` then `Texture.from({ resource: img })`. For sidecar PNG bytes (v4 load path) we decode via `createImageBitmap(blob)` then `Texture.from({ resource: bitmap })` — faster and off-main-thread where supported. In both cases the texture takes ownership of the resource; don't `.close()` the bitmap manually.

7. **Sidecar PNG read failures fail soft** — a missing / undecodable `<basename>.canvas.assets/<layerId>.png` during `readCanvasFile` makes that one layer load blank rather than failing the whole canvas. Corrupted / partial-sync vaults can still be opened and recovered by a save.

### Board

Quick-capture notice board (`Ctrl+2`). **Thoughts** are `.md` files in `_board/` with frontmatter (`type`, `color`, timestamps). Title from first `# H1`. Masonry CSS-columns layout. Inline edit via minimal Tiptap (bold/italic/underline/lists — keyboard shortcuts only). Image thoughts in `_board/_assets/`. `useBoardStore` for CRUD; `lib/board/index.ts` parse/serialize; `lib/editor/board-extensions.ts` extensions.

### Bookmarks

Web bookmark manager (`Ctrl+4`). `.md` files in `_bookmarks/` with frontmatter (url, title, description, favicon, ogImage, tags). Categories as subfolders. `fetchOgMetadata` in `lib/bookmarks/og-fetch.ts` scrapes OG + Google favicon — CORS-safe fallback. Two-panel layout: category sidebar + bookmark list. Add/edit via Radix Dialog. `useBookmarksStore` for CRUD + categories; `lib/bookmarks/index.ts` parse/serialize.

### Tasks

CalDAV-compatible local-first task manager (`Ctrl+3`). `.md` files in `_tasks/` with frontmatter mapping to iCalendar VTODO fields (`uid`, `status`, `priority` 1–4, `due`, `created`, `modified`, `completed`, `tags`, `parent`, `order`). Lists are subfolders of `_tasks/`. Subtasks are separate `.md` files linked by `parent` UID in the same folder. Quick-add bar parses natural language: `!1` priority, `#tag` tags, `>tomorrow` / `>YYYY-MM-DD` due dates, phrases like **on Wednesday** (next occurrence) and **every Monday** / **on Wednesdays** (weekly `repeat` + `repeatWeekday`; completing rolls `due` forward). Explicit `>` due wins when both are present. Two-panel layout: sidebar (Inbox/Today/Upcoming smart filters + user lists) + task list. `.ics` export via `lib/tasks/ical.ts`. `useTasksStore` for CRUD; `lib/tasks/index.ts` parse/serialize/tree; `lib/tasks/parse-quick-add.ts` parser.

### Calendar

Local-first event calendar (`Ctrl+5`). Events are `.md` files in `_calendar/` (hidden from Vault tree/browser/search; visible in Files). Frontmatter: `uid`, `start` (ISO date or `YYYY-MM-DDTHH:mm`), `end`, `allDay`, `color` (violet/sky/emerald/amber/rose/slate), `created`, `modified`. Monthly grid view; tasks with due dates appear as greyed "task due" chips. `useCalendarStore` for CRUD; `lib/calendar/index.ts` for parse/serialize/date helpers.

### Kanban

Markdown-based Kanban boards. A `.md` file with `type: kanban` in frontmatter renders as a drag-and-drop board. Columns = `## Headings` (optional `<!--kanban:color-->` for accent), cards = `- [ ]`/`- [x]` items. Drag cards by grip handle; drag columns by header grip. `detectEditorTabType` in `lib/notes/editor-tab-from-path.ts` peeks at frontmatter; `notes-view.tsx` renders `KanbanEditor`. Auto-save debounced ~750ms. `lib/kanban/index.ts` parse/serialize. The file is a regular `.md` — searchable, syncable, readable externally.

### Routing / Views

Next.js App Router, but the app is a single-page shell. Navigation is state-driven via `useUiStore` (`activeView`). `app/page.tsx` renders `<AppRoot>` which switches between views via `ViewRouter`.

Nav order (sidebar): **Vault** (Ctrl+1) → **Board** (Ctrl+2) → **Tasks** (Ctrl+3) → **Bookmarks** (Ctrl+4) → **Calendar** (Ctrl+5) → **Graph** (Ctrl+6) → **Files** (Ctrl+7) → **Search** (Ctrl+8 / Ctrl+F) → New (Ctrl+N).

- **Vault** (`ViewMode.Vault`) = file tree + editor (markdown, PDF, canvas, image).
- **Files** (`ViewMode.Files`) = `FileBrowserView` with `showHidden=true`; power-user raw view.
- **Mobile (≤767px)**: `MobileNavMasthead` with hamburger → left sheet. `MOBILE_NAV_MEDIA_QUERY` in `lib/browser/breakpoints.ts`.

### Search

MiniSearch index built on vault open, stored in `_marrow/search-index.json`. Incrementally updated on save/rename. Indexes markdown title/body, PDF text (via `extractPdfText` from PDF.js), and canvas/PDF titles/paths. Supports fuzzy matching, `#tag` filters, date range, folder prefix, file type filters.

### Graph

Interactive force-directed visualization. `buildNoteGraph` scans all vault files (`.md`, `.pdf`, `.canvas`) for wiki-links and builds node+edge model. Canvas 2D rendering with drag, pan, zoom, click-to-open. Distinct shapes per type: circle (note), rounded square (PDF), diamond (canvas). Filter by folder dropdown.

### Sync (optional)

Provider: **Dropbox** (OAuth 2 PKCE; Full Dropbox scoped; absolute paths like `/Apps/Mentis/<vault>`). OAuth return `src/app/auth/dropbox/`. Tokens in IndexedDB keyed per vault path (`vaultId` = active vault path). Settings → Sync configures Dropbox; the Vault toolbar shows a **sync-now** control when `sync.provider === 'dropbox'`. `SyncManager` runs `fullSync` on vault open, `pushFile` after saves, `pull` on poll interval. Change detection via SHA-256 manifest. Conflict resolution: last-write-wins by `modifiedAt`. Env: `NEXT_PUBLIC_DROPBOX_CLIENT_ID` in `.env.local`. See `docs/CLOUD_SYNC.md`.

### Image Files

Image files in the vault tree open as `EditorTab` type `image`. PNG/JPEG/WebP: `ImageEditorView` (rotate, edge-trim crop, brightness/contrast/saturation via `lib/browser/image-edit-pipeline.ts`). GIF/SVG/BMP/ICO: plain preview via `VaultImageView`.

## Conventions

**Imports:** Always use `@/` alias, never relative paths crossing directory boundaries. External → internal → types ordering.

**Naming:**
- Components: `PascalCase.tsx`
- Hooks: `use-kebab-case.ts`
- Lib/stores/types: `kebab-case.ts`
- Constants: `SCREAMING_SNAKE_CASE`

**Component structure:** imports (external → internal → types) → types → named export function → hooks → handlers → render.

**Styling:** Tailwind CSS utility classes + `cn()` helper (`clsx` + `tailwind-merge`). No CSS modules. Dark mode via `.dark` class on `<html>` (three-state toggle: Light/System/Dark). Tailwind v4 (no `tailwind.config` file — configured via `postcss.config.mjs` and CSS `@theme` tokens in `globals.css`).

**UI primitives:** Radix UI for dialogs, dropdowns, tooltips. Lucide for icons. Never nest interactive elements (e.g. `<button>` inside `<button>`). For tab UIs with close controls, use `<div role="tab">` with separate `<button>`s.

**UI copy:** Prefer label + control only. No subtitle "hints" under labels unless they prevent a real mistake (irreversible actions, format requirements, edge cases). See `.cursor/rules/ui-copy.mdc`.

**Errors:** File system ops use try/catch. User-facing errors via `toast.error()` (import from `@/stores/toast`). Always also `console.error()` for dev debugging. Critical errors via `ErrorBoundary` (recovery UI).

**Git:** Conventional Commits (`feat(scope): description`, `fix(scope):`, `refactor(scope):`, `docs(scope):`, `chore(scope):`). One feature/fix per PR.

## Testing

- Default Vitest environment is `node`, not jsdom
- Use `@vitest-environment happy-dom` docblock for component tests that need DOM
- **Never use jsdom** — canvas bindings fail on Windows (no Cairo) and most CI
- 21 test files under `tests/` (~260 tests)

Key suites: `search.test.ts`, `markdown.test.ts`, `markdown-bridge.test.ts`, `pdf-annotation-writer.test.ts`, `pdf-operations.test.ts`, `fs-adapter.test.ts`, `graph.test.ts`, `canvas-undo.test.ts`, `canvas.test.ts`, `daily-note.test.ts`, `folder-ops.test.ts`, `image-edit-pipeline.test.ts`.

## Key Gotchas

- **Rename + auto-save race:** After a file rename, the auto-save cleanup closes over the *old* path. Skip flush if `pathRef.current !== path` to avoid recreating the old file. Canvas unmount saves to `pathRef.current` (live path), not the closure `path`.
- **COOP/COEP headers** are required for `SharedArrayBuffer` (PDF.js). They must be set at the hosting layer, not in `next.config.ts` (static export doesn't run Next.js middleware). See `docs/DEPLOYMENT.md`.
- **PDF.js loading:** Use the loader in `src/lib/pdf/pdfjs-loader.ts` — do not import PDF.js directly, as it requires careful worker setup.
- **Static export:** `pnpm build` uses `output: 'export'`. No server-side rendering, no API routes (except auth pages which are handled client-side).
- **Canvas Pixi ticker:** The Pixi Application ticker must be stopped synchronously before async teardown in canvas cleanup, or it renders destroyed geometry. See "Canvas Lifecycle" section above.
- **Canvas unmount save race:** Unmount cleanup awaits `flushSave` before `engine.destroy()`, and publishes the promise into `pendingCanvasSaves` so the next mount of the same path can await it before reading disk. Skipping either half loses in-flight changes.
- **Canvas v4 sidecar PNGs:** Pixel data lives at `<basename>.canvas.assets/<layerId>.png`, not inline in JSON. Save order is PNGs-first, JSON-last for crash safety; deleted layers leave orphan PNGs (out of scope for now).
- **PDF annotation persistence:** After auto-save, the viewer reloads file bytes so the raster layer matches disk. `addAnnotation(..., { fromLoader: true })` when hydrating from disk avoids false unsaved/autosave loops. `annotation-writer` draws highlights/ink/FreeText/stamps into page content; text comments as native `/Text` annotations.
- **PDF page add:** `appendBlankPage` uses `getPageCount()` on current bytes (not stale React `pages.length`).
- **Vault rename collision:** `vaultPathsPointToSameFile` (`lib/fs/vault-path-equiv.ts`) prevents false "already exists" errors on case-only renames.
- **FSAPI handle persistence:** `FileSystemDirectoryHandle` stored in IndexedDB via `lib/fs/handle-store.ts`; `queryPermission` restores on reload.
- **Wiki-link resolution:** `resolveWikiLinkPath` normalizes spaces/hyphens/underscores for basename match.
- **Markdown round-trip:** Load: marked → @tiptap/html `generateJSON` → `setContent`. Save: @tiptap/html `generateHTML` → turndown → gray-matter `serializeNote`. Not identical to raw GFM for all node types.
- **Service Worker:** Hand-written `public/sw.js`. `_next/static/*` uses cache-first (immutable content-hashed). Other same-origin GETs use stale-while-revalidate.

## AI / Cursor Rules

- `.cursor/rules/greeting-and-docs.mdc` (`alwaysApply: true`): Greet with **Assalamualaikum** on substantive replies. After meaningful changes, update `docs/` and add **Manual verification** checklist when behavior/UX changes. Refresh `docs/LAUNCH_DEFERRALS.md` verification queue.
- `.cursor/rules/ui-copy.mdc`: Settings/forms: avoid filler hints under labels unless they prevent a real mistake.
- When suggesting redistribution or "open sourcing," remind readers that **BSL 1.1** governs this repo until the Change Date — point to `LICENSE`.
- Prefer small, reviewable diffs; match existing patterns in touched files.
- Security-sensitive areas (crypto, vault paths, FS adapters): extra care and human review.

## Detailed Docs Reference

For deeper context, see `docs/`:
- `ARCHITECTURE.md` — full module descriptions, data flows, dependency graph, security
- `TECH_STACK.md` — all libraries with version and purpose, key library decisions
- `CONVENTIONS.md` — full project structure, naming, component/store patterns, styling, testing, git workflow
- `PRD.md` — product requirements, core principles, feature breakdown, success metrics
- `DEVELOPMENT_PHASES.md` — phase 1 completed work, pre-launch hardening, phase 2-3 roadmap
- `LAUNCH_DEFERRALS.md` — open deferrals, manual verification queue, addressed archive
- `DEPLOYMENT.md` — static hosting headers (COOP/COEP), OAuth redirects
- `CLOUD_SYNC.md` — Dropbox setup, env vars, OAuth flow
- `PDF_WORKFLOW.md` — detailed PDF UX flows (browser, import, edit, highlight, draw, sign, pages, forms, export)
- `RISKS.md` — technical and product risk matrix with mitigations
- `CURSOR.md` — AI/Cursor workflow expectations, active rules list
