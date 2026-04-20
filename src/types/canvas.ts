/* ------------------------------------------------------------------ */
/*  Canvas file format v4 — PixiJS raster layer engine                 */
/* ------------------------------------------------------------------ */

/**
 * Canvas file format version.
 *
 *   v2 — legacy. Migrated via `migrateV2ToV3` on read; never written.
 *   v3 — single JSON file. Each layer inlines its pixel data as a base64
 *        PNG data URL in `CanvasLayerData.imageData`. Dense 5-layer
 *        documents could balloon to 10–25 MB of inline JSON — slow to
 *        parse, slow to sync, visible pain in Dropbox. Read-only now.
 *   v4 — sidecar-PNG-beside-file format. JSON holds metadata; pixel PNGs
 *        lived at `<canvasPath>.assets/<layerId>.png`. Clutters the
 *        vault with visible sidecar folders next to every `.canvas` and
 *        couples file-rename semantics to the pixel folder. Readable but
 *        no longer written.
 *   v5 — current. JSON holds metadata plus a stable `assetId` UUID; pixel
 *        PNGs live in a hidden per-canvas subdirectory under the vault's
 *        `_marrow/_drawings/<assetId>/`. The `assetId` is generated once
 *        on first save and never rotates, so renaming the `.canvas` file
 *        leaves its pixel folder untouched — the id travels with the JSON,
 *        not the filename. `CanvasLayerData.imageData` is always `null`.
 *
 * v3 and v4 files remain readable; both get rewritten as v5 on the next
 * save. v4 → v5 migration leaves the old `.assets/` folder on disk as
 * dead weight — same orphan policy as deleted-layer PNGs.
 */
export const CANVAS_VERSION = 5

/** Persisted viewport state (pan + zoom). */
export interface ViewportState {
  x: number
  y: number
  zoom: number // 0.1 – 10
}

/** Per-layer data stored in the canvas JSON file. */
export interface CanvasLayerData {
  id: string
  name: string
  visible: boolean
  opacity: number // 0–1
  locked: boolean
  blendMode: string // PixiJS blend mode name
  /**
   * v3-only: base64 PNG data URL of the rendered layer pixels, or null
   * if empty. v4/v5 files write `null` here — pixel data lives in a
   * sidecar PNG file on disk (path differs by version; see `CanvasFile`).
   * The field is retained to keep v3 files readable without a separate
   * schema.
   */
  imageData: string | null
}

/** Layer metadata exposed to the Zustand store / React UI. */
export interface CanvasLayerMeta {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: string
}

/** The on-disk .canvas JSON file. */
export interface CanvasFile {
  version: number
  width: number
  height: number
  background: string // hex color
  viewport: ViewportState
  layers: CanvasLayerData[]
  activeLayerId: string
  /**
   * Stable identifier for this canvas's sidecar folder under
   * `_marrow/_drawings/<assetId>/`. Generated on first v5 save and never
   * rotated — rename of the `.canvas` file does not move or rename the
   * pixel folder. Missing on v3 / v4 files; the writer will mint one.
   */
  assetId?: string
}

/* ------------------------------------------------------------------ */
/*  Tool & brush types                                                 */
/* ------------------------------------------------------------------ */

export type CanvasTool = 'brush' | 'eraser' | 'pan' | 'eyedropper' | 'fill'

export interface BrushSettings {
  size: number // 1–200
  opacity: number // 0–1
  hardness: number // 0–1
  spacing: number // 0.05–1.0 (fraction of brush diameter)
  color: string // hex
}

/** A single point in a stroke, captured from PointerEvent. */
export interface StrokePoint {
  x: number
  y: number
  pressure: number // 0–1
  tiltX: number
  tiltY: number
  timestamp: number
}

/* ------------------------------------------------------------------ */
/*  Undo                                                               */
/* ------------------------------------------------------------------ */

/**
 * Per-layer pixel snapshot used by the stroke undo path.
 *
 * Stored as a PNG `Blob` rather than a base64 string:
 *
 *   - Blobs live in the browser's off-heap blob storage, not the JS heap,
 *     and are disk-backable under memory pressure. A 30-entry stack of
 *     dense strokes that would previously balloon the JS heap by >100 MB
 *     now pressures the JS heap only by the blob *handles* (a few bytes
 *     each) while the PNG bytes sit in blob storage.
 *   - PNG bytes are ~25% smaller than their base64 encoding (4 bytes per
 *     3 bytes of payload).
 *   - Restoration via `createImageBitmap(blob)` is faster than the
 *     `HTMLImageElement + data URL` path and decodes off the main thread
 *     on browsers that support it.
 *
 * Disk format (`CanvasLayerData.imageData`) stays base64 — see BUG-13 for
 * the plan to replace that with sibling PNG files.
 */
export interface LayerSnapshot {
  layerId: string
  blob: Blob
}

/**
 * Undo entries are a discriminated union keyed by `kind`:
 *
 *   - `stroke`          → snapshot-replace a set of layers' pixels.
 *   - `remove-layer`    → re-create a layer that was deleted, at its
 *                         original stack position, with its full metadata
 *                         and last-known pixel data.
 *   - `reorder-layers`  → replace the layer stack order. Stores just the
 *                         before/after id arrays — pixel data is untouched,
 *                         so these entries are tiny (~N strings each).
 *
 * New kinds (add-layer, etc.) should follow the same pattern rather than
 * overloading `stroke`, so each undo path stays narrow and type-checked.
 */
export type UndoEntry =
  | StrokeUndoEntry
  | RemoveLayerUndoEntry
  | ReorderLayersUndoEntry

export interface StrokeUndoEntry {
  kind: 'stroke'
  description: string
  snapshots: LayerSnapshot[]
}

export interface RemoveLayerUndoEntry {
  kind: 'remove-layer'
  description: string
  /** Full layer record captured at delete time — enough to recreate it. */
  layerData: CanvasLayerData
  /** 0-based index in the layer stack where this layer lived. */
  index: number
  /** Whether this layer was active when it was removed. */
  wasActive: boolean
}

export interface ReorderLayersUndoEntry {
  kind: 'reorder-layers'
  description: string
  /** Stack order (bottom → top) before the reorder. */
  before: string[]
  /** Stack order (bottom → top) after the reorder. */
  after: string[]
}
