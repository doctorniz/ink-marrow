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
| Chat | AI1 | Embeddings RAG | Vault chat v1 uses MiniSearch (lexical) for retrieval. True embeddings (Transformers.js + local vector store) deferred to tier 2 — better recall on paraphrased questions at the cost of a ~100MB model download. |
| Chat | AI2 | Canvas content RAG | MiniSearch indexes canvas titles/paths only, not pixel or stroke data. Vault chat will not retrieve drawing content until an OCR/caption pass is added. |
| Chat | AI3 | WebLLM install | `@mlc-ai/web-llm` is a runtime-only peer dep (not in `package.json`); document `pnpm install @mlc-ai/web-llm` for users who pick that provider. Dynamic import is `@ts-expect-error` until then. |
| Chat | AI4 | Tool calling / writes | Both chat surfaces are read-only — no document edits, file creation, or multi-step agents. Deferred until after vault chat UX settles. |
| Chat | AI5 | PDF rename → asset-id | Out-of-band OS renames while the app is closed break the PDF→`chatAssetId` mapping in `_marrow/_chats/index.json`. In-app renames are handled. Consider a periodic reconciliation pass. |

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
- [ ] **Board** ? Ctrl+4 opens Board; "Add Thought" creates a card; right-click the button for color picker; click card to edit inline (Ctrl+B/I/U work, no toolbar); Escape or click-away saves; delete via trash icon on hover; `_marrow/_board/` files hidden from Vault tree and Files; image upload creates image card with preview. Empty state shows prompt. Cards sort newest-first.
- [ ] **Bookmarks** � Ctrl+4 opens Bookmarks; "Add Bookmark" opens dialog; paste URL triggers OG fetch (title, description, favicon, OG image); save creates `.md` in `_marrow/_bookmarks/`; edit via pencil icon on hover; delete via trash on hover; categories as subfolders with sidebar; "Add category" creates folder; `_marrow/_bookmarks/` hidden from Vault tree and Files. OG fetch degrades gracefully if CORS blocks.
- [ ] **Calendar** — Ctrl+5 opens Calendar; current month renders with day/weekday headers; click a day ? New Event dialog opens with that day pre-filled; fill title + color + date/time range and Create; event chip appears on the grid; click chip ? Edit Event; update fields and Save; verify event chip updated; click Delete and confirm gone. Tasks with `due` dates appear as greyed "task due" chips (no interaction). Month nav (chevrons + Today button) works. Settings ? Calendar shows Google / Apple / Outlook greyed "Coming soon" items.
- [ ] **Tasks** � Ctrl+3 opens Tasks; type in quick-add bar and press Enter to create a task (no `!n` = default priority, must not throw YAML errors); try `!1 Fix bug #work >tomorrow` and confirm priority, tag, and due are parsed; try **on Friday** / **every Tuesday** in quick-add and confirm due / weekly chip and one row in Upcoming; click task row to open detail dialog; confirm priority/due and list/tags columns do not overlap; footer **Delete** stays visible with many subtasks and shows red/destructive styling; change title, notes, priority, due, list, tags and save; toggle checkbox to mark done (greyed + struck through); click "Clear done" to remove completed; create a list from sidebar; move a task between lists; add a subtask from detail dialog; toggle subtask checkbox; export `.ics` via download button. `_marrow/_tasks/` hidden from Vault tree but visible in Files view.
- [ ] **Kanban** � New File popover > Kanban creates Kanban YYYY-MM-DD.md with 	ype: kanban and three default column tints (amber / sky / emerald). Drag cards by the vertical grip; drag columns by the horizontal grip on the header to reorder; column color dots under the header; add cards (Enter); max-height cards scroll long text; auto-save; reopen and verify; readable as markdown externally.
- [ ] **Chat ? Settings tab** ? Settings ? AI: provider select lists **OpenRouter, Anthropic, OpenAI, Gemini, HuggingFace** as selectable (none labelled "coming soon"). Pick each provider in turn and confirm: API-key hint text + placeholder updates per provider; Paste key, Save ? key round-trips through IndexedDB (`mentis-llm-keys`, key `llm:<provider>:<vaultPath>`); reopen Settings and key field repopulates. Clear button removes the key from IDB. Default model, base URL, max context chars, system prompt fields persist in `_marrow/config.json` (`chat` section). **Key must NOT appear in `config.json`** ? only in IndexedDB, never synced to Dropbox. window.ai and local Gemma remain off the dropdown (deferred).
- [ ] **Chat ? Markdown panel** ? Open any `.md` file in Vault; floating ? button sits top-right of the editor. Click ? to open chat; first open mints a `chatAssetId` UUID into the note's frontmatter and persists on next auto-save (verify by switching to Source mode and seeing `chatAssetId:` in YAML). Close and re-open the panel ? same id reused; any existing threads load. Rename the `.md` file ? chat folder `_marrow/_chats/<chatAssetId>/` does NOT move; threads remain. Typing while panel is open: Enter sends, Shift+Enter newline, Esc during streaming cancels. Resize divider by dragging; width persists across reloads per surface (`localStorage['ink-marrow:right-panel-width:md']`). Divider re-clamps when the window/viewport shrinks so the right pane never exceeds 60% of the editor column. EmptyState varies: "Chat isn't set up yet" when no provider, "API key required" when provider configured but key missing, "Ask about this document" when ready. Streaming reply shows `?` cursor; Stop button swaps in during stream; error text surfaces below messages on provider failure.
- [ ] **Chat ? Unified right column** ? For markdown tabs, the chat panel and the backlinks section share one resizable column. With chat closed: backlinks fills the column. Open chat: chat takes the top ~60%, backlinks caps at 40% below. Collapse the backlinks section (chevron on its header): chat rises to fill the remaining height; only the "Backlinks" header bar remains pinned. Expand backlinks again and confirm the chat pane shrinks back to its share. Collapsed state persists across reloads (`localStorage['ink-marrow:backlinks-collapsed']`). The column has a single vertical divider (no doubled borders) between editor and right column.
- [ ] **Chat ? PDF panel** ? Open any `.pdf` in Vault; floating ? button sits top-right of the PDF viewer. Click ? to open chat; verify `_marrow/_chats/index.json` is created/updated with a new `entries["<vault-path-to.pdf>"]: <uuid>` row (temp+rename ? no `.tmp` leftovers). Close and re-open the panel ? same `chatAssetId` reused. Chat panel width is persisted under a key distinct from markdown (`localStorage['ink-marrow:right-panel-width:pdf']`) so md and PDF remember separate widths. PDF tab has no Backlinks section in the column ? chat fills the full right column. Ask a question grounded in the PDF text ? the context builder reads extracted page text and the reply is grounded accordingly.
- [ ] **Chat ? Sidecar files** ? After the first successful reply: file `_marrow/_chats/<chatAssetId>/<threadId>.json` exists on disk (JSON with `schemaVersion`, `messages`, `title`, timestamps). Thread title auto-derives from the first user message (truncated to 60 chars). Trigger a mid-write crash simulation (kill dev server during send) ? no orphan `.tmp` files should survive across a reopen (temp+rename). `_marrow/_chats/` is hidden from: Vault tree, Files browser, Search results, Graph. Create a second thread via "+"; switch between tabs; delete a thread via trash icon ? JSON file removed from disk.
- [ ] **Chat ? Provider round-trip** ? For each of `openrouter`, `openai`, `anthropic`, `gemini`, `huggingface`: add a valid API key and a known working model id; open chat on a note; send a prompt. Expect streaming tokens to appear progressively (not dumped at the end). Stop button cancels mid-stream without leaving a half-written assistant message persisted to disk. Provider-specific wire format smoke-checks: **Anthropic** request uses `x-api-key` + `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true` headers, system messages are hoisted top-level, SSE deltas arrive via `content_block_delta`; **Gemini** request path is `.../models/<model>:streamGenerateContent?alt=sse&key=<apiKey>`, system prompt rides in `systemInstruction`, role `assistant`?`model`; **OpenRouter/OpenAI/HuggingFace** use standard `/v1/chat/completions` with Bearer auth and OpenAI-style SSE deltas.
- [ ] **Chat — Local providers** — `Ollama`: start `ollama serve` (or the desktop app); pull a model (e.g. `ollama pull llama3.2`); in Settings → AI pick **Ollama (local)**, leave API key blank, set Default model to `llama3.2`; send a prompt and confirm streaming works. Stop `ollama serve` and retry — error toast should mention "Could not reach Ollama at http://localhost:11434/v1". `window-ai`: enable `chrome://flags/#optimization-guide-on-device-model`, restart Chrome, let it download Gemini Nano; in Settings pick **Chrome built-in (window.ai)**; send a prompt and confirm deltas appear (not a single dump). On browsers without the Prompt API the EmptyState / error should say the API is unavailable. `webllm`: run `pnpm install @mlc-ai/web-llm`; in Settings pick **WebLLM (in-browser, WebGPU)** with Default model `gemma-3-4b-it-q4f16_1-MLC`; first prompt triggers a weight download and a `ink:webllm-progress` CustomEvent fires on `window` (observe in devtools: `window.addEventListener('ink:webllm-progress', console.log)`); subsequent prompts are instant. On Safari / non-WebGPU Chromium the error message should mention WebGPU.
- [ ] **Vault chat (Ctrl+0)** — Top-most left-nav entry labeled **Chat** (Sparkles icon); keyboard Ctrl+0 (Cmd+0 on mac) focuses it. View renders full-viewport: thread list sidebar on the left, messages + composer on the right. EmptyState copy changes by state: "Vault chat isn't set up yet" (no provider), "API key required" (key missing), "Ask anything about your vault" (ready). Send a prompt like *"what did I write about X?"* where X appears in at least one note: assistant reply arrives as streaming deltas, references backticked paths inline, and a Sources chip strip below the message renders clickable file chips. Clicking a chip opens the file in the Vault view with the path pre-selected. Thread list: "+" creates a new empty chat; title is derived from the first user message (truncated to 60 chars); trash icon on hover deletes; selecting another thread preserves its messages. Threads persist at `_marrow/_chats/_vault/<threadId>.json` (crash-safe temp+rename); reopen the app and the most recent thread is restored. `_vault` folder is hidden from the Vault tree, Files browser, Search, and Graph (inherited `_marrow/` rule). RAG: change `maxContextChars` in Settings; confirm vault excerpts are capped accordingly and the system message carries source tags.
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
