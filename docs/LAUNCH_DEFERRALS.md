# Pre-launch deferrals

Items are **logged for review before public launch**. This file is **pre-launch triage** (UX polish, PDF/canvas parity, mobile export).

**Structure**

1. **Open deferrals** ? work still open or ?landed, confirm in UI.?
2. **Manual verification** ? human checklists: **To do** (`- [ ]`) vs **Done** (`- [x]`).
3. **Addressed in code (archive)** ? historical fixes; reopen a row under **Open deferrals** or **To do** if something regresses.

**Workflow**

- New gap ? add under **Open deferrals** with an ID (e.g. `LAUNCH: P9 Add page broken`).
- Fixed ? move to **archive**; add or refresh **Manual verification** bullets in the same change when behavior should be re-checked.
- PRs: repeat **To do** items under **Manual verification** so assignees see them.
- Phased roadmap: `DEVELOPMENT_PHASES.md` (links here for verification).

---

## Open deferrals

### Product / engineering

| Area | ID | Topic | Notes |
|------|-----|--------|--------|
| Vault tree | T2 | Long-term | Image editing tools (Photoshop-like) ? roadmap only. |
| Cross | X1 | Mobile export | Keep web architecture compatible with RN/Capacitor; document in `ARCHITECTURE.md` when chosen. |

### Addressed in code ? confirm in UI

| Area | ID | Notes |
|------|-----|--------|
| File browser | F4 | Batch toolbar must not shift grid/list (double-click still opens). |
| File browser | F6 | Drop-import overlay: drag enter/leave should not stick. |
| Sync | S2 | (Archive) Nextcloud removed from product; Dropbox OAuth only. |
| Sync | S3 | Exclude patterns for sync (e.g. `_marrow/snapshots/`) not yet implemented. |
| Sync | S4 | Conflict toast with "View details" link not yet implemented. |

---

## Manual verification queue

**Format:** `- [ ]` = to run; `- [x]` = verified (keep a short date when useful).

### To do

- [x] **Keyboard shortcuts dialog** ? **Ctrl+Shift+?** ? Global lists **Ctrl+1** Vault, **Ctrl+2** Search, **Ctrl+3** Graph, **Ctrl+4** Board (not legacy "Notes" / "File Browser").
- [ ] **Board** ? Ctrl+4 opens Board; "Add Thought" creates a card; right-click the button for color picker; click card to edit inline (Ctrl+B/I/U work, no toolbar); Escape or click-away saves; delete via trash icon on hover; `_board/` files hidden from Vault tree and Files; image upload creates image card with preview. Empty state shows prompt. Cards sort newest-first.
- [ ] **Bookmarks** � Ctrl+4 opens Bookmarks; "Add Bookmark" opens dialog; paste URL triggers OG fetch (title, description, favicon, OG image); save creates `.md` in `_bookmarks/`; edit via pencil icon on hover; delete via trash on hover; categories as subfolders with sidebar; "Add category" creates folder; `_bookmarks/` hidden from Vault tree and Files. OG fetch degrades gracefully if CORS blocks.
- [ ] **Calendar** — Ctrl+5 opens Calendar; current month renders with day/weekday headers; click a day ? New Event dialog opens with that day pre-filled; fill title + color + date/time range and Create; event chip appears on the grid; click chip ? Edit Event; update fields and Save; verify event chip updated; click Delete and confirm gone. Tasks with `due` dates appear as greyed "task due" chips (no interaction). Month nav (chevrons + Today button) works. Settings ? Calendar shows Google / Apple / Outlook greyed "Coming soon" items.
- [ ] **Tasks** � Ctrl+3 opens Tasks; type in quick-add bar and press Enter to create a task (no `!n` = default priority, must not throw YAML errors); try `!1 Fix bug #work >tomorrow` and confirm priority, tag, and due are parsed; try **on Friday** / **every Tuesday** in quick-add and confirm due / weekly chip and one row in Upcoming; click task row to open detail dialog; confirm priority/due and list/tags columns do not overlap; footer **Delete** stays visible with many subtasks and shows red/destructive styling; change title, notes, priority, due, list, tags and save; toggle checkbox to mark done (greyed + struck through); click "Clear done" to remove completed; create a list from sidebar; move a task between lists; add a subtask from detail dialog; toggle subtask checkbox; export `.ics` via download button. `_tasks/` hidden from Vault tree but visible in Files view.
- [ ] **Kanban** � New File popover > Kanban creates Kanban YYYY-MM-DD.md with 	ype: kanban and three default column tints (amber / sky / emerald). Drag cards by the vertical grip; drag columns by the horizontal grip on the header to reorder; column color dots under the header; add cards (Enter); max-height cards scroll long text; auto-save; reopen and verify; readable as markdown externally.
- [ ] **Branding** ? Tab **Mentis**; landing title + tagline; sidebar / mobile masthead **Mentis**; favicon/PWA (`/icon.svg`); open-disk errors mention Mentis vault.
- [ ] **License & README** ? Root `LICENSE` BSL 1.1; README **AI assistance** + **License** summary; legal agrees with Parameters.
- [ ] **Vault** ? **Preview** / **Files** tabs + **sync** icon (only if vault `sync.provider` is Dropbox): open md/pdf/canvas from each; sync button runs a full sync when connected (disabled until OAuth completes). Settings ? Sync remains setup/disconnect. Per-vault layout survives reopen (`ink-vault-layout:<path>`). Unicode vault/file names must not break Dropbox download/upload. **Browse header:** vault name at root; `Vault name / folder/path` in subfolders (C22).
- [ ] **Canvas (PixiJS v2)** � Open a `.canvas` file; verify PixiJS WebGL canvas renders; **dev console** must not show `[Assets] Asset id … was not found in the Cache` when loading layers (PNG data URLs decode via `textureFromPngDataUrl`, not `Texture.from` string). Draw with Pencil/Pen/Marker brushes; change brush size via `[`/`]` and slider; change color via palette + hex input + color picker. Toggle eraser (E) and erase strokes. Undo/redo (Ctrl+Z/Y). Add a layer via "+" in properties panel; rename by double-click; toggle visibility (eye); toggle lock; change opacity slider; change blend mode dropdown; duplicate and delete layer. Reorder layers by selecting and drawing � bottom layers render behind top. Pan (middle-click or Alt+drag); zoom (scroll wheel). Save (Ctrl+S); close and reopen � layers and strokes persist. Export PNG and PDF from toolbar. Auto-save triggers after ~3s of inactivity. Inline rename file works (flush-before-rename); after rename the canvas must not throw Pixi `setChildIndex` errors and strokes must remain visible. Keyboard: V=Select, B=Pencil, N=Pen, M=Marker, E=Eraser, T=Text, G=Fill. After panning/zooming far off-screen, switch away and back: strokes should still appear (viewport resets if the saved view missed the layer entirely). Rapid tab switching: `.canvas` file size on disk must not collapse to ~400 bytes with empty layer PNGs while strokes still exist.
- [ ] **Canvas (mobile / narrow)** — Open a `.canvas` in Vault; the drawing area should have a visible minimum height (not collapsed to zero) and a neutral background behind the Pixi canvas. After drawing, switch to another note or Graph and back; the WebGL view should repaint (strokes visible, not a blank white area) while disk data is unchanged.
- [ ] **File browser** ? Context menu: Open, Rename, Move, Duplicate, Delete; batch Move/Delete; menu clicks work (portal + rubber-band fix). **Move folders:** batch or single folder move completes; no nested-button hydration warning in Move dialog. Click-to-rename and grid column parity (F4).
- [ ] **Vault rename (C18)** ? Rename away and back to original name; no false ?already exists?; case-only rename on Windows if applicable.
- [ ] **New file popover (F7)** ? Ctrl+N; Note / File / Drawing; import + blank PDF; Settings PDF page style.
- [ ] **Vault ? image from tree** ? Raster edit + save; GIF/SVG preview; header rename.
- [ ] **Backlinks panel** ? Wide vs narrow layout; overlay vs rail; resize edge cases.
- [ ] **Notes vault tree** ? Collapse/expand; mobile drawer. **C21** DnD into expanded folder refreshes children. **C21b** context menu on files/folders.
- [ ] **PDF side column (P2)** ? Multi-page: Pages tab + thumbnails; Outline tab; collapse to Layers rail; single-page auto-collapsed; outline navigation; multi-select pages + extract to new PDF.
- [ ] **PDF text box** ? Place box ? Select; drag; double-click edit; autosave.
- [ ] **PDF pen vs highlight** ? Distinct saved colours when switching tools.
- [ ] **PDF toolbar / autosave (P12/P13/P15)** ? No Save/Flatten/Side panel; autosave interval + blur; Undo/Redo for page ops.
- [ ] **PDF persistence & thumbnails** ? Ink survives reload; no duplicate strokes on double-save; thumbnails refresh after page ops.
- [ ] **PDF comments (P6/P7)** ? Dialog + margin rail; reload + external viewer spot-check.
- [ ] **PDF signature (P8)** ? Place ? Select; drag; autosave ? reload.
- [ ] **PDF Add page (P9)** ? Rapid double-add appends two pages at end.
- [ ] **PDF Form fields (P10)** ? Empty PDF calm message; fields still work when present.
- [ ] **PDF text search (P11)** ? Find/jump; scan-only ? ?No matches?.
- [ ] **PDF colours (P14)** ? Highlight / Pen / Text swatches stay per-tool.
- [ ] **Sync ? Settings tab** ? Settings ? Sync: remote folder + poll interval; **Connect Dropbox** / **Disconnect**; no separate ?enable sync? toggle. Setup: [`docs/CLOUD_SYNC.md`](./CLOUD_SYNC.md).
- [ ] **Sync ? Dropbox OAuth** ? Settings ? Connect Dropbox ? `/auth/dropbox` (not 404) ? `/`; with `provider: dropbox` saved, files push after save without a separate ?enable sync? toggle.
- [ ] **Sync ? Dropbox E2E** ? Default folder `Mentis/<vault>` under the **app folder** in Dropbox; local edits appear remotely; remote edits pull on poll; last-write-wins on conflict.
### Done

- [x] **Notes chrome (F8 / M1)** ? Sidebar: three icon-only theme toggles (Light / System / Dark). Note mode bar: icon-only Visual / Source; compact export trigger. **Markdown** and **Print** rows have no subtitle hints.
- [x] **Mobile main nav (?767px)** ? Masthead hamburger + title; **New** row with Note / File / Drawing; **Ctrl+N** expands New; Vault, Search, Graph, theme, Settings, Close vault.
- [x] **File browser ? image thumbnails (F5)** ? Grid 56�56 / list 20�20; cache; rename refreshes thumbnail.
- [x] **File browser ? delete (F3)** ? ConfirmDialog single/batch. **2026-04-08**
- [x] **Vault tree DnD (C21)** ? `refreshToken` + `TreeNode` readdir. Log-verified 2026-04-09.
- [x] **Canvas ? image place / resize undo (C19/C20)** ? User-verified 2026-04-09.
- [x] **FSAPI vault persistence** ? Reconnect prompt; close vault clears handle.

---

## Addressed in code (archive)

Canvas follow-ups **C14?C25** and tree **C21/C21b** are closed in code; PDF toolbar/side-column/autosave items **P2, P12, P13** are implemented (verify under **Manual verification ? PDF**).

### Canvas ? UX & tools

| ID | Topic | Notes |
|----|--------|------|
| C1 | New canvas title | Defer mount until `isNew` clears; `tabIndex={-1}`. |
| C2 | Toolbar vs tool | `applyFabricToolModeFromStore` after load; path + rAF resync. |
| C3 | Text discoverability | Hints above dock; `title` on tool buttons. |
| C4 | Text formatting | `resolveFormattableTextbox`; sticky body formattable. |
| C5 | Connect (legacy) | Edge IDs, erase line+head; **new** connect removed in C23. |
| C6 | Erase | Drag-to-erase; frames/edges; padding on thin objects. |
| C7 | Images | Sync dimensions; `object:modified` snapshots. |
| C8 | Frames | No create button; legacy frames render. |
| C9 | Wiki-link | Double-click navigate only. |
| C10 | Open from tree | `openTab` + store; no lost tabs on mode switch. |
| C11 | Fabric lifecycle | `isAlive`; guarded async loads. |
| C12 | Autosave | Interval + blur + flush on rename. |
| C13 | Undo | Confirmed working. |
| C14?C17 | Text UX | First-edit, inline styles, strip, font dropdown previews (`canvas-editor.tsx`, `canvas-toolbar.tsx`). |
| C18 | Rename collision | `vaultPathsPointToSameFile` (`lib/fs/vault-path-equiv.ts`). |
| C19 | Image auto-select | After toolbar add image. |
| C20 | Image undo/redo | Resize/move/rotate snapshots. |
| C22 | Browse header | `config.name` + folder path in `file-browser-view.tsx`. |
| C23 | Connect removed | Toolbar/hotkeys; legacy edges render. |
| C24 | Sticky removed | Toolbar; legacy stickies render. |
| C25 | Partial erase | `splitFabricPath` in `canvas-editor.tsx`. |

### Vault ? product

| ID | Topic | Notes |
|----|--------|------|
| N2 | Layout labels | Emoji tree/browse; `aria-label` + `title`. |

### File browser

| ID | Topic | Notes |
|----|--------|------|
| F1 | Move | `MoveToFolderDialog`; folder `rename()` in OPFS/FSAPI (`getDirectoryHandle`, `copyDirRecursive` fallback); `FolderRow` `div[role=button]` (no nested `<button>`); `executeMoveToFolder` retargets tabs + toast on error. |
| F2 | Context menu | `...rest` on card/row; `handleScrollPointerDown` ignores non-descendant targets (portal menus). |
| F3 | Delete | `ConfirmDialog`. |
| F5 | Thumbnails | `getImageThumbnail`; grid/list sizes. |
| F7 | New file flow | Popover + import + blank PDF + `pdfPageStyle`. |
| F8 | Chrome | Icon-only sidebar theme + note mode bar. |

### Vault file tree

| ID | Topic | Notes |
|----|--------|------|
| T1 | Image files | `ImageEditorView` / `VaultImageView` by type. |
| C21 | DnD refresh | `refreshToken` on `TreeNode` `readdir` effect. |
| C21b | Context menu | `TreeContextMenu` on file/folder rows. |

### Markdown / notes

| ID | Topic | Notes |
|----|--------|------|
| M1 | Print label | **Print** vs export wording. |
| M2 | Export | Markdown download + print pipeline. |

### PDF viewer / editor

| ID | Topic | Notes |
|----|--------|------|
| P1 | Outline | Superseded: Outline tab in `PdfSideColumn`. |
| P2 | Pages / Outline column | Tabbed column; default Pages; auto-collapse ?1 page; Layers rail. |
| P12 | Flatten / save | Autosave via `VaultConfig.autoSave`; no separate Save/Flatten in toolbar. |
| P13 | Save button | Autosave-only (see P12). |
| P3?P11, P14?P15 | Annotations & UX | Text tool, pen/highlight colours, writer/reader, comments, signature, add page, forms, search, palettes, toolbar undo/thumbnails (`PdfToolbar`, `PdfViewer`, etc.). |

### Sync

| ID | Topic | Notes |
|----|--------|------|
| S0 | Cloud sync engine | `SyncManager` + `SyncState` + `ChangeDetector` + `TokenStore`; Dropbox (`lib/sync/providers/dropbox.ts`, OAuth 2 PKCE, app-folder paths, UTF-8-safe `Dropbox-API-Arg`); `SyncProvider` + `useSyncPush`; Settings Sync tab; Vault toolbar manual sync when Dropbox is configured; save hooks. |
| S1 | OAuth return | `app/auth/dropbox/page.tsx`; `lib/sync/oauth-session.ts` stashes `vaultId` + `remoteRoot` before redirect (token key = `activeVaultPath`). |

### Older notes (pre-ID)

- File browser: rubber-band multi-select (repo history).
- 2026-04-02 canvas launch notes: largely superseded by tables above.
