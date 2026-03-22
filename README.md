# Ink by Marrow

Local-first markdown notes, PDF editor, and unlimited canvas.

## What is Ink?

Ink by Marrow is a cross-platform note-taking application built on a **local-first, markdown-file architecture**. Every note is a `.md` file, every asset lives alongside it, and you always own your data. Ink is also a **full-featured PDF editor**: annotate, highlight, sign, and manage PDFs as first-class citizens — all edits written directly into the file.

## Features

- **Markdown Notes** — WYSIWYG editing with Tiptap, wiki-links, slash commands, frontmatter, tags, templates
- **PDF Editor** — View, annotate, highlight, draw, sign, manage pages, merge/split, form filling
- **Unlimited Canvas** — Infinite whiteboard with freehand drawing, text cards, sticky notes, connectors
- **PDF File Browser** — Grid/list view with thumbnails, import, sort, filter, batch operations
- **Full-Text Search** — Instant search across all notes and PDFs with MiniSearch
- **Offline-First** — Works entirely in the browser without a network connection

## Architecture

```
src/
├── app/            # Next.js App Router (pages, layouts)
├── components/     # React UI components
│   ├── ui/         # Primitive components (Button, Dialog, etc.)
│   ├── layout/     # Sidebar, TopBar, ViewManager
│   ├── editor/     # Markdown editor (Tiptap)
│   ├── pdf/        # PDF viewer and annotations
│   ├── canvas/     # Unlimited canvas
│   └── file-browser/
├── lib/            # Core business logic
│   ├── fs/         # File system adapters (OPFS, FSAPI)
│   ├── vault/      # Vault management
│   ├── pdf/        # PDF manipulation (pdf-lib)
│   ├── search/     # Full-text search (MiniSearch)
│   ├── markdown/   # Markdown parsing (remark/unified)
│   ├── canvas/     # Canvas serialization
│   └── snapshot/   # PDF version snapshots
├── stores/         # Zustand state management
├── types/          # TypeScript type definitions
├── hooks/          # Custom React hooks
└── utils/          # Utility functions
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS 4, Radix UI |
| Editor | Tiptap (ProseMirror) |
| PDF | PDF.js (render), pdf-lib (write), Fabric.js (annotations) |
| Canvas | Fabric.js |
| Search | MiniSearch |
| State | Zustand |
| File System | OPFS + File System Access API |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Run tests
pnpm test
```

### Build

```bash
pnpm build
```

The app builds as a static export (SPA) suitable for deployment to any static hosting.

## Documentation

Detailed documentation lives in the `docs/` folder:

| Document | Description |
|---|---|
| [PRD](docs/PRD.md) | Product requirements and feature breakdown |
| [Architecture](docs/ARCHITECTURE.md) | System architecture, data flows, module design |
| [Tech Stack](docs/TECH_STACK.md) | Technology choices and rationale |
| [Development Phases](docs/DEVELOPMENT_PHASES.md) | Week-by-week delivery plan |
| [Conventions](docs/CONVENTIONS.md) | Code style, naming, project structure |
| [Cursor / AI](docs/CURSOR.md) | Cursor rules and AI workflow for this repo |
| [PDF Workflow](docs/PDF_WORKFLOW.md) | Detailed PDF editing UX specification |
| [Risks](docs/RISKS.md) | Risk register with mitigations |

## Vault Structure

Ink stores everything as files in a vault (folder):

```
my-vault/
├── _marrow/          # App metadata (config, templates, snapshots)
├── _inbox/           # PDF import landing zone
├── Projects/         # User folders with .md, .pdf, .canvas files
├── Journal/          # Date-titled daily notes
└── inbox.md          # Default capture note
```

## Development Phases

1. **Phase 1 (Weeks 1–12):** Web MVP — markdown editor, PDF browser/editor, unlimited canvas, four-view navigation, offline support
2. **Phase 2 (Weeks 13–18):** Desktop app (Tauri), templates, graph view, Marrow Sync
3. **Phase 3 (Weeks 19–26):** Mobile (Capacitor), stylus support, OCR, plugin system, public launch

## License

Proprietary. All rights reserved.
