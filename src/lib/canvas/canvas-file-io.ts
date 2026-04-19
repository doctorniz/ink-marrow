import type { FileSystemAdapter } from '@/lib/fs/types'
import type { CanvasEngine } from '@/lib/canvas/engine'
import {
  canvasAssetsDirFor,
  canvasLayerAssetPath,
  parseCanvasFile,
  serializeCanvasMetadata,
  serializeCanvasToJson,
  createEmptyCanvasFile,
} from '@/lib/canvas/serializer'

/* ------------------------------------------------------------------ */
/*  writeCanvasFile — v4 save: extract blobs → PNGs + metadata JSON    */
/* ------------------------------------------------------------------ */

/**
 * Persist a canvas engine's state to disk in the v4 sidecar-PNG format.
 *
 * Write order (intentional for crash-safety):
 *
 *   1. Extract every layer's pixels as a PNG Blob from the GPU. This is
 *      done BEFORE any disk write so a mid-save crash can't leave the
 *      JSON pointing at half-written PNGs.
 *   2. `mkdir` the sidecar directory (idempotent — noop if it already
 *      exists).
 *   3. Write each layer's PNG. A failed blob (GPU extract returned null)
 *      is skipped rather than deleting the prior PNG — leaving the last
 *      good bytes on disk is strictly better than overwriting them with
 *      nothing.
 *   4. Write the JSON metadata LAST. Any reader that sees a successful
 *      JSON save is guaranteed to see the PNGs it references.
 *
 * Orphan handling is deliberately out of scope: if a layer is deleted,
 * its PNG remains on disk as dead weight. Same policy as the PDF
 * snapshots folder. A vault-wide cleanup pass can reap orphans later.
 */
export async function writeCanvasFile(
  engine: CanvasEngine,
  fs: FileSystemAdapter,
  canvasPath: string,
): Promise<void> {
  // Step 1: extract blobs up-front so crashes don't leave the JSON
  // pointing at PNGs we haven't written yet.
  const file = serializeCanvasMetadata(engine)
  const blobs = new Map<string, Blob>()
  for (const layer of file.layers) {
    const blob = await engine.layerManager.extractLayerBlob(layer.id)
    if (blob) blobs.set(layer.id, blob)
  }

  // Step 2: ensure the assets directory exists.
  await fs.mkdir(canvasAssetsDirFor(canvasPath))

  // Step 3: write each layer's PNG bytes.
  for (const [layerId, blob] of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await fs.writeFile(canvasLayerAssetPath(canvasPath, layerId), bytes)
  }

  // Step 4: write the JSON metadata last.
  await fs.writeTextFile(canvasPath, serializeCanvasToJson(file))
}

/* ------------------------------------------------------------------ */
/*  readCanvasFile — load v3 or v4 canvas from disk into engine        */
/* ------------------------------------------------------------------ */

/**
 * Load a canvas file from disk into the engine.
 *
 * Version handling:
 *
 *   - v3 (or earlier, after migration): layer pixels are base64-encoded
 *     inside the JSON. `loadLayers` decodes them inline and no sidecar
 *     reads are attempted. v3 files are readable forever; they get
 *     rewritten as v4 on the next save.
 *
 *   - v4: layer pixels live in sidecar PNGs at
 *     `<canvasPath>.assets/<layerId>.png`. We fetch each PNG, decode
 *     via `createImageBitmap` (off-main-thread where supported), and
 *     pass the bitmap map to `loadLayers`. Missing sidecars (corrupted
 *     vault, partial sync) fail softly: the layer loads blank rather
 *     than the whole canvas failing.
 *
 * A completely malformed JSON file falls back to an empty canvas rather
 * than throwing — matches the old deserializer's behaviour and keeps
 * accidental file corruption recoverable (the next save overwrites with
 * valid data).
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

  if (sourceVersion >= 4) {
    // v4 path: read sidecar PNGs, decode to ImageBitmap, hand to loadLayers.
    const bitmaps = new Map<string, ImageBitmap>()
    for (const layer of parsed.layers) {
      try {
        const bytes = await fs.readFile(canvasLayerAssetPath(canvasPath, layer.id))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        bitmaps.set(layer.id, bitmap)
      } catch {
        // Sidecar missing or undecodable — layer loads blank. Keep going
        // so a single bad file doesn't prevent the rest of the canvas
        // from opening.
      }
    }
    await engine.layerManager.loadLayers(parsed.layers, parsed.activeLayerId, bitmaps)
    return
  }

  // v3 (or migrated v2) path: base64 inline inside the layer records.
  await engine.layerManager.loadLayers(parsed.layers, parsed.activeLayerId)
}
