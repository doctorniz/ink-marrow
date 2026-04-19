# Mentis — Tech Stack

## Phase 1: Web App

### Core Framework

| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 15.x (App Router) | React framework with SSG/SSR, file-based routing, optimized bundling |
| **React** | 19.x | UI library |
| **TypeScript** | 5.x | Type safety across the entire codebase |

### Markdown Editing

| Technology | Purpose |
|---|---|
| **Tiptap** | ProseMirror-based rich text editor with extension system |
| **@tiptap/suggestion** | `/` slash menu and `[[` wiki-link note picker (filtered list + keyboard nav) |
| **@tiptap/starter-kit** | Base editor extensions (bold, italic, lists, etc.) |
| **@tiptap/extension-task-list** | Task list / checkbox support |
| **@tiptap/extension-table** | GFM table support |
| **@tiptap/extension-code-block-lowlight** + **lowlight** | Syntax-highlighted code blocks (common languages bundle) |
| **@tiptap/extension-placeholder** | Placeholder text for empty documents |
| **KaTeX** | LaTeX math rendering for `$...$` (inline) and `$$...$$` (display) via custom Tiptap nodes |
| **gray-matter** | Frontmatter read/write for note files |
| **marked** | Markdown → HTML for loading into Tiptap |
| **@tiptap/html** | HTML ↔ Tiptap JSON (`generateJSON` / `generateHTML`) |
| **turndown** | HTML → Markdown on save (round-trip with editor; some GFM fidelity gaps) |

### PDF Engine

| Technology | Purpose |
|---|---|
| **pdfjs-dist** (PDF.js) | PDF rendering, text layer, search, outline extraction |
| **pdf-lib** | Client-side PDF manipulation — annotation writing, page management, merge, page extract/reorder, form filling, signature stamping |
| **Fabric.js** | Canvas overlay for annotation editing on PDF pages |
| **PixiJS** v8 | WebGL-accelerated layer-based drawing canvas (`.canvas` editor) with brush engine and Photoshop-style properties panel |

### Search

| Technology | Purpose |
|---|---|
| **MiniSearch** | Lightweight client-side full-text search with fuzzy matching, prefix search, field boosting |

### State Management

| Technology | Purpose |
|---|---|
| **Zustand** | Minimal, performant state management with devtools support |
| **Immer** (via Zustand middleware) | Immutable state updates with mutable syntax |

### Styling & UI

| Technology | Purpose |
|---|---|
| **Tailwind CSS** | Utility-first CSS framework |
| **tailwind-merge** | Intelligent class merging for component variants |
| **class-variance-authority (CVA)** | Type-safe component variant definitions |
| **Lucide React** | Icon library (consistent, tree-shakeable) |
| **Radix UI** | Unstyled, accessible UI primitives (dialogs, dropdowns, tooltips, etc.) |
| **@tanstack/react-virtual** | Virtualized list/grid rendering for large vaults (file browser, search results) |
| **Framer Motion** | Animations and transitions |

### File System & Offline

| Technology | Purpose |
|---|---|
| **Origin Private File System (OPFS)** | Browser-native performant local storage |
| **File System Access API** | `FsapiAdapter` wraps `showDirectoryPicker()` for "open folder" vault access on Chromium browsers |
| **Service Worker** | Hand-written `public/sw.js` with stale-while-revalidate caching (no Workbox dependency) |

### Build & Dev Tooling

| Technology | Purpose |
|---|---|
| **pnpm** | Fast, disk-efficient package manager |
| **ESLint** | Linting with flat config |
| **Prettier** | Code formatting |
| **Vitest** | Unit and integration testing (261 tests across 21 suite files under `tests/`) |
| **happy-dom** | Lightweight DOM implementation for Vitest tests requiring a browser environment (Tiptap bridge) |
| **Playwright** | E2E browser testing |
| **Husky + lint-staged** | Pre-commit hooks |

---

## Phase 2: Desktop (Tauri)

| Technology | Purpose |
|---|---|
| **Tauri v2** | Rust-based desktop shell, small binary, native FS access |
| **Tauri FS plugin** | Direct read/write to user's vault directory |
| **Tauri updater** | Auto-update mechanism |
| **Tauri shell plugin** | System integration (open in default app, etc.) |

---

## Phase 3: Mobile

| Technology | Purpose |
|---|---|
| **Capacitor** (or Tauri Mobile) | Mobile shell wrapping the web app |
| **Pointer Events API** | Stylus/Apple Pencil pressure sensitivity |
| **Capacitor Filesystem** | Sandboxed file storage |
| **iCloud / SAF integration** | Native cloud sync per platform |

---

## Key Library Decisions

### Why Tiptap over Milkdown, BlockNote, or raw ProseMirror?

- First-class React bindings with strong TypeScript support
- Mature extension ecosystem covering all our markdown needs
- Active maintenance and commercial backing
- Easier to extend than raw ProseMirror while retaining full ProseMirror power
- Better WYSIWYG experience than Milkdown for our "renders in-place" requirement

### Why Fabric.js for PDF annotations?

- Richer object manipulation API (select, resize, rotate, group) for annotation overlays
- Built-in serialization to/from JSON
- Better text editing support on canvas
- Active community and documentation

### Why PixiJS for the Canvas Editor?

- WebGL-accelerated rendering for smooth drawing at any zoom level
- `RenderTexture` enables raster-first, layer-based workflows (Photoshop/Magma style)
- Native blend modes (multiply, screen, overlay, etc.) via GPU
- Pointer Events integration for pressure-sensitive stylus/pen input
- Performant even with large canvases (4096×4096 per layer)

### Why MiniSearch over Lunr or FlexSearch?

- Smallest bundle size (~7KB gzipped)
- Supports both prefix search and fuzzy matching out of the box
- Field boosting allows ranking title matches above body matches
- Auto-suggest / autocomplete API for search-as-you-type
- Simple API for incremental index updates

### Why Zustand over Redux, Jotai, or React Context?

- Minimal boilerplate (no providers, reducers, or action types)
- Works outside React components (useful for file system callbacks)
- Built-in devtools middleware
- Excellent TypeScript support
- Immer middleware for ergonomic immutable updates

### Why pnpm over npm or yarn?

- Significantly faster installs via content-addressable store
- Strict dependency resolution prevents phantom dependencies
- Workspace support for potential monorepo structure
- Disk space efficient (shared packages across projects)

---

## License & repository metadata

| Item | Value |
|---|---|
| **License** | [Business Source License 1.1](../LICENSE) (BSL 1.1) — not OSI-open-source until the **Change Date** in `LICENSE`; then **MPL 2.0** for that version as specified there. |
| **`package.json` `license`** | `SEE LICENSE IN LICENSE` |
| **AI assistance** | Disclosed in the root [README](../README.md); does not override the license. |

Dependency licenses are those of each npm package (see lockfile / `pnpm licenses`); the **Mentis** application source is under BSL as above.

**Static hosting:** `output: 'export'` — configure COOP/COEP at the edge if you need cross-origin isolation; see [DEPLOYMENT.md](./DEPLOYMENT.md).
