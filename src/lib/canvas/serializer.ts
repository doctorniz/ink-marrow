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
} from '@/lib/canvas/constants'

/* ------------------------------------------------------------------ */
/*  Serialize (engine → file metadata)                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the v4 `CanvasFile` metadata object from the live engine.
 *
 * v4 does NOT inline pixel data — every layer's `imageData` is `null`.
 * Pixel bytes are written separately as sibling PNGs by
 * `writeCanvasFile` in `canvas-file-io.ts`. This keeps `serializer.ts`
 * pure (no file system, no GPU extract) and makes it straightforward to
 * unit-test.
 *
 * The live engine holds the pixel data; the caller is responsible for
 * extracting blobs per layer alongside this metadata.
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

  return {
    version: CANVAS_VERSION,
    width: engine.width,
    height: engine.height,
    background: engine.background,
    viewport: engine.viewportController.state,
    layers,
    activeLayerId: lm.activeLayerId ?? layers[0]?.id ?? '',
  }
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
 *   - `version === 4` → read pixels from sidecar PNG files
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

    return { parsed: sanitizeV3OrV4(obj), sourceVersion: version }
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
 * Sanitize a v3 or v4 canvas file. The field shapes are identical — v4
 * simply never populates `imageData`. Keeping a single sanitizer avoids
 * a parallel code path for what is, structurally, the same JSON.
 */
function sanitizeV3OrV4(obj: Record<string, unknown>): CanvasFile {
  const viewport = sanitizeViewport(obj.viewport as Partial<ViewportState> | undefined)
  const rawLayers = Array.isArray(obj.layers) ? obj.layers : []

  const layers: CanvasLayerData[] = rawLayers.length > 0
    ? rawLayers.map((l: Record<string, unknown>, i: number) => sanitizeLayer(l, i))
    : [defaultLayer()]

  return {
    version: CANVAS_VERSION,
    width: typeof obj.width === 'number' && obj.width > 0 ? obj.width : DEFAULT_CANVAS_WIDTH,
    height: typeof obj.height === 'number' && obj.height > 0 ? obj.height : DEFAULT_CANVAS_HEIGHT,
    background: typeof obj.background === 'string' ? obj.background : DEFAULT_BACKGROUND,
    viewport,
    layers,
    activeLayerId: typeof obj.activeLayerId === 'string' ? obj.activeLayerId : layers[layers.length - 1]?.id ?? '',
  }
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
 * Directory that holds a canvas file's sidecar PNGs.
 *
 * For `path/to/Drawing.canvas` this returns `path/to/Drawing.canvas.assets`.
 * The directory is a sibling of the canvas file rather than living under
 * a shared `_assets` folder so that copying or moving the canvas within
 * the vault keeps its pixels adjacent. The `.assets` suffix is appended
 * *after* the extension rather than replacing it so the pairing is
 * obvious even without knowing the format.
 */
export function canvasAssetsDirFor(canvasPath: string): string {
  return `${canvasPath}.assets`
}

/** Path to a single layer's sidecar PNG within the assets directory. */
export function canvasLayerAssetPath(canvasPath: string, layerId: string): string {
  return `${canvasAssetsDirFor(canvasPath)}/${layerId}.png`
}
