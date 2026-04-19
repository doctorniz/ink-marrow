# Canvas (PixiJS) — Bug Report

**Date:** 2026-04-18
**Reviewer:** Senior Graphics Engineer (PixiJS/WebGL)
**Scope:** Canvas editor only (`src/components/canvas/`, `src/lib/canvas/`, `src/stores/canvas.ts`)
**Test target:** `http://localhost:3000`, opened `Drawing 2026-04-18.canvas`

---

## Executive Summary

The canvas engine is well-structured architecturally — clean separation between `CanvasEngine` orchestrator, `LayerManager` (GPU resources), `StrokeEngine` (pointer → stamps), `BrushSystem` (pixel output), `ViewportController` (pan/zoom), and `UndoManager` (per-layer PNG snapshots). However, there are several correctness, UX, and GPU-efficiency issues. The most serious finding is that **the eraser does not erase** — it paints a translucent grey stroke instead.

---

## Severity Legend

- **P0** — Broken primary feature, data loss risk, or wrong visual output
- **P1** — Visible UX bug, feature does nothing, or architectural issue with real impact
- **P2** — Polish, naming, minor drift between UI and engine capabilities

---

## P0 — Broken Primary Features

### BUG-01 — Eraser paints a grey stroke instead of erasing

**File:** `src/lib/canvas/brush-system.ts` · `src/lib/canvas/stroke-engine.ts` · `src/lib/canvas/layer-manager.ts`

**Repro**
1. Open `Drawing 2026-04-18.canvas`
2. Click the Eraser tool (or press `E`)
3. Drag across an existing stroke

**Observed**
A translucent grey line appears over the existing strokes. Nothing is actually erased.

**Expected**
Pixels under the cursor become transparent (alpha subtracted from the active layer).

**Root cause**
The eraser workflow is:
1. `BrushSystem.renderStamps` sets `g.blendMode = 'erase'` on the stamp `Graphics` and renders it into the **scratchpad** RenderTexture (`clear: false`).
2. `StrokeEngine.endStroke` calls `LayerManager.commitScratchpad`, which draws the scratchpad sprite onto the active layer RT with `clear: false` (default `Sprite.blendMode = 'normal'`).

The `'erase'` blend is applied when drawing onto the **empty scratchpad** — it has nothing beneath to erase, so the stamp effectively draws with alpha equal to its own stamp opacity. When the scratchpad is then composited onto the target layer with normal blend, the stroke appears as a translucent black (`color = 0x000000`, `alpha = opacity * pressure`) — i.e., grey.

**Fix direction**
Either:
- Apply `erase` blend during the *commit* from scratchpad to layer (set `scratchpadSprite.blendMode = 'erase'` in `commitScratchpad` when the committed stroke was an eraser stroke), OR
- Skip the scratchpad for eraser strokes and render stamps directly into the active layer RT with the `erase` blend applied to the `Graphics`.

The second approach is usually preferred — it avoids a needless render target, matches Photoshop/Procreate's destructive erase semantics, and keeps `onStrokeCommitted` coherent.

---

### BUG-02 — Fill tool is a no-op

**File:** `src/components/canvas/canvas-viewport.tsx`

**Repro**
1. Press `G` or click the paint-bucket icon
2. Click anywhere on the canvas

**Observed**
Nothing happens. The tool button shows as active, but clicking does not fill.

**Expected**
Flood-fill the contiguous region under the cursor on the active layer.

**Root cause**
`onPointerDown` in `canvas-viewport.tsx` has branches for `pan`, `brush`, `eraser`, `eyedropper` — no branch for `fill`. The tool is listed in `TOOLS` and in the keyboard shortcut map, but no code implements it.

**Recommendation**
Either hide the Fill button until implemented, or implement a basic scanline/queue fill against an extracted ImageBitmap of the active layer. Note that flood-fill on a 2048×2048 RenderTexture via `renderer.extract.pixels()` per click is ~16 MB / call — consider caching or using a web worker.

---

### BUG-03 — Eyedropper tool is a no-op

**File:** `src/components/canvas/canvas-viewport.tsx`

**Repro**
1. Press `I` or click the pipette icon
2. Click on an existing colored stroke

**Observed**
Nothing happens — the current brush color does not change.

**Root cause**
Literal `// TODO: pick color from canvas` comment in `onPointerDown`. No implementation.

**Recommendation**
`renderer.extract.pixels({ target: layer.renderTexture, frame: { x, y, width: 1, height: 1 } })` gives RGBA at a point. Convert to hex, call `setBrushSettings({ color })` and `pushRecentColor`.

---

## P1 — UX / Engine Issues

### BUG-04 — Color section is shown when the Eraser tool is active

**File:** `src/components/canvas/canvas-properties-panel.tsx`

**Repro**
1. Select the Eraser tool

**Observed**
The full Color section (picker, hex input, 20-swatch grid, recent colors) renders above the "Eraser Size" slider. Color is meaningless for the eraser (`brush-system.ts` hardcodes `0x000000` for eraser stamps, and the erase blend should operate purely on alpha).

**Expected**
Hide Color (and Opacity) for the eraser — show only Size.

**Fix**
Wrap the Color `<section>` in `{!isEraser && ( … )}`, mirroring how the Opacity section is already gated on `!isEraser`.

---

### BUG-05 — Canvas does not resize when its container resizes

**File:** `src/lib/canvas/engine.ts`

**Repro (programmatic, verified via DevTools console)**
1. Inspect `canvas.width` → `2932`, `getBoundingClientRect().width` → `2624`
2. Shrink the parent container (e.g., expand file browser pane, or via `parent.style.maxWidth = '800px'`)
3. Canvas CSS width now `800`, but `canvas.width` still `2932`
4. Draw a stroke — it lands at wrong pixel coordinates relative to what the user sees

**Observed**
The PixiJS internal resolution stays frozen at its init-time size. Strokes are visibly squished/stretched, and pointer coordinates no longer align with rendered pixels. Dispatching a `window.resize` event does not repair it.

**Root cause**
`engine.init` sets `resizeTo: container`. In PixiJS v8, `resizeTo` listens for `window` resize, not container resize. The canvas editor's container changes size independently of the window whenever:
- the vault sidebar collapses/expands,
- the file browser pane is resized,
- a tab strip appears/disappears,
- the devtools panel docks/undocks.

There is no `ResizeObserver` on the host container.

**Fix**
Add a `ResizeObserver` in `engine.init` that calls `this.app.renderer.resize(w, h)`. Critically: disconnect it **synchronously** in `destroy()` *before* async teardown, mirroring the existing observer discipline documented in `CLAUDE.md` for the Pixi ticker.

Note: the layer `RenderTexture`s are still fixed at `DEFAULT_CANVAS_WIDTH × DEFAULT_CANVAS_HEIGHT` (2048×2048). That is fine — the *drawing surface* is logically decoupled from the *viewport canvas*. But the viewport renderer must match its host container.

---

### BUG-06 — Cursor never changes when the tool changes

**File:** `src/components/canvas/canvas-viewport.tsx`

**Repro**
1. Select Pan tool (hand icon or `H`)
2. Hover over the drawing area

**Observed**
Cursor is still `crosshair` (confirmed via `getComputedStyle`: `cursor: crosshair`). Expected `grab` per `getCursorForTool`.

**Root cause**
```tsx
style={{ cursor: getCursorForTool() }}
```
`getCursorForTool()` reads `useCanvasStore.getState().activeTool` — a non-reactive snapshot. Because `CanvasViewport` does not subscribe to `activeTool`, the component never re-renders when the tool switches, and the inline style is frozen at first-mount value.

**Fix**
```tsx
const activeTool = useCanvasStore((s) => s.activeTool)
// …
style={{ cursor: cursorForTool(activeTool) }}
```

Also: add a `cursor: not-allowed` state when the active layer is `locked`.

---

### BUG-07 — Soft brush at 100% opacity renders at ~50% visible alpha

**File:** `src/lib/canvas/brush-system.ts`

**Repro**
1. Default brush, opacity slider at 100%
2. Draw a stroke on a blank layer

**Observed**
Stroke looks translucent grey rather than the chosen color at full strength.

**Root cause**
`DEFAULT_BRUSH.hardness = 0.8` which is below the `>= 0.9` threshold, so the soft branch runs:
```ts
const a = alpha * (1 - (i - 1) / layers) * 0.5
```
Even with `alpha = 1` and `i = 1` (top layer), the baked-in `* 0.5` caps effective alpha at 50%. Combined with three overlapping circles of decreasing alpha, the result is a translucent wash instead of the requested opacity.

**Also note:** There is no hardness slider in the properties panel, so a user cannot set hardness to `0.9+` to get a solid stroke. Hardness exists in the type, engine, and store, but is not exposed in the UI.

**Fix**
- Add a Hardness slider to the properties panel next to Brush Size / Opacity.
- Reconsider the `* 0.5` magic number — for a real soft-brush look, use a radial-gradient falloff (GLSL shader or a pre-rendered circular mask texture) rather than 3 concentric fills.

---

### BUG-08 — Properties panel shows brush controls for Fill / Eyedropper tools

**File:** `src/components/canvas/canvas-properties-panel.tsx`

**Repro**
1. Select Fill or Eyedropper

**Observed**
"Brush Size" and "Opacity" sliders remain visible even though neither applies to those tools. Color applies to Fill (fill color) but not to Eyedropper (which samples it).

**Fix**
Gate sections by tool:

| Section        | Brush | Eraser | Pan | Fill | Eyedropper |
|----------------|:-----:|:------:|:---:|:----:|:----------:|
| Color          |  ✓   |   —    |  —  |  ✓  |     —      |
| Brush Size     |  ✓   |  (Eraser Size)  |  —  |  —  |  —  |
| Opacity        |  ✓   |   —    |  —  |  ✓  |     —      |

Hide sections with no controls when irrelevant to keep the panel honest.

---

### BUG-09 — Layer deletion has no confirmation

**File:** `src/components/canvas/canvas-properties-panel.tsx`

A single click on the trash icon permanently removes a layer with no confirmation dialog. The deletion is undoable via the engine's `UndoManager` only if it was wired up — currently it is not: `removeLayer` is called directly and no snapshot is pushed. This is a real data-loss path.

**Fix**
- Before `removeLayer`, snapshot the doomed layer and push an `UndoEntry` with a `restore` callback. (Your undo is snapshot-per-layer, so deletion needs a slightly different entry type — consider tagging entries with kind: `stroke | add-layer | remove-layer | reorder` and handling each on `undo`.)
- Alternatively, show a confirmation `AlertDialog` before deletion (less surgical but avoids undo complexity).

---

### BUG-10 — Layer drag-to-reorder is engine-ready but unreachable in the UI

**File:** `src/components/canvas/canvas-properties-panel.tsx`

`LayerManager.reorderLayers(ids)` and `rebuildDisplayOrder()` exist, but no UI surfaces them. Layer rows have no `draggable` attribute, no drag handle, no keyboard equivalent (e.g., `Ctrl+↑/↓`). CLAUDE.md / PRD implies reordering is supported.

**Fix**
Add a drag handle (`GripVertical` icon) per row and wire up pointer events to call `reorderLayers`. Snapshot the order in undo so users can revert a bad drop.

---

## P1 — Data & Memory

### BUG-11 — Unmount save races with engine destruction

**File:** `src/components/canvas/canvas-editor.tsx`

```ts
return () => {
  signal.cancelled = true
  const eng = engineRef.current
  if (eng?.initialized && useCanvasStore.getState().hasUnsavedChanges) {
    void flushSave(eng, vaultFs, pathRef.current)   // fire-and-forget
  }
  engine.destroy()                                   // synchronous — kills the renderer
  engineRef.current = null
  useCanvasStore.getState().reset()
}
```

`flushSave` calls `serializeCanvas(engine)`, which in turn calls `extractLayerBase64` for every layer. `extract.base64` touches the renderer; by the time the microtask runs, `engine.destroy()` has already called `app.destroy(true, { children: true })`. The first `extract` call will either throw or return `null` (the catch falls back to stale `lastSavedBase64`), so the "flush" silently persists the last-saved pixels — i.e., **your in-flight changes are lost on unmount when the autosave interval hasn't fired yet.**

**Fix**
`await` the save before destroying:
```ts
return () => {
  signal.cancelled = true
  const eng = engineRef.current
  const path = pathRef.current
  const run = async () => {
    if (eng?.initialized && useCanvasStore.getState().hasUnsavedChanges) {
      try { await flushSave(eng, vaultFs, path) } catch {}
    }
    eng?.destroy()
    engineRef.current = null
    useCanvasStore.getState().reset()
  }
  void run()
}
```
React doesn't wait for async cleanup, but the unmount is already racing with the next mount — the load path in CLAUDE.md already documents "new mount awaits pending save." Expose a `saveLockRef.current = run()` promise so the next mount can `await` it before reading from disk.

---

### BUG-12 — Undo stack memory footprint

**File:** `src/lib/canvas/undo-manager.ts` · `src/lib/canvas/constants.ts`

`MAX_UNDO_ENTRIES = 30`, each entry stores base64-encoded PNG snapshots of affected layers. For a 2048×2048 layer, a mostly-blank PNG base64 is ~50 KB but a dense one is 2–5 MB. A 30-entry stack of dense strokes on a busy session → 150 MB of detached strings held in JS memory, plus the decoded HTMLImageElements created during restore.

**Recommendation**
- Switch snapshots to raw `Uint8ClampedArray` (from `extract.pixels`) stored as compressed `Blob`s (`ImageBitmap` + `OffscreenCanvas.convertToBlob`) rather than base64.
- Consider a tile-based dirty-region snapshot (only the stamped bounding box) instead of full-layer snapshots. Most strokes touch <5% of the canvas.

---

### BUG-13 — On-disk `.canvas` JSON grows unboundedly with layer count × density

**File:** `src/lib/canvas/serializer.ts` (inferred — I did not read this file)

Each layer's `imageData` is an inline base64 PNG. Five dense layers at 2048×2048 ≈ 10–25 MB of inline JSON — which the user's Dropbox sync must upload on every save, and which `JSON.parse` must decode on every open.

**Recommendation**
Store layer PNGs as sibling files (`<basename>/<layerId>.png`) referenced by path in the JSON. This mirrors how Procreate/Photopea structure native files and plays well with sync (per-layer deltas, not per-document).

---

## P2 — Polish / Drift

### BUG-14 — Adding a layer after deleting a middle layer produces duplicate names

**File:** `src/lib/canvas/layer-manager.ts`

**Repro**
1. Add layers until you have `Layer 1, Layer 1 copy, Layer 3, Layer 4, Layer 5`
2. Delete `Layer 1`
3. Click "+"

**Observed**
Two rows named `Layer 5` appear.

**Root cause**
```ts
name: name ?? `Layer ${this.layers.length + 1}`
```
Uses current length (which regressed by one) instead of a monotonically increasing counter.

**Fix**
Track a `private _layerSeq = 0` incremented on every add. Never decremented.

---

### BUG-15 — Tool strip does not match product docs

**Files:** `src/components/canvas/canvas-tool-strip.tsx` · `docs/CLAUDE.md`

CLAUDE.md advertises the tool strip as: Select (V), Pencil (B), Pen (N), Marker (M), Eraser (E), Text (T), Fill (G). The actual tool strip has: Brush (B), Eraser (E), Pan (H), Fill (G), Eyedropper (I). No Select, no Pen, no Marker, no Text. No keyboard shortcut for Pan wired to `H` via hover (it works via press-and-hold `Alt` per the pointerdown handler, but the shortcut-table in `canvas-editor.tsx` does map `h` → `pan`).

**Recommendation**
Update CLAUDE.md and any onboarding/docs to match shipped reality, or gate the docs behind a "phase 2" flag until those tools exist.

---

### BUG-16 — Non-Pixi blend modes listed in UI

**File:** `src/lib/canvas/constants.ts`

`BLEND_MODES` includes `luminosity`, `color`, and `saturation`. These are HSL blend modes that, in PixiJS v8, rely on native `mix-blend-mode` and require a specific renderer path (`blendMode` set on a filter-backed container). Applied directly to a `Sprite.blendMode`, they may silently fall back to `normal` depending on the WebGL backend. I did not reproduce visually but the risk is user-visible "this blend mode does nothing."

**Recommendation**
Either verify each listed mode against the renderer and remove unsupported ones, or tag unsupported ones as "(experimental)" in the select.

---

### BUG-17 — `pushRecentColor` floods on color-picker drag

**File:** `src/components/canvas/canvas-properties-panel.tsx`

`<input type="color" onChange={…}>` fires during the user's drag inside the native picker on most browsers, not only on commit. Every intermediate hue is pushed via `pushRecentColor`. The dedupe in `pushRecentColor` makes the visible result merely "the most recent intermediate wins," but the store churns, Immer runs on every frame, and React re-renders the whole panel. Minor perf / UI jitter.

**Fix**
Use `onBlur` or a small debounce before pushing to recents. Alternatively, only push on the final `change` event (not `input`).

---

### BUG-18 — `onWheel` may be passive-wrapped

**File:** `src/components/canvas/canvas-viewport.tsx`

React attaches most wheel/touch events as passive by default (React 17+). `e.preventDefault()` inside `onWheel` can silently no-op, allowing the page to scroll when the user tries to zoom. I did not reproduce under this build; Next.js + Turbopack may have its own attach path.

**Fix (safe)**
Attach the wheel listener imperatively via `useEffect` + `addEventListener('wheel', h, { passive: false })` on the container ref.

---

## What Works Well

- Layer CRUD and opacity/visibility/blend-mode changes update the GPU correctly and persist through reload.
- Undo/redo for strokes works and correctly propagates `canUndo/canRedo` to the button states.
- Auto-save (3 s interval + `saveOnBlur: true`) writes a valid JSON and reloads cleanly — I reloaded mid-session and all five layers with their names, order, and content were restored.
- Keyboard shortcuts for tool switching (`B/E/H/G/I`) and brush size (`[` / `]`) work as documented.
- Pan via the Pan tool moves the viewport cleanly.
- Zustand + Immer store layout is clean; the engine-vs-store split is defended well (GPU state in engine, metadata in store).

---

## Suggested Fix Order

1. **BUG-01 Eraser** — the single most visible defect
2. **BUG-11 Unmount save race** — silent data loss
3. **BUG-05 Container resize** — breaks real usage as soon as user resizes panes
4. **BUG-04 + BUG-08 Properties panel gating** — small diff, big credibility improvement
5. **BUG-06 Cursor** — trivial fix, constant source of "is this working?"
6. **BUG-09 Layer delete confirmation / undo** — low-frequency high-impact data loss
7. Everything else at your leisure

---

## Files Read

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

Not read (inferred only): `src/lib/canvas/serializer.ts`, `src/lib/canvas/math.ts`.
