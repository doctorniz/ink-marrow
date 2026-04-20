import type { CanvasFile, CanvasLayerData, ViewportState } from '@/types/canvas'
import { CANVAS_VERSION } from '@/types/canvas'
import type { CanvasEngine } from '@/lib/canvas/engine'
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_BACKGROUND,
  DEFAULT_VIEWPORT,
  MIN_ZOOM,
  MAX_ZOOM,
  CANVAS_DRAWINGS_DIR,
} from '@/lib/canvas/constants'

/* ------------------------------------------------------------------ */
/*  Serialize (engine → file metadata)                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the v5 `CanvasFile` metadata object from the live engine.
 *
 * v5 does NOT inline pixel data — every layer's `imageData` is `null`.
 * Pixel bytes are written separately as PNGs under
 * `_marrow/_drawings/<assetId>/` by `writeCanvasFile` in
 * `canvas-file-io.ts`. This keeps `serializer.ts` pure (no file system,
 * no GPU extract) and makes it straightforward to unit-test.
 *
 * The live engine holds the pixel data; the caller is responsible for
 * extracting blobs per layer alongside this metadata.
 *
 * `assetId` is read from the engine. If the engine has not been assigned
 * one yet (e.g. brand new canvas, or a v3/v4 file that has not been
 * re-saved yet), the field is left undefined here and the writer will
 * mint one before writing PNGs.
 */
export function serializeCanvasMetadata(engine: CanvasEngine): CanvasFile {
  const lm = engine.layerManager
  const layers: CanvasLayerData[] = lm.getAllLayers().map((layer) => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    locked: layer.locked,
    blendMode: layer.blendMode,
    imageData: null,
  }))

  const file: CanvasFile = {
    version: CANVAS_VERSION,
    width: engine.width,
    height: engine.height,
    background: engine.background,
    viewport: engine.viewportController.state,
    layers,
    activeLayerId: lm.activeLayerId ?? layers[0]?.id ?? '',
  }
  if (engine.assetId) file.assetId = engine.assetId
  return file
}

export function serializeCanvasToJson(file: CanvasFile): string {
  return JSON.stringify(file, null, 2)
}

/* ------------------------------------------------------------------ */
/*  Parse + migrate                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse result. Callers need the resolved `CanvasFile` plus the *source*
 * version so they can decide how to load pixel data:
 *
 *   - `version <= 3` → read pixels from inline `imageData` (base64)
 *   - `version === 4` → read pixels from `<canvasPath>.assets/<id>.png`
 *   - `version >= 5` → read pixels from `_marrow/_drawings/<assetId>/<id>.png`
 *
 * `parsed.version` is always the current `CANVAS_VERSION` (post-migration
 * structure), so callers must branch on `sourceVersion`, not `parsed`.
 */
export interface ParsedCanvasFile {
  parsed: CanvasFile
  sourceVersion: number
}

export function parseCanvasFile(raw: string): ParsedCanvasFile | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (!obj || typeof obj !== 'object') return null

    const version = typeof obj.version === 'number' ? obj.version : 2

    if (version <= 2) {
      return { parsed: migrateV2ToV3(obj), sourceVersion: 2 }
    }

    return { parsed: sanitizeModernCanvas(obj), sourceVersion: version }
  } catch {
    return null
  }
}

function migrateV2ToV3(obj: Record<string, unknown>): CanvasFile {
  const viewport = sanitizeViewport(obj.viewport as Partial<ViewportState> | undefined)
  const rawLayers = Array.isArray(obj.layers) ? obj.layers : []

  const layers: CanvasLayerData[] = rawLayers.length > 0
    ? rawLayers.map((l: Record<string, unknown>, i: number) => sanitizeLayer(l, i))
    : [defaultLayer()]

  return {
    version: CANVAS_VERSION,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    background: DEFAULT_BACKGROUND,
    viewport,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? '',
  }
}

/**
 * Sanitize a v3, v4, or v5 canvas file. The field shapes are largely
 * identical — v4/v5 never populate `imageData`, and v5 additionally
 * carries an `assetId` UUID pointing at the pixel folder under
 * `_marrow/_drawings/`. Keeping a single sanitizer avoids a parallel
 * code path for what is, structurally, the same JSON.
 *
 * An unrecognised `assetId` shape is simply dropped — the writer will
 * mint a fresh one on next save, producing a brand-new folder. The old
 * pixel folder (if any) becomes an orphan, which is the same outcome as
 * any other mid-vault corruption and is preferable to accepting a
 * malformed id that could escape the `_drawings/` root.
 */
function sanitizeModernCanvas(obj: Record<string, unknown>): CanvasFile {
  const viewport = sanitizeViewport(obj.viewport as Partial<ViewportState> | undefined)
  const rawLayers = Array.isArray(obj.layers) ? obj.layers : []

  const layers: CanvasLayerData[] = rawLayers.length > 0
    ? rawLayers.map((l: Record<string, unknown>, i: number) => sanitizeLayer(l, i))
    : [defaultLayer()]

  const file: CanvasFile = {
    version: CANVAS_VERSION,
    width: typeof obj.width === 'number' && obj.width > 0 ? obj.width : DEFAULT_CANVAS_WIDTH,
    height: typeof obj.height === 'number' && obj.height > 0 ? obj.height : DEFAULT_CANVAS_HEIGHT,
    background: typeof obj.background === 'string' ? obj.background : DEFAULT_BACKGROUND,
    viewport,
    layers,
    activeLayerId: typeof obj.activeLayerId === 'string' ? obj.activeLayerId : layers[layers.length - 1]?.id ?? '',
  }
  if (isValidAssetId(obj.assetId)) file.assetId = obj.assetId
  return file
}

/**
 * Accept only UUID-shaped asset ids. The id is used to construct a path
 * under `_marrow/_drawings/<id>/`, so rejecting anything that could
 * contain `/`, `..`, or null bytes is a cheap directory-traversal
 * defence. UUIDs produced by `crypto.randomUUID()` are always 36
 * hex-and-hyphen characters, so this regex is both sufficient and
 * tight.
 */
function isValidAssetId(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
}

function sanitizeLayer(
  l: Record<string, unknown>,
  i: number,
): CanvasLayerData {
  return {
    id: (typeof l.id === 'string' ? l.id : null) ?? crypto.randomUUID(),
    name: (typeof l.name === 'string' ? l.name : null) ?? `Layer ${i + 1}`,
    visible: typeof l.visible === 'boolean' ? l.visible : true,
    opacity: typeof l.opacity === 'number' ? l.opacity : 1,
    locked: typeof l.locked === 'boolean' ? l.locked : false,
    blendMode: typeof l.blendMode === 'string' ? l.blendMode : 'normal',
    imageData: typeof l.imageData === 'string' ? l.imageData : null,
  }
}

function sanitizeViewport(v: Partial<ViewportState> | undefined): ViewportState {
  const x = typeof v?.x === 'number' && Number.isFinite(v.x) ? v.x : 0
  const y = typeof v?.y === 'number' && Number.isFinite(v.y) ? v.y : 0
  let zoom = 1
  if (typeof v?.zoom === 'number' && Number.isFinite(v.zoom) && v.zoom > 0) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom))
  }
  return { x, y, zoom }
}

function defaultLayer(): CanvasLayerData {
  return {
    id: crypto.randomUUID(),
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal',
    imageData: null,
  }
}

/* ------------------------------------------------------------------ */
/*  Create empty canvas file (for new file creation)                   */
/* ------------------------------------------------------------------ */

export function createEmptyCanvasFile(): CanvasFile {
  return {
    version: CANVAS_VERSION,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    background: DEFAULT_BACKGROUND,
    viewport: { ...DEFAULT_VIEWPORT },
    layers: [defaultLayer()],
    activeLayerId: '',
  }
}

export function createEmptyCanvasJson(): string {
  const file = createEmptyCanvasFile()
  file.activeLayerId = file.layers[0].id
  return JSON.stringify(file, null, 2)
}

/* ------------------------------------------------------------------ */
/*  Sidecar path helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * v5 — pixel folder for a canvas, keyed by stable `assetId` and living
 * under the vault's `_marrow/_drawings/` root. Rename of the `.canvas`
 * file does *not* rename this folder: the id travels with the JSON.
 *
 *   assetId "a1b2c3d4-…"   →   "_marrow/_drawings/a1b2c3d4-…"
 */
export function canvasDrawingsDirFor(assetId: string): string {
  return `${CANVAS_DRAWINGS_DIR}/${assetId}`
}

/** v5 — path to a single layer's PNG inside its canvas's drawings folder. */
export function canvasDrawingsLayerPath(assetId: string, layerId: string): string {
  return `${canvasDrawingsDirFor(assetId)}/${layerId}.png`
}

/**
 * v4 legacy — directory that held a canvas file's sidecar PNGs as a
 * sibling of the `.canvas` file (e.g. `path/to/Drawing.canvas.assets`).
 * Kept so the v4 read path in `canvas-file-io.ts` still works while
 * old vaults migrate; never used for writing now.
 */
export function canvasAssetsDirFor(canvasPath: string): string {
  return `${canvasPath}.assets`
}

/** v4 legacy — path to a single layer's sibling-sidecar PNG. */
export function canvasLayerAssetPath(canvasPath: string, layerId: string): string {
  return `${canvasAssetsDirFor(canvasPath)}/${layerId}.png`
}
