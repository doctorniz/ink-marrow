import type { FileSystemAdapter } from '@/lib/fs/types'
import type { CanvasEngine } from '@/lib/canvas/engine'
import {
  canvasDrawingsDirFor,
  canvasDrawingsLayerPath,
  canvasLayerAssetPath,
  parseCanvasFile,
  serializeCanvasMetadata,
  serializeCanvasToJson,
  createEmptyCanvasFile,
} from '@/lib/canvas/serializer'

/* ------------------------------------------------------------------ */
/*  writeCanvasFile — v5 save: extract blobs → PNGs + metadata JSON    */
/* ------------------------------------------------------------------ */

/**
 * Persist a canvas engine's state to disk in the v5 drawings-folder
 * format.
 *
 *   - PNGs live under `_marrow/_drawings/<assetId>/<layerId>.png` —
 *     hidden from the vault tree and decoupled from the `.canvas` file's
 *     name. Renaming the `.canvas` never touches this folder.
 *   - JSON carries `assetId` so the link survives rename.
 *
 * Write order (intentional for crash-safety):
 *
 *   1. Ensure the engine has an `assetId`. Minted here on first save if
 *      absent (brand-new canvas, or migration from v3/v4).
 *   2. Extract every layer's pixels as a PNG Blob from the GPU. Done
 *      BEFORE any disk write so a mid-save crash can't leave the JSON
 *      pointing at half-written PNGs.
 *   3. `mkdir` the drawings sub-directory (idempotent — includes all
 *      parents, so `_marrow/_drawings/` is created if missing).
 *   4. Write each layer's PNG. A failed blob (GPU extract returned
 *      null) is skipped rather than deleting the prior PNG — leaving
 *      the last good bytes on disk is strictly better than overwriting
 *      them with nothing.
 *   5. Write the JSON metadata LAST. Any reader that sees a successful
 *      JSON save is guaranteed to see the PNGs it references.
 *
 * Orphan handling is deliberately out of scope:
 *   - Deleted layers leave their PNGs in the drawings folder.
 *   - v4 → v5 migration leaves the old `<canvasPath>.assets/` folder
 *     untouched on disk.
 *   Both are the same policy as `_marrow/snapshots/` PDF backups; a
 *   vault-wide cleanup pass can reap them later.
 */
export async function writeCanvasFile(
  engine: CanvasEngine,
  fs: FileSystemAdapter,
  canvasPath: string,
): Promise<void> {
  // Step 1: ensure we have a stable asset id. Mint on first save so the
  // id is already baked into the JSON + folder before any bytes land.
  if (!engine.assetId) {
    engine.setAssetId(crypto.randomUUID())
  }
  const assetId = engine.assetId!

  // Step 2: extract blobs up-front so crashes don't leave the JSON
  // pointing at PNGs we haven't written yet.
  const file = serializeCanvasMetadata(engine)
  const blobs = new Map<string, Blob>()
  for (const layer of file.layers) {
    const blob = await engine.layerManager.extractLayerBlob(layer.id)
    if (blob) blobs.set(layer.id, blob)
  }

  // Step 3: ensure the drawings sub-directory exists. `mkdir` creates
  // all intermediate segments, so this covers a brand-new vault that
  // has never had a `_marrow/_drawings/` folder before.
  await fs.mkdir(canvasDrawingsDirFor(assetId))

  // Step 4: write each layer's PNG bytes.
  for (const [layerId, blob] of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await fs.writeFile(canvasDrawingsLayerPath(assetId, layerId), bytes)
  }

  // Step 5: write the JSON metadata last.
  await fs.writeTextFile(canvasPath, serializeCanvasToJson(file))
}

/* ------------------------------------------------------------------ */
/*  readCanvasFile — load v3 / v4 / v5 canvas from disk into engine    */
/* ------------------------------------------------------------------ */

/**
 * Load a canvas file from disk into the engine.
 *
 * Version handling:
 *
 *   - v3 (or v2 after migration): layer pixels are base64-encoded inside
 *     the JSON. `loadLayers` decodes them inline. The JSON stays legible
 *     but can balloon; v3 files are rewritten as v5 on the next save.
 *
 *   - v4: pixel PNGs live in a sibling `<canvasPath>.assets/` folder,
 *     one file per `layerId`. Readable forever — rewritten as v5 on
 *     next save, which will mint an `assetId`, move the bytes into
 *     `_marrow/_drawings/<assetId>/`, and leave the old folder as a
 *     harmless orphan.
 *
 *   - v5: pixel PNGs live in `_marrow/_drawings/<assetId>/<layerId>.png`.
 *     The JSON carries `assetId` so the reader can find the folder
 *     regardless of how the `.canvas` file has been renamed.
 *
 * Missing / undecodable sidecars fail softly — the specific layer loads
 * blank rather than the whole canvas failing. Corrupted / partial-sync
 * vaults can therefore still be opened and recovered by a save. A
 * completely malformed JSON falls back to an empty canvas.
 */
export async function readCanvasFile(
  engine: CanvasEngine,
  fs: FileSystemAdapter,
  canvasPath: string,
): Promise<void> {
  const raw = await fs.readTextFile(canvasPath)
  const parsedResult = parseCanvasFile(raw)

  // Malformed JSON — fall back to an empty canvas rather than throwing.
  // The caller's catch would otherwise call `initDefault` and silently
  // lose the file's metadata. Here at least the background/viewport
  // come out as the format defaults, matching a fresh canvas.
  const { parsed, sourceVersion } = parsedResult ?? {
    parsed: createEmptyCanvasFile(),
    sourceVersion: 0,
  }

  engine.background = parsed.background
  engine.viewportController.setState(parsed.viewport)

  // Restore saved canvas dimensions (may differ from DEFAULT_CANVAS_WIDTH ×
  // DEFAULT_CANVAS_HEIGHT if the canvas was auto-expanded after first save).
  // Must happen before loadLayers so RenderTextures are created at the right size.
  engine.setDimensions(parsed.width, parsed.height)

  // v5 — drawings folder under `_marrow/_drawings/<assetId>/`.
  // If the JSON is v5 but somehow lacks a valid `assetId` (hand-edited,
  // truncated file), fall through to the "no bitmaps" path so layers
  // load blank; the writer will mint a fresh id on the next save.
  if (sourceVersion >= 5 && parsed.assetId) {
    engine.setAssetId(parsed.assetId)
    const bitmaps = await loadLayerBitmaps(fs, parsed.layers, (layerId) =>
      canvasDrawingsLayerPath(parsed.assetId!, layerId),
    )
    await engine.layerManager.loadLayers(parsed.layers, parsed.activeLayerId, bitmaps)
    return
  }

  // v4 — sibling `<canvasPath>.assets/<layerId>.png`.
  // Don't call `engine.setAssetId` here; we want the next save to mint
  // a fresh id and plant the folder under `_marrow/_drawings/`.
  if (sourceVersion === 4) {
    const bitmaps = await loadLayerBitmaps(fs, parsed.layers, (layerId) =>
      canvasLayerAssetPath(canvasPath, layerId),
    )
    await engine.layerManager.loadLayers(parsed.layers, parsed.activeLayerId, bitmaps)
    return
  }

  // v3 (or migrated v2) — base64 inline inside the layer records.
  await engine.layerManager.loadLayers(parsed.layers, parsed.activeLayerId)
}

/**
 * Try to decode each layer's PNG into an `ImageBitmap` using the caller-
 * supplied path resolver. Missing or corrupted files skip that layer
 * (loads blank) rather than throwing. `createImageBitmap` runs off the
 * main thread on browsers that support it — a noticeable win for dense
 * multi-layer canvases.
 */
async function loadLayerBitmaps(
  fs: FileSystemAdapter,
  layers: { id: string }[],
  pathFor: (layerId: string) => string,
): Promise<Map<string, ImageBitmap>> {
  const bitmaps = new Map<string, ImageBitmap>()
  for (const layer of layers) {
    try {
      const bytes = await fs.readFile(pathFor(layer.id))
      // Cast required because `fs.readFile` returns a Uint8Array with an
      // `ArrayBufferLike` backing buffer, which strict lib.dom rejects as
      // a `BlobPart` (its `ArrayBuffer | SharedArrayBuffer` union includes
      // SharedArrayBuffer). The bytes are always plain ArrayBuffer here.
      const bitmap = await createImageBitmap(
        new Blob([bytes as BlobPart], { type: 'image/png' }),
      )
      bitmaps.set(layer.id, bitmap)
    } catch {
      // Sidecar missing or undecodable — layer loads blank. Keep going
      // so a single bad file doesn't prevent the rest of the canvas
      // from opening.
    }
  }
  return bitmaps
}
