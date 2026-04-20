# Canvas (PixiJS) — Bug Report

**Date:** 2026-04-18 (initial triage) · **Post-fix review:** 2026-04-19
**Reviewer:** Senior Graphics Engineer (PixiJS/WebGL)
**Scope:** Canvas editor only (`src/components/canvas/`, `src/lib/canvas/`, `src/stores/canvas.ts`)
**Test target:** `http://localhost:3000`, opened `Drawing 2026-04-18.canvas`

---

## Executive Summary

The canvas engine is well-structured architecturally — clean separation between `CanvasEngine` orchestrator, `LayerManager` (GPU resources), `StrokeEngine` (pointer → stamps), `BrushSystem` (pixel output), `ViewportController` (pan/zoom), and `UndoManager` (per-layer PNG snapshots). The initial triage surfaced 18 bugs across correctness, UX, and GPU-efficiency. **All 18 have since been addressed in code**; a follow-up storage refactor (post-fix) moved sidecar PNGs into a hidden, filename-decoupled folder under `_marrow/_drawings/`. See the *Post-fix Storage Refactor (v4 → v5)* section below for the full story.

---

## Severity Legend

- **P0** — Broken primary feature, data loss risk, or wrong visual output
- **P1** — Visible UX bug, feature does nothing, or architectural issue with real impact
- **P2** — Polish, naming, minor drift between UI and engine capabilities

---

## Status Legend

- **✅ Resolved** — verified fixed by static inspection; behavior expected to match the "Fix" description.
- **🟡 Resolved w/ caveat** — fix shipped but has a known boundary (e.g., partial mitigation, orphan file policy deferred).
- **🔲 Open** — not yet addressed.

At the time of this review every entry is ✅ or 🟡. See the **Manual Verification Checklist** at the end to walk through the behavior changes in a real browser.

---

## P0 — Broken Primary Features

### BUG-01 — Eraser paints a grey stroke instead of erasing

**Status:** ✅ Resolved
**Fix location:** `src/lib/canvas/brush-system.ts` (split `renderEraserStamps` path) · `src/lib/canvas/stroke-engine.ts` (skips scratchpad for eraser) · `src/lib/canvas/layer-manager.ts`

**Repro**
1. Open `Drawing 2026-04-18.canvas`
2. Click the Eraser tool (or press `E`)
3. Drag across an existing stroke

**Observed (pre-fix)**
A translucent grey line appeared over the existing strokes. Nothing was actually erased.

**Expected**
Pixels under the cursor become transparent (alpha subtracted from the active layer).

**Root cause**
The eraser workflow pre-fix was:
1. `BrushSystem.renderStamps` set `g.blendMode = 'erase'` on the stamp `Graphics` and rendered into the scratchpad RenderTexture (`clear: false`).
2. `StrokeEngine.endStroke` called `LayerManager.commitScratchpad`, which drew the scratchpad sprite onto the active layer RT with the default `Sprite.blendMode = 'normal'`.

The `'erase'` blend applied against the *empty* scratchpad had nothing to erase, so the stamp drew with alpha equal to its own stamp opacity. The scratchpad was then composited onto the target layer with *normal* blend, so the stroke appeared as a translucent black (`color = 0x000000`, `alpha = opacity * pressure`) — i.e., grey.

**Fix**
Eraser strokes now skip the scratchpad entirely. `BrushSystem.renderEraserStamps` renders pooled alpha-mask `Sprite`s with `blendMode = 'erase'` *directly* into the active layer's RenderTexture. The stamp mask is an opaque white disc (`createCircleMaskTexture`); its alpha subtracts from the layer per the destination-out semantics. See also BUG-07 — the normal-brush path was also rewritten at the same time to use a Sprite + alpha-mask pipeline.

---

### BUG-02 — Fill tool is a no-op

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-viewport.tsx` · `src/lib/canvas/flood-fill.ts` · `src/lib/canvas/layer-manager.ts` (`floodFillLayer`)

**Repro**
1. Press `G` or click the paint-bucket icon
2. Click anywhere on the canvas

**Observed (pre-fix)**
Nothing happened. The tool button showed as active, but clicking did not fill.

**Expected**
Flood-fill the contiguous region under the cursor on the active layer.

**Root cause**
`onPointerDown` had branches for `pan`, `brush`, `eraser`, `eyedropper` — no branch for `fill`. The tool was listed in `TOOLS` and in the keyboard shortcut map, but no code implemented it.

**Fix**
`onPointerDown` now has a `fill` branch that converts the pointer hit to canvas space, resolves the active-layer id, snapshots the layer's current pixels for undo (must happen *before* the fill mutates the RT), calls `engine.layerManager.floodFillLayer(layerId, x, y, r, g, b, a)`, and pushes a `stroke`-kind undo entry with description `"Fill"`. `hexToRgba` / `rgbToHex` helpers live in `lib/canvas/flood-fill.ts`.

---

### BUG-03 — Eyedropper tool is a no-op

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-viewport.tsx` · `src/lib/canvas/layer-manager.ts` (`sampleCompositedPixel`)

**Repro**
1. Press `I` or click the pipette icon
2. Click on an existing colored stroke

**Observed (pre-fix)**
Nothing happened — the current brush color did not change. Literal `// TODO: pick color from canvas` comment in `onPointerDown`.

**Fix**
`onPointerDown` now has an `eyedropper` branch that converts the pointer hit to canvas space and calls `engine.layerManager.sampleCompositedPixel(x, y, engine.background)` — this walks the visible layer stack top-down and returns the first RGBA sample, falling through to the canvas background. Result is converted via `rgbToHex` and pushed into `brushSettings.color` + `pushRecentColor`. No undo entry (the eyedropper is non-destructive).

---

## P1 — UX / Engine Issues

### BUG-04 — Color section is shown when the Eraser tool is active

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-properties-panel.tsx` (lines 70–75 — gating booleans)

**Repro**
1. Select the Eraser tool

**Observed (pre-fix)**
The full Color section (picker, hex input, 20-swatch grid, recent colors) rendered above the "Eraser Size" slider. Color is meaningless for the eraser.

**Fix**
Color, Size, Opacity, and Hardness sections are now each gated on a per-tool boolean (`showColor`, `showSize`, `showOpacity`, `showHardness`). The panel only renders sections that meaningfully affect the active tool — see BUG-08 for the full gating matrix.

---

### BUG-05 — Canvas does not resize when its container resizes

**Status:** ✅ Resolved
**Fix location:** `src/lib/canvas/engine.ts` (`init` attaches `ResizeObserver`; `destroy` disconnects synchronously at the top)

**Repro (programmatic, pre-fix, verified via DevTools console)**
1. Inspect `canvas.width` → `2932`, `getBoundingClientRect().width` → `2624`
2. Shrink the parent container (e.g., expand file browser pane)
3. Canvas CSS width now `800`, but `canvas.width` still `2932`
4. Draw a stroke — it lands at wrong pixel coordinates relative to what the user sees

**Root cause**
PixiJS v8's `resizeTo: container` option actually listens to `window` resize events, not container resize. The editor's container changes size independently of the window whenever the sidebar collapses/expands, file browser pane is resized, or devtools docks/undocks.

**Fix**
`engine.init` now creates a `ResizeObserver` that calls `this.app.renderer.resize(w, h)` on content-rect changes (`Math.max(1, Math.floor(…))` to avoid zero-size renders). The observer is unobserved + disconnected *synchronously* at the top of `destroy()`, before any other teardown — mirroring the discipline documented in CLAUDE.md "Canvas Lifecycle" for the Pixi ticker. The `_initialized` flag is also flipped false before disconnect so any queued observer callback short-circuits. Layer `RenderTexture`s remain fixed at 2048×2048; only the *viewport canvas* follows the container.

---

### BUG-06 — Cursor never changes when the tool changes

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-viewport.tsx` (reactive selectors + `useMemo` cursor) · `src/lib/canvas/engine.ts` (`canvas.style.cursor = 'inherit'` on the Pixi `<canvas>`)

**Repro**
1. Select Pan tool (hand icon or `H`)
2. Hover over the drawing area

**Observed (pre-fix)**
Cursor stayed at `crosshair` (confirmed via `getComputedStyle`) even though `getCursorForTool()` should have produced `grab`.

**Root cause (two layers)**
1. `CanvasViewport` read `activeTool` via `useCanvasStore.getState()` — a non-reactive snapshot. The component never re-rendered on tool switch, so the inline `style.cursor` was frozen at first-mount value.
2. Even with the reactive selector in place, the cursor *still* didn't paint: the Pixi-created `<canvas>` overlays the host div at 100% × 100%, and Chromium's UA-default `cursor: auto` on `<canvas>` resolves to `default` (not to the parent's used value), so the host div's cursor was hidden beneath the canvas.

**Fix**
- `CanvasViewport` now subscribes to `activeTool` and `activeLayerId` + `layers` reactive selectors; `cursor` is derived via `useMemo(cursorForTool(activeTool, activeLayerLocked), …)` and applied via inline `style.cursor`.
- `CanvasEngine.init` sets `canvas.style.cursor = 'inherit'` on the Pixi `<canvas>` so CSS cursor propagation from the host div works.
- Locked active layer short-circuits to `not-allowed` for all pixel-mutating tools; `pan` always stays `grab` (viewport pan is never a mutation).

---

### BUG-07 — Soft brush at 100% opacity renders at ~50% visible alpha

**Status:** ✅ Resolved
**Fix location:** `src/lib/canvas/brush-system.ts` (Sprite + alpha-mask pipeline, hardness-quantized mask cache) · `src/components/canvas/canvas-properties-panel.tsx` (Hardness slider)

**Observed (pre-fix)**
Default brush at 100% opacity painted a translucent grey wash instead of the chosen color at full strength.

**Root cause**
`DEFAULT_BRUSH.hardness = 0.8` fell below the `>= 0.9` soft-branch threshold, which then applied `a = alpha * (1 - (i - 1) / layers) * 0.5` per concentric ring. The baked-in `* 0.5` capped effective alpha at 50%; three overlapping circles of decreasing alpha produced a translucent wash.

**Fix**
The multi-ring soft-brush impl was dropped. Brush stamps now use a pooled `Sprite` sampling a pre-rendered alpha-mask texture (`createSoftBrushMaskTexture`) — opaque core of radius `r * hardness`, radial gradient from opaque to transparent over `r * (1 - hardness)`. Peak alpha at the core is 1; `Sprite.alpha` multiplies in the per-stamp opacity. 100% opacity at 100% pressure now actually paints opaque at the core. The mask is quantized to 20 hardness steps and rebuilt only on change. A Hardness slider is now present in the properties panel (brush tool only).

---

### BUG-08 — Properties panel shows brush controls for Fill / Eyedropper tools

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-properties-panel.tsx` (`showColor` / `showSize` / `showOpacity` / `showHardness`)

**Gating matrix as shipped:**

| Section   | Brush | Eraser | Pan | Fill | Eyedropper |
|-----------|:-----:|:------:|:---:|:----:|:----------:|
| Color     |   ✓   |   —    |  —  |  ✓   |     —      |
| Size      |   ✓   |   ✓    |  —  |  —   |     —      |
| Opacity   |   ✓   |   —    |  —  |  ✓   |     —      |
| Hardness  |   ✓   |   —    |  —  |  —   |     —      |

Pan and Eyedropper show only the Layers + Active-Layer Settings sections. Eraser shows only Size (labeled "Eraser Size"). Panel is now honest about what the current tool actually consumes.

---

### BUG-09 — Layer deletion has no confirmation

**Status:** ✅ Resolved (via undo, not a confirmation dialog — see rationale)
**Fix location:** `src/components/canvas/canvas-properties-panel.tsx` (`handleRemoveLayer`) · `src/lib/canvas/undo-manager.ts` (`remove-layer` entry) · `src/lib/canvas/layer-manager.ts` (`captureLayerData`, `insertLayerFromData`)

**Fix**
A single-click delete is still allowed — but the deletion is now a first-class undo entry. Before `removeLayer`:
1. `captureLayerData(id)` snapshots the doomed layer's full data (metadata + pixel PNG bytes from `extract.base64`).
2. If capture fails (GPU extract rejected or layer already gone), we bail with a toast and do **not** delete. No silent pixel loss.
3. A `remove-layer` undo entry is pushed with `{ layerData, index, wasActive }`.
4. Toast: `Deleted <name> — Ctrl+Z to undo`.

`UndoManager.reverseRemoveLayer` is bidirectional: undoing a deletion reinserts the layer at its original stack index with pixels intact (via `insertLayerFromData`); redoing captures fresh pixels first (so any edits after the undo survive a redo) and then re-deletes.

The trash button is also `disabled` when only one layer remains, both as a guard in `handleRemoveLayer` and on the DOM button itself.

---

### BUG-10 — Layer drag-to-reorder is engine-ready but unreachable in the UI

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-properties-panel.tsx` (`draggable`, `handleLayerDragStart/Over/Drop/End`, drop-indicator rule)

**Fix**
Each layer row is now `draggable`, has a `GripVertical` grab handle, and listens to `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd`. A blue drop-indicator rule renders above or below the hover target depending on cursor Y vs row midpoint. The reorder is applied via `engine.layerManager.reorderLayers(after)` and pushed as a `reorder-layers` undo entry carrying `before` + `after` arrays; `UndoManager.reverseReorder` just swaps them. `e.dataTransfer.setData('text/plain', id)` is set because Firefox otherwise refuses to fire any drag events.

---

## P1 — Data & Memory

### BUG-11 — Unmount save races with engine destruction

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-editor.tsx` (async `run()` awaits `flushSave` before `engine.destroy()`; `pendingCanvasSaves` map hand-off to next mount)

**Pre-fix**
`flushSave(engine, vaultFs, pathRef.current)` was fire-and-forget, then `engine.destroy()` ran synchronously on the same tick. `extract.base64` in `flushSave` touched a renderer that `app.destroy()` had already nuked, fell through to stale `lastSavedBase64`, and silently persisted the last autosaved pixels — in-flight changes between the last autosave and unmount were lost.

**Fix**
```ts
const run = async () => {
  if (shouldFlush) {
    try { await flushSave(engine, vaultFs, savePath) } catch { /* best-effort */ }
  }
  engine.destroy()
}
const promise = run()
pendingCanvasSaves.set(savePath, promise)
void promise.finally(() => {
  if (pendingCanvasSaves.get(savePath) === promise) pendingCanvasSaves.delete(savePath)
})
```

Critical additional piece: `pendingCanvasSaves` is a module-scope `Map<path, Promise>` so the *next* mount of the same path can `await` the previous mount's flush before reading the `.canvas` JSON. Without that hand-off, a rapid close-and-reopen would read stale disk bytes and the next save would overwrite the user's in-flight changes.

Unmount saves to `pathRef.current` (live path), not the closure's `path` — after a rename, the closure still holds the old path, which would recreate the old file as a duplicate.

---

### BUG-12 — Undo stack memory footprint

**Status:** 🟡 Resolved w/ caveat
**Fix location:** `src/lib/canvas/undo-manager.ts` + `src/types/canvas.ts` (`LayerSnapshot.blob: Blob`) · `src/lib/canvas/layer-manager.ts` (`extractLayerBlob`, `restoreLayerFromBlob`)

**Fix**
Stroke undo now stores PNG `Blob` objects instead of base64 strings. Two practical wins:
- Blobs live off the JS heap (especially in Chromium — stored in backend memory), so 30 × multi-MB snapshots no longer anchor the JS heap at ~150 MB.
- No base64 encode/decode churn; `restoreLayerFromBlob` pipes bytes straight into `createImageBitmap(blob)` → `Texture.from({ resource: bitmap })` for load.

**Caveat**
Snapshots are still *full-layer* PNGs. A bounding-box / tile-based dirty-region snapshot (only the stamped rectangle per stroke) remains open — most strokes touch <5% of the 2048×2048 canvas, so there's another ~20× memory reduction waiting here. Deferred: requires either a dirty-region accumulator in `StrokeEngine` or a diff-based snapshot strategy. Worth revisiting once real usage data tells us the stack is still heavy.

---

### BUG-13 — On-disk `.canvas` JSON grows unboundedly with layer count × density

**Status:** ✅ Resolved (with follow-up storage refactor — see *Post-fix Storage Refactor (v4 → v5)* below)
**Fix location:** v4 — `src/lib/canvas/serializer.ts` + `src/lib/canvas/canvas-file-io.ts` (sidecar PNG format) · v5 — same files (move sidecar into hidden `_marrow/_drawings/<assetId>/`)

**Fix**
As of v5 (post-fix refactor), pixel PNGs live under `_marrow/_drawings/<assetId>/<layerId>.png`. The `.canvas` JSON carries only metadata (ids, names, opacity, visibility, lock, blend mode) plus `assetId`, `viewport`, `background`, `width`, `height`, `activeLayerId`. A 5-layer dense canvas that was previously ~10–25 MB of JSON is now a few hundred bytes of JSON + 5 PNG files Dropbox can sync as per-file deltas. `JSON.parse` cost on open is now negligible.

v3 (inline base64) and v4 (sibling `<path>.canvas.assets/` folder) files remain openable; both migrate to v5 on first save.

---

## P2 — Polish / Drift

### BUG-14 — Adding a layer after deleting a middle layer produces duplicate names

**Status:** ✅ Resolved
**Fix location:** `src/lib/canvas/layer-manager.ts` (`_layerSeq` monotonic counter)

**Fix**
`addLayer` no longer uses `this.layers.length + 1` to build a default name. A `private _layerSeq = 0` counter is incremented on every default-named add and *never decremented*. The counter is also bumped past any `Layer N` name encountered in `loadLayers` and `insertLayerFromData` so that a newly loaded canvas or an undone deletion cannot fabricate a duplicate on the next `+`. Explicit names passed to `addLayer` (e.g. `duplicateLayer`'s `"… copy"`) win — but if they match the `Layer N` pattern the counter still advances past them.

---

### BUG-15 — Tool strip does not match product docs

**Status:** ✅ Resolved
**Fix location:** `CLAUDE.md` — Canvas section

**Fix**
CLAUDE.md's Canvas paragraph now lists the actually-shipped tools: `Brush (B), Eraser (E), Pan (H), Fill (G), Eyedropper (I)`. Select / Pencil / Pen / Marker / Text have been removed from the copy until those tools exist. The `docs/PRD.md` / onboarding copy should be swept in a follow-up if they drift again; current source of truth for tools is `CanvasToolStrip.TOOLS` in `src/components/canvas/canvas-tool-strip.tsx`.

---

### BUG-16 — Non-Pixi blend modes listed in UI

**Status:** ✅ Resolved
**Fix location:** `src/lib/canvas/constants.ts` (split `STANDARD_BLEND_MODES` / `HSL_BLEND_MODES`) · `src/components/canvas/canvas-properties-panel.tsx` (dropdown renders `<optgroup label="HSL (may fall back to Normal)">`)

**Fix**
`BLEND_MODES` is now the union of two explicit lists. The blend-mode `<select>` renders the standard modes as regular `<option>`s and the HSL modes (`luminosity`, `color`, `saturation`) inside an `<optgroup label="HSL (may fall back to Normal)">`. Users can still select them — they may silently fall back to `normal` depending on the PixiJS v8 WebGL backend, but the fallback is no longer a surprise. The legacy flat `BLEND_MODES` export is kept for string validation callers.

A proper implementation of HSL blending requires a filter-backed composite pass — deferred.

---

### BUG-17 — `pushRecentColor` floods on color-picker drag

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-properties-panel.tsx` (`handleColorChange` vs `handleColorCommit`)

**Fix**
Two handlers now split live-drag updates from commits:
- `handleColorChange(color)` — updates `brushSettings.color` only. Wired to the native `<input type="color">` `onChange` so the brush preview tracks the picker thumb in real time, but without polluting `recentColors`.
- `handleColorCommit(color)` — updates `brushSettings.color` AND pushes to `recentColors`. Wired to `onBlur` on the native picker (fires after the picker closes), and to the text-input, swatch, and recent-color click handlers.

Net: the recent-colors strip only gains entries when the user *chooses* a color, not for every intermediate hue during a drag.

---

### BUG-18 — `onWheel` may be passive-wrapped

**Status:** ✅ Resolved
**Fix location:** `src/components/canvas/canvas-viewport.tsx` (imperative `addEventListener('wheel', …, { passive: false })` in `useEffect`)

**Fix**
React attaches synthetic wheel events with `passive: true` and that cannot be overridden from JSX. We now attach `wheel` imperatively on `containerRef.current` with `{ passive: false }`, so `e.preventDefault()` actually suppresses the native scroll. The handler reads `engineRef.current` inside, so the effect dependency list is just `[containerRef, engineRef]` and the listener doesn't churn. Removed on cleanup.

---

## Post-fix Storage Refactor (v4 → v5)

After the 18-bug fix pass, the sidecar PNG storage was refactored once more based on user direction: *"save the pngs in a folder `_drawings` which lives in `_marrow` so that they are hidden in the vault. Note that rename of the file does NOT rename the folder as well."*

### What changed

| Aspect | v4 (pre-refactor) | v5 (current) |
|--------|-------------------|--------------|
| PNG location | `<canvasPath>.assets/<layerId>.png` (sibling of `.canvas`) | `_marrow/_drawings/<assetId>/<layerId>.png` (hidden folder) |
| Visible in vault tree | Yes (noisy — one folder per drawing) | No (`_marrow/` is hidden) |
| Survives `.canvas` rename | No — sibling folder became orphan | Yes — `assetId` stored in JSON |
| Identifier | Derived from file path | UUID (`crypto.randomUUID()`) stored in `CanvasFile.assetId` |

### Rename invariant

Renaming `Drawing A.canvas` → `Doodle.canvas` does **not** touch `_marrow/_drawings/<assetId>/`. The reference from JSON to drawings folder is the `assetId` string, which travels inside the file contents. This is the explicit user requirement and the critical design choice.

### Migration policy

- **v3 (inline base64)** — still readable, migrates to v5 on next save.
- **v4 (sibling `<path>.canvas.assets/`)** — still readable, migrates to v5 on next save. The writer mints a fresh `assetId`, writes PNGs to `_marrow/_drawings/<assetId>/`, and leaves the old sibling folder behind as orphan — same policy as deleted-layer PNGs and `_marrow/snapshots/` PDF backups. A vault-wide cleanup pass can reap orphans later.

### Crash-safety

Write order is unchanged from v4: blobs are extracted from the GPU *before* any disk write; PNGs are written *before* the JSON. A crash mid-save can never leave the JSON pointing at unwritten PNGs. A failed blob (GPU extract returned `null`) is skipped rather than deleting the prior PNG — leaving last-good bytes on disk is strictly better than overwriting with nothing.

### Defensive `assetId` validation

Parsed `assetId` values are run through a canonical-UUID regex before being trusted. Anything else is dropped, and the writer mints a fresh `assetId` on the next save (old pixel folder becomes an orphan). This is a cheap directory-traversal defense — `assetId` flows into a `_marrow/_drawings/<assetId>` path segment, and a hand-edited JSON with `../` or `/` or a null byte would otherwise escape the `_drawings/` root.

### New surface area

- `CANVAS_DRAWINGS_DIR = '_marrow/_drawings'` constant.
- `CanvasEngine._assetId` + `assetId` getter + `setAssetId(id)`.
- `canvasDrawingsDirFor(assetId)` / `canvasDrawingsLayerPath(assetId, layerId)` helpers in `serializer.ts`.
- v4 helpers (`canvasAssetsDirFor`, `canvasLayerAssetPath`) retained for the read-only fallback path.

---

## What Works Well

- Layer CRUD and opacity/visibility/blend-mode changes update the GPU correctly and persist through reload.
- Undo/redo for strokes, layer deletion, and layer reorder work and correctly propagate `canUndo/canRedo` to the button states.
- Auto-save (3 s interval + `saveOnBlur: true` + unmount flush) writes a valid JSON + PNG set and reloads cleanly.
- Keyboard shortcuts (`B/E/H/G/I`, `[`/`]`, `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`, `Ctrl+S`) work as documented.
- Zustand + Immer store layout is clean; the engine-vs-store split is defended well (GPU state in engine, metadata in store).

---

## Manual Verification Checklist

Walk through these in a browser with a fresh vault to confirm the fixes end-to-end. Each item lists the bug(s) it covers and what "pass" looks like.

### Tools — correctness

- [ ] **Eraser erases (BUG-01)** — Draw a stroke, switch to eraser (`E`), drag across it. Pixels become transparent (background shows through), not grey-painted.
- [ ] **Fill fills (BUG-02)** — Draw a closed shape, switch to fill (`G`), click inside. Region floods with the active brush color at active opacity.
- [ ] **Eyedropper samples (BUG-03)** — Draw with two different colors. Switch to eyedropper (`I`), click a colored stroke. Brush color + recent-colors strip update to that hex.

### Properties panel — tool gating

- [ ] **Eraser panel (BUG-04, BUG-08)** — Select eraser. Panel shows only *Eraser Size* (no color, opacity, or hardness).
- [ ] **Fill panel (BUG-08)** — Select fill. Panel shows Color + Opacity only (no size, no hardness).
- [ ] **Eyedropper panel (BUG-08)** — Select eyedropper. Panel shows no stroke controls (Layers section still visible).
- [ ] **Pan panel (BUG-08)** — Select pan. No stroke controls; Layers still visible.
- [ ] **Brush panel (BUG-07)** — Select brush. Color + Size + Opacity + *Hardness* slider all visible.

### Viewport behavior

- [ ] **Container resize (BUG-05)** — With canvas open, collapse/expand the vault sidebar or drag a pane divider. Draw a stroke afterwards — it lands exactly under the cursor, not squished/stretched. `canvas.width` matches `getBoundingClientRect().width × devicePixelRatio` in DevTools.
- [ ] **Cursor tracks tool (BUG-06)** — Switch tools with `B/E/H/G/I`. Cursor changes: crosshair for brush/eraser, grab for pan, copy for eyedropper, cell for fill. Lock the active layer — cursor becomes `not-allowed` for brush/eraser/fill/eyedropper but stays `grab` for pan.
- [ ] **Wheel zoom (BUG-18)** — Hover the canvas and scroll the mouse wheel. Canvas zooms around the cursor; the outer page *does not* scroll.

### Brush quality

- [ ] **Soft brush at 100% opacity (BUG-07)** — Hardness at default (~80%), opacity at 100%, draw on a blank layer. Core of the stroke is fully opaque (not a grey wash). Drag the Hardness slider to 0% — edges go soft; at 100% — edges are crisp.

### Layers panel

- [ ] **Drag-to-reorder (BUG-10)** — Grab a layer by the grip handle, drag above/below another row. Blue rule appears between rows; on drop, viewport z-order changes accordingly. `Ctrl+Z` restores the previous order.
- [ ] **Delete + undo (BUG-09)** — Draw on a non-bottom layer, click the trash icon. Toast: `Deleted <name> — Ctrl+Z to undo`. Press `Ctrl+Z` — layer reappears with its pixels. `Ctrl+Shift+Z` re-deletes.
- [ ] **Add after delete — no duplicates (BUG-14)** — Start fresh. Add layers until `Layer 1, Layer 2, Layer 3`. Delete `Layer 2`. Click `+` — new layer is `Layer 4` (not `Layer 3`).

### Color picker

- [ ] **Picker drag doesn't flood recents (BUG-17)** — Open the native color picker, drag through many hues, close it by clicking outside. `Recent Colors` gains **one** entry (the committed color), not ten.
- [ ] **Swatch click commits (BUG-17)** — Click a swatch. Active color + recent-colors both update.

### Blend modes

- [ ] **HSL modes labeled (BUG-16)** — Open any layer's Blend Mode dropdown. HSL modes (luminosity / color / saturation) are inside an `<optgroup>` labeled *"HSL (may fall back to Normal)"*. Standard modes are ungrouped.

### Persistence / lifecycle

- [ ] **Save + reload (BUG-11)** — Draw something, wait past the 3 s autosave interval, reload the page. Vault reopens with the stroke intact.
- [ ] **Draw-then-close race (BUG-11)** — Draw something, then *immediately* switch tabs / close the editor (before 3 s autosave fires). Reopen the file — stroke is there. (Without the fix this lost the in-flight change.)
- [ ] **Rapid reopen (BUG-11)** — Open canvas A, draw, switch to canvas B, immediately switch back to A. A shows the latest pixels. (Validates `pendingCanvasSaves` hand-off.)

### v5 storage (post-fix refactor)

- [ ] **PNGs hidden (v5)** — After first save, `_marrow/_drawings/<uuid>/` exists and contains one `<layerId>.png` per layer. The folder does not appear in the vault tree / file browser.
- [ ] **No sibling folder next to `.canvas`** — `Drawing.canvas` has no `Drawing.canvas.assets/` sibling (on a vault created fresh after v5).
- [ ] **Rename doesn't move folder** — Rename `Drawing.canvas` → `Sketch.canvas`. `_marrow/_drawings/<uuid>/` is untouched; reopen still shows all pixels.
- [ ] **v4 migration** — Open an older file that still has `<path>.canvas.assets/` (or manually create one to test). Pixels load correctly. Save once. `_marrow/_drawings/<new-uuid>/` is created; old sibling folder is left as orphan.
- [ ] **v3 migration** — Open a legacy v3 file with inline base64. Pixels load. Save once. Migrates to v5; JSON is now small.

### Undo memory (spot check, BUG-12)

- [ ] In DevTools Memory tab, record a heap snapshot after ~20 strokes. Detached PNG-blob-backed snapshots should not anchor large arrays of base64 strings in the JS heap. (Exact size depends on browser; this is a smoke test — the caveat about tile-based snapshots remains open.)

---

## Suggested Fix Order (historical — all now landed)

1. BUG-01 Eraser
2. BUG-11 Unmount save race
3. BUG-05 Container resize
4. BUG-04 + BUG-08 Properties panel gating
5. BUG-06 Cursor
6. BUG-09 Layer delete confirmation / undo
7. Everything else

---

## Files Read (initial triage)

- `src/components/canvas/canvas-editor.tsx`
- `src/components/canvas/canvas-viewport.tsx`
- `src/components/canvas/canvas-tool-strip.tsx`
- `src/components/canvas/canvas-properties-panel.tsx`
- `src/lib/canvas/engine.ts`
- `src/lib/canvas/layer-manager.ts`
- `src/lib/canvas/stroke-engine.ts`
- `src/lib/canvas/brush-system.ts`
- `src/lib/canvas/viewport-controller.ts`
- `src/lib/canvas/undo-manager.ts`
- `src/lib/canvas/constants.ts`
- `src/stores/canvas.ts`
- `src/types/canvas.ts`

Added during post-fix review: `src/lib/canvas/serializer.ts`, `src/lib/canvas/canvas-file-io.ts`, `src/lib/canvas/flood-fill.ts`, `CLAUDE.md`.
