# Ink by Marrow — Code Conventions

## Project Structure

```
ink-marrow/
├── docs/                       # Project documentation
├── public/                     # Static assets (icons, PWA manifest)
├── src/
│   ├── app/                    # Next.js App Router pages and layouts
│   │   ├── (vault)/            # Vault-scoped route group
│   │   │   ├── files/          # File Browser view
│   │   │   ├── notes/          # Notes view
│   │   │   ├── search/         # Search view
│   │   │   └── new/            # New creation view
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Landing / vault selector
│   │   └── globals.css         # Global styles and Tailwind
│   │
│   ├── components/             # Shared UI components
│   │   ├── ui/                 # Primitive UI components (Button, Dialog, etc.)
│   │   ├── layout/             # Layout components (Sidebar, TopBar, etc.)
│   │   ├── editor/             # Markdown editor components
│   │   ├── pdf/                # PDF viewer and annotation components
│   │   ├── canvas/             # Unlimited canvas components
│   │   └── file-browser/       # File browser components
│   │
│   ├── lib/                    # Core business logic (non-React)
│   │   ├── fs/                 # File system adapters
│   │   │   ├── types.ts        # FileSystemAdapter interface
│   │   │   ├── opfs.ts         # OPFS implementation
│   │   │   ├── fsapi.ts        # File System Access API implementation
│   │   │   └── index.ts        # Adapter factory
│   │   ├── vault/              # Vault management
│   │   ├── pdf/                # PDF manipulation (pdf-lib wrappers)
│   │   ├── search/             # MiniSearch integration
│   │   ├── markdown/           # Markdown parsing (remark/unified)
│   │   ├── canvas/             # Canvas serialization
│   │   └── snapshot/           # PDF snapshot management
│   │
│   ├── stores/                 # Zustand stores
│   │   ├── vault.ts
│   │   ├── file-tree.ts
│   │   ├── editor.ts
│   │   ├── pdf.ts
│   │   ├── canvas.ts
│   │   ├── search.ts
│   │   └── ui.ts
│   │
│   ├── hooks/                  # Custom React hooks
│   ├── types/                  # Shared TypeScript types
│   └── utils/                  # General utility functions
│
├── tests/                      # Test files
│   ├── unit/                   # Unit tests (Vitest)
│   ├── integration/            # Integration tests
│   └── e2e/                    # E2E tests (Playwright)
│
├── .cursor/                    # Cursor IDE config
│   └── rules/                  # Cursor rules for AI assistance
├── next.config.ts              # Next.js configuration
├── tailwind.config.ts          # Tailwind configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies and scripts
├── pnpm-lock.yaml              # Lockfile
└── README.md                   # Project overview
```

## Naming Conventions

### Files & Directories

| Type | Convention | Example |
|---|---|---|
| React components | PascalCase | `FileTreeSidebar.tsx` |
| Hooks | camelCase with `use` prefix | `useVaultStore.ts` |
| Utilities/lib | kebab-case | `pdf-annotations.ts` |
| Types | kebab-case | `vault-types.ts` |
| Stores | kebab-case | `file-tree.ts` |
| Tests | `*.test.ts` / `*.test.tsx` | `vault.test.ts` |
| Constants | SCREAMING_SNAKE_CASE in file | `MAX_SNAPSHOT_COUNT` |

### Code

| Type | Convention | Example |
|---|---|---|
| Components | PascalCase | `FileTreeSidebar` |
| Functions | camelCase | `createVault()` |
| Variables | camelCase | `searchResults` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_SNAPSHOTS_PER_FILE` |
| Types/Interfaces | PascalCase | `VaultConfig`, `FileEntry` |
| Enums | PascalCase (members too) | `ViewMode.FileBrowser` |
| Zustand stores | `use[Name]Store` | `useVaultStore` |
| Event handlers | `handle[Event]` or `on[Event]` | `handleFileClick`, `onDrop` |

## Component Patterns

### Component File Structure

```tsx
// 1. Imports (external, then internal, then types)
import { useState, useCallback } from 'react'
import { cn } from '@/utils/cn'
import type { FileEntry } from '@/types/vault'

// 2. Types specific to this component
interface FileTreeItemProps {
  entry: FileEntry
  depth: number
  onSelect: (entry: FileEntry) => void
}

// 3. Component definition (named export)
export function FileTreeItem({ entry, depth, onSelect }: FileTreeItemProps) {
  // hooks first
  const [isExpanded, setIsExpanded] = useState(false)

  // handlers
  const handleClick = useCallback(() => {
    onSelect(entry)
  }, [entry, onSelect])

  // render
  return (
    <div className={cn('flex items-center', depth > 0 && 'ml-4')}>
      {/* ... */}
    </div>
  )
}
```

### Zustand Store Pattern

```tsx
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface VaultState {
  path: string | null
  config: VaultConfig | null

  // Actions
  openVault: (path: string) => Promise<void>
  closeVault: () => void
}

export const useVaultStore = create<VaultState>()(
  immer((set, get) => ({
    path: null,
    config: null,

    openVault: async (path) => {
      // ...
      set((state) => {
        state.path = path
      })
    },

    closeVault: () => {
      set((state) => {
        state.path = null
        state.config = null
      })
    },
  }))
)
```

## Import Aliases

```json
{
  "@/*": ["./src/*"]
}
```

Always use `@/` path aliases for imports within `src/`. Never use relative paths that go more than one level up (`../../`).

## Styling Guidelines

- Use Tailwind CSS utility classes as the primary styling method.
- Use `cn()` utility (clsx + tailwind-merge) for conditional and merged classes.
- Use CSS variables in `globals.css` for theme tokens (colors, spacing, radii).
- Component variants defined with `class-variance-authority` (CVA).
- No CSS modules or styled-components.
- Dark mode via Tailwind `dark:` variant, driven by a class on `<html>`.

## Error Handling

- File system operations are wrapped in try/catch and return `Result<T, Error>` types where possible.
- User-facing errors are shown via toast notifications.
- Errors are logged to console in development.
- Critical errors (vault corruption, write failures) show modal dialogs with recovery options.

## Testing Strategy

| Layer | Tool | Focus |
|---|---|---|
| Unit | Vitest | Pure functions, store logic, adapters |
| Integration | Vitest + Testing Library | Component interactions, store + component |
| E2E | Playwright | Full user flows (create vault, edit note, annotate PDF) |

## Git Conventions

### Branch Names

- `feat/description` — new feature
- `fix/description` — bug fix
- `refactor/description` — code restructuring
- `docs/description` — documentation
- `chore/description` — tooling, deps, config

### Commit Messages

Follow Conventional Commits:

```
type(scope): description

feat(editor): add slash command menu
fix(pdf): prevent annotation loss on interrupted save
refactor(fs): extract common adapter interface
docs(readme): add development setup instructions
```

### PR Conventions

- One feature/fix per PR
- PR description includes summary + test plan
- Screenshots for UI changes
- All CI checks must pass

## Cursor & AI assistant

- Project rules live in **`.cursor/rules/`** (`.mdc` files). See **`docs/CURSOR.md`** for the current list and purpose.
- When using Cursor Agent on this repo, the default expectation is: greet with **Assalamualaikum** on substantive help, and **update `docs/`** (and `README.md` when needed) at the end of runs that change behavior, architecture, or dependencies—then summarize which doc files changed in the final reply.
