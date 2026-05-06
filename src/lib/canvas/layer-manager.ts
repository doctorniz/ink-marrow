import {
  Container,
  Sprite,
  RenderTexture,
  Graphics,
  Texture,
  type Application,
} from 'pixi.js'
import type { CanvasLayerData, CanvasLayerMeta } from '@/types/canvas'
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  MAX_LAYERS,
} from '@/lib/canvas/constants'
import { floodFill } from '@/lib/canvas/flood-fill'

/* ------------------------------------------------------------------ */
/*  Runtime layer: GPU resources for one layer                         */
/* ------------------------------------------------------------------ */

export interface LayerRuntime {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  blendMode: string
  container: Container
  sprite: Sprite
  renderTexture: RenderTexture
  /** Last saved imageData — fallback when GPU extract fails. */
  lastSavedBase64: string | null
}

/* ------------------------------------------------------------------ */
/*  LayerManager                                                       */
/* ------------------------------------------------------------------ */

export class LayerManager {
  private app: Application
  private viewport: Container
  private layers: LayerRuntime[] = []
  private _activeLayerId: string | null = null

  /**
   * Monotonically-increasing counter used to name auto-generated layers
   * (`Layer 1`, `Layer 2`, …).
   *
   * Previously `addLayer` named new layers as `Layer ${this.layers.length + 1}`
   * which regressed after a deletion and produced duplicates:
   * layers `[Layer 1 copy, Layer 3, Layer 4, Layer 5]` (length 4) plus `+`
   * → another `Layer 5`. The fix is a counter that is only ever advanced,
   * never reset by array length.
   *
   * The counter is also bumped on `loadLayers` and `insertLayerFromData`
   * so it never collides with names that already exist in the stack —
   * important for undoing a layer deletion without fabricating a duplicate
   * name the next time the user clicks `+`.
   */
  private _layerSeq = 0

  /** Scratchpad: temporary RenderTexture for live stroke preview. */
  private scratchpadContainer: Container
  private scratchpadSprite: Sprite
  private scratchpadRT: RenderTexture

  private _canvasWidth: number
  private _canvasHeight: number

  get canvasWidth(): number { return this._canvasWidth }
  get canvasHeight(): number { return this._canvasHeight }

  /**
   * Update the stored canvas dimensions without resizing any existing
   * RenderTextures. Call this before `loadLayers` when loading a file
   * whose saved dimensions differ from the defaults (e.g. an auto-expanded
   * canvas saved at 3072 × 4096).
   */
  setCanvasDimensions(w: number, h: number): void {
    this._canvasWidth = Math.max(1, w)
    this._canvasHeight = Math.max(1, h)
  }

  constructor(
    app: Application,
    viewport: Container,
    width = DEFAULT_CANVAS_WIDTH,
    height = DEFAULT_CANVAS_HEIGHT,
  ) {
    this.app = app
    this.viewport = viewport
    this._canvasWidth = width
    this._canvasHeight = height

    // Create scratchpad
    this.scratchpadRT = RenderTexture.create({
      width: this._canvasWidth,
      height: this._canvasHeight,
    })
    this.scratchpadSprite = new Sprite(this.scratchpadRT)
    this.scratchpadContainer = new Container()
    this.scratchpadContainer.label = 'scratchpad'
    this.scratchpadContainer.addChild(this.scratchpadSprite)
    this.viewport.addChild(this.scratchpadContainer)
  }

  /* ---- Accessors ---- */

  get activeLayerId(): string | null {
    return this._activeLayerId
  }

  getActiveLayer(): LayerRuntime | null {
    return this.layers.find((l) => l.id === this._activeLayerId) ?? null
  }

  getLayer(id: string): LayerRuntime | null {
    return this.layers.find((l) => l.id === id) ?? null
  }

  getAllLayers(): readonly LayerRuntime[] {
    return this.layers
  }

  getLayerMeta(): CanvasLayerMeta[] {
    return this.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      blendMode: l.blendMode,
    }))
  }

  getScratchpadRT(): RenderTexture {
    return this.scratchpadRT
  }

  getScratchpadContainer(): Container {
    return this.scratchpadContainer
  }

  /* ---- Layer CRUD ---- */

  setActiveLayer(id: string): void {
    if (this.layers.some((l) => l.id === id)) {
      this._activeLayerId = id
      this.reorderScratchpad()
    }
  }

  addLayer(name?: string): string {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Maximum ${MAX_LAYERS} layers`)
    }

    const id = crypto.randomUUID()
    const rt = RenderTexture.create({
      width: this._canvasWidth,
      height: this._canvasHeight,
    })
    const sprite = new Sprite(rt)
    const container = new Container()
    container.label = `layer-${id}`
    container.addChild(sprite)
    this.viewport.addChild(container)

    // Default-named layers go through the monotonic counter. An explicit
    // name from the caller (e.g. `duplicateLayer`'s "… copy") wins — but
    // if it happens to match the `Layer N` pattern we advance the counter
    // past it so a later default-named add won't collide.
    let layerName: string
    if (name !== undefined) {
      layerName = name
      const n = extractLayerSuffix(name)
      if (n !== null && n > this._layerSeq) this._layerSeq = n
    } else {
      this._layerSeq += 1
      layerName = `Layer ${this._layerSeq}`
    }

    const layer: LayerRuntime = {
      id,
      name: layerName,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'normal',
      container,
      sprite,
      renderTexture: rt,
      lastSavedBase64: null,
    }

    this.layers.push(layer)
    this._activeLayerId = id
    this.syncVisuals()
    this.reorderScratchpad()
    return id
  }

  removeLayer(id: string): void {
    if (this.layers.length <= 1) return
    const idx = this.layers.findIndex((l) => l.id === id)
    if (idx === -1) return

    const layer = this.layers[idx]
    this.viewport.removeChild(layer.container)
    layer.renderTexture.destroy(true)
    layer.sprite.destroy()
    layer.container.destroy()
    this.layers.splice(idx, 1)

    if (this._activeLayerId === id) {
      this._activeLayerId = this.layers[Math.min(idx, this.layers.length - 1)]?.id ?? null
    }
    this.reorderScratchpad()
  }

  duplicateLayer(id: string): string | null {
    const src = this.layers.find((l) => l.id === id)
    if (!src || this.layers.length >= MAX_LAYERS) return null

    const newId = this.addLayer(`${src.name} copy`)
    const dest = this.getLayer(newId)
    if (!dest) return null

    // Copy pixels from source to destination
    const copySprite = new Sprite(src.renderTexture)
    this.app.renderer.render({
      container: copySprite,
      target: dest.renderTexture,
      clear: true,
    })
    copySprite.destroy()

    dest.opacity = src.opacity
    dest.blendMode = src.blendMode
    dest.visible = src.visible
    this.syncVisuals()
    return newId
  }

  renameLayer(id: string, name: string): void {
    const l = this.getLayer(id)
    if (!l) return
    l.name = name
    // If the user renames a layer to something like `Layer 99` we still
    // want the monotonic counter to stay strictly ahead, so a later `+`
    // doesn't fabricate a duplicate of the just-renamed layer.
    const n = extractLayerSuffix(name)
    if (n !== null && n > this._layerSeq) this._layerSeq = n
  }

  /**
   * Capture a layer's full on-disk representation (metadata + pixels)
   * so it can be recreated later — used by the undo system for layer
   * deletion.
   *
   * Pixel extraction is asynchronous; if the GPU extract fails we fall
   * back to `lastSavedBase64` (same policy as `extractLayerBase64`) so
   * we still have something to restore. If both are null the layer
   * comes back blank, which is still strictly better than losing the
   * metadata and stack position.
   */
  async captureLayerData(id: string): Promise<CanvasLayerData | null> {
    const layer = this.getLayer(id)
    if (!layer) return null
    const imageData = await this.extractLayerBase64(id)
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      locked: layer.locked,
      blendMode: layer.blendMode,
      imageData: imageData ?? layer.lastSavedBase64 ?? null,
    }
  }

  /**
   * Insert a layer from persisted data at a specific stack index.
   * Mirrors the per-layer construction path in `loadLayers` but operates
   * on a single layer and lets the caller pick its position. Used to
   * undo a layer deletion.
   *
   * If `index` is out of range it is clamped to the end of the stack.
   * If a layer with the same id already exists (shouldn't happen under
   * normal undo flow, but worth guarding against) the call is a no-op
   * to avoid duplicate ids in the store/viewport.
   */
  async insertLayerFromData(data: CanvasLayerData, index: number): Promise<void> {
    if (this.layers.some((l) => l.id === data.id)) return
    if (this.layers.length >= MAX_LAYERS) return

    // Preserve the monotonic-seq invariant: if the restored layer's name
    // matches `Layer N`, make sure the counter is at least N so a later
    // default-named add won't produce a duplicate.
    const restoredN = extractLayerSuffix(data.name)
    if (restoredN !== null && restoredN > this._layerSeq) {
      this._layerSeq = restoredN
    }

    const rt = RenderTexture.create({
      width: this._canvasWidth,
      height: this._canvasHeight,
    })
    const sprite = new Sprite(rt)
    const container = new Container()
    container.label = `layer-${data.id}`
    container.addChild(sprite)

    const layer: LayerRuntime = {
      id: data.id,
      name: data.name,
      visible: data.visible,
      opacity: data.opacity,
      locked: data.locked,
      blendMode: data.blendMode,
      container,
      sprite,
      renderTexture: rt,
      lastSavedBase64: data.imageData,
    }

    if (data.imageData && data.imageData.length > 64) {
      try {
        const img = new Image()
        img.src = data.imageData
        await img.decode()
        const tex = Texture.from({ resource: img, label: `restore-${data.id}` })
        const s = new Sprite(tex)
        this.app.renderer.render({ container: s, target: rt, clear: true })
        s.destroy()
        tex.destroy()
      } catch {
        // Decode failed — layer comes back blank. Still preferable to
        // silently dropping the layer entirely.
      }
    }

    // Insert at the requested position (clamped) and rebuild the Pixi
    // display order so draw order matches the array.
    const clamped = Math.max(0, Math.min(index, this.layers.length))
    this.layers.splice(clamped, 0, layer)
    this.rebuildDisplayOrder()
    this.syncVisuals()
  }

  reorderLayers(ids: string[]): void {
    const map = new Map(this.layers.map((l) => [l.id, l]))
    const reordered = ids.map((id) => map.get(id)).filter(Boolean) as LayerRuntime[]
    if (reordered.length !== this.layers.length) return
    this.layers = reordered
    this.rebuildDisplayOrder()
  }

  /* ---- Layer properties ---- */

  setLayerVisibility(id: string, visible: boolean): void {
    const l = this.getLayer(id)
    if (l) {
      l.visible = visible
      l.container.visible = visible
    }
  }

  setLayerOpacity(id: string, opacity: number): void {
    const l = this.getLayer(id)
    if (l) {
      l.opacity = Math.max(0, Math.min(1, opacity))
      l.container.alpha = l.opacity
    }
  }

  setLayerLocked(id: string, locked: boolean): void {
    const l = this.getLayer(id)
    if (l) l.locked = locked
  }

  setLayerBlendMode(id: string, mode: string): void {
    const l = this.getLayer(id)
    if (l) {
      l.blendMode = mode
      l.sprite.blendMode = mode as Sprite['blendMode']
    }
  }

  /* ---- Scratchpad ---- */

  /**
   * Commit scratchpad content into the active layer with normal blend.
   *
   * Only called for additive (non-eraser) strokes. Eraser strokes render
   * directly into the active layer with `blendMode='erase'` and never
   * touch the scratchpad — see StrokeEngine for the rationale.
   *
   * The `isEraser` parameter is kept for signature stability but is
   * expected to be false; if true, it is treated as false and a warning
   * is logged in dev.
   */
  commitScratchpad(isEraser = false): void {
    const active = this.getActiveLayer()
    if (!active) return

    if (isEraser && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[LayerManager] commitScratchpad called with isEraser=true. ' +
          'Eraser strokes should render directly into the active layer, ' +
          'not through the scratchpad. This call will be treated as normal.',
      )
    }

    this.scratchpadSprite.blendMode = 'normal'

    this.app.renderer.render({
      container: this.scratchpadSprite,
      target: active.renderTexture,
      clear: false,
    })

    this.clearScratchpad()
  }

  clearScratchpad(): void {
    // Render an empty container to clear the texture
    const empty = new Container()
    this.app.renderer.render({
      container: empty,
      target: this.scratchpadRT,
      clear: true,
    })
    empty.destroy()
  }

  /* ---- Canvas expansion ---- */

  /**
   * Expand all layer RenderTextures and the scratchpad to `newWidth ×
   * newHeight`. Existing pixel data is preserved — it is copied into the
   * top-left of each new, larger texture. Any area to the right of or
   * below the old bounds starts transparent.
   *
   * This is called by `CanvasEngine.expandToFit` when a stroke point
   * lands outside the current canvas bounds. It is safe to call
   * mid-stroke: the scratchpad's partial stroke data is preserved and
   * subsequent stamps will land at the correct (expanded) coordinates.
   *
   * Dimensions are only ever grown — passing values smaller than the
   * current size is a no-op.
   */
  expandCanvas(newWidth: number, newHeight: number): void {
    const targetW = Math.max(newWidth, this._canvasWidth)
    const targetH = Math.max(newHeight, this._canvasHeight)
    if (targetW === this._canvasWidth && targetH === this._canvasHeight) return

    // Expand each layer RT and copy old pixels into the top-left corner.
    for (const layer of this.layers) {
      const newRT = RenderTexture.create({ width: targetW, height: targetH })
      const copySprite = new Sprite(layer.renderTexture)
      this.app.renderer.render({ container: copySprite, target: newRT, clear: false })
      copySprite.destroy()
      layer.sprite.texture = newRT
      layer.renderTexture.destroy(true)
      layer.renderTexture = newRT
      // Invalidate the base64 cache — it reflects the old (smaller) pixels.
      layer.lastSavedBase64 = null
    }

    // Expand the scratchpad RT too, preserving any in-progress stroke data.
    const newScratchRT = RenderTexture.create({ width: targetW, height: targetH })
    const scratchCopy = new Sprite(this.scratchpadRT)
    this.app.renderer.render({ container: scratchCopy, target: newScratchRT, clear: false })
    scratchCopy.destroy()
    this.scratchpadSprite.texture = newScratchRT
    this.scratchpadRT.destroy(true)
    this.scratchpadRT = newScratchRT

    this._canvasWidth = targetW
    this._canvasHeight = targetH
  }

  /* ---- Flood fill ---- */

  /**
   * Flood-fill the contiguous region under `(x, y)` on a layer with
   * the given RGBA8 colour. Coordinates are in canvas-space (the same
   * frame `ViewportController.screenToCanvas` returns). Out-of-bounds
   * clicks, missing layers, and locked layers all return `false`.
   *
   * Pipeline:
   *   1. Extract the layer's RT to an offscreen HTMLCanvasElement.
   *   2. Read pixels via `getImageData` — straight (non-premultiplied)
   *      RGBA8, which is what our `floodFill` expects.
   *   3. Mutate the buffer via `floodFill`.
   *   4. Write back via `putImageData` on the same canvas, then blit
   *      the canvas into the layer RT with `clear: true` so the RT
   *      becomes an exact copy of the modified pixels.
   *
   * The extract path allocates ~16 MB per fill on a 2048×2048 layer.
   * That's tolerable for a user-initiated click; if we ever want
   * drag-fill or brush-paint-bucket we'll need a worker + pooled
   * pixel buffer. Not worth optimising preemptively.
   */
  async floodFillLayer(
    id: string,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): Promise<boolean> {
    const layer = this.getLayer(id)
    if (!layer) return false
    if (layer.locked) return false

    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= this._canvasWidth) return false
    if (py < 0 || py >= this._canvasHeight) return false

    // extract.canvas returns an ICanvas (HTMLCanvas-compatible). We
    // guard against environments where getContext('2d') is null
    // (shouldn't happen in the real app, but keeps the function total).
    let extracted: HTMLCanvasElement
    try {
      extracted = this.app.renderer.extract.canvas({
        target: layer.renderTexture,
      }) as HTMLCanvasElement
    } catch {
      return false
    }

    const ctx = extracted.getContext('2d')
    if (!ctx) return false

    const w = extracted.width
    const h = extracted.height
    const imgData = ctx.getImageData(0, 0, w, h)

    const filled = floodFill(imgData.data, w, h, px, py, r, g, b, a)
    if (!filled) return false

    ctx.putImageData(imgData, 0, 0)

    // Blit the modified canvas back into the RenderTexture. `clear: true`
    // replaces the RT contents wholesale — anything not painted in our
    // buffer is preserved because we read the full RT into the buffer
    // first and only mutated the filled region.
    const tex = Texture.from(extracted)
    const sprite = new Sprite(tex)
    this.app.renderer.render({
      container: sprite,
      target: layer.renderTexture,
      clear: true,
    })
    sprite.destroy()
    tex.destroy()

    // Invalidate the cached snapshot so the next extract returns the
    // just-painted pixels rather than stale data on GPU-extract failure.
    layer.lastSavedBase64 = null
    return true
  }

  /* ---- Eyedropper ---- */

  /**
   * Sample the composited RGB at canvas-space `(x, y)` by walking all
   * visible layers back-to-front and compositing each sampled pixel
   * onto a running accumulator initialized to `bgHex`.
   *
   * The composite uses the Porter-Duff "over" operator on straight
   * (non-premultiplied) RGBA, which is what `getImageData` returns.
   * Blend modes other than normal are *not* respected here — sampling
   * a pixel inside a "multiply" or "screen" layer returns the layer's
   * raw pixel blended as if it were normal. Users expect eyedropper
   * to pick "what they see", so a follow-up should render the entire
   * viewport container to a 1×1 RT and sample that instead; for now
   * normal-mode correctness covers the common case.
   *
   * Returns `null` on out-of-bounds clicks so the caller can no-op
   * rather than accidentally setting the brush to the background.
   */
  sampleCompositedPixel(
    x: number,
    y: number,
    bgHex: string,
  ): { r: number; g: number; b: number } | null {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= this._canvasWidth) return null
    if (py < 0 || py >= this._canvasHeight) return null

    // Seed the accumulator with the opaque canvas background — any
    // layers above that are transparent at the click point leave this
    // colour visible, matching the user's perception.
    const bg = parseHexRgb(bgHex)
    let rR = bg.r / 255
    let rG = bg.g / 255
    let rB = bg.b / 255
    let rA = 1

    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue

      let srcR = 0
      let srcG = 0
      let srcB = 0
      let srcA = 0
      try {
        const canvas = this.app.renderer.extract.canvas({
          target: layer.renderTexture,
        }) as HTMLCanvasElement
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const data = ctx.getImageData(px, py, 1, 1).data
        srcR = data[0] / 255
        srcG = data[1] / 255
        srcB = data[2] / 255
        // Fold the layer's own opacity into the sample alpha so a
        // 50% opacity layer contributes half as much as a 100% one.
        srcA = (data[3] / 255) * layer.opacity
      } catch {
        continue
      }

      if (srcA <= 0) continue

      // Porter-Duff "over" on straight-alpha RGBA.
      const outA = srcA + rA * (1 - srcA)
      if (outA <= 0) continue
      rR = (srcR * srcA + rR * rA * (1 - srcA)) / outA
      rG = (srcG * srcA + rG * rA * (1 - srcA)) / outA
      rB = (srcB * srcA + rB * rA * (1 - srcA)) / outA
      rA = outA
    }

    return {
      r: Math.round(rR * 255),
      g: Math.round(rG * 255),
      b: Math.round(rB * 255),
    }
  }

  /* ---- Pixel extraction ---- */

  async extractLayerBase64(id: string): Promise<string | null> {
    const layer = this.getLayer(id)
    if (!layer) return null
    try {
      const base64 = await this.app.renderer.extract.base64({
        target: layer.renderTexture,
        format: 'png',
      })
      layer.lastSavedBase64 = base64
      return base64
    } catch {
      return layer.lastSavedBase64
    }
  }

  async restoreLayerFromBase64(id: string, base64: string): Promise<void> {
    const layer = this.getLayer(id)
    if (!layer) return

    const img = new Image()
    img.src = base64
    await img.decode()

    const texture = Texture.from({ resource: img, label: `restore-${id}` })
    const sprite = new Sprite(texture)
    this.app.renderer.render({
      container: sprite,
      target: layer.renderTexture,
      clear: true,
    })
    sprite.destroy()
    texture.destroy()
    layer.lastSavedBase64 = base64
  }

  /**
   * Extract the layer's pixels as a PNG `Blob`.
   *
   * Used by the stroke undo path — see `LayerSnapshot` for the rationale
   * for preferring Blobs over base64 strings for undo storage.
   *
   * Pipeline: `extract.canvas` returns an ICanvas (HTMLCanvasElement in
   * the real renderer), which we encode via `canvas.toBlob('image/png')`.
   * `toBlob` is async and may return `null` if the browser can't encode
   * (e.g. the canvas is tainted, or running out of memory) — we translate
   * that into a resolved `null` so callers can decide whether to skip the
   * snapshot or fall back to the base64 path.
   *
   * Unlike `extractLayerBase64`, this does **not** populate
   * `lastSavedBase64`. The two fallbacks serve different purposes: the
   * base64 cache backs the disk serializer (needs a string), the Blob
   * path backs undo (needs small in-memory snapshots). Conflating them
   * would mean every undo snapshot pays the base64 encode cost.
   */
  async extractLayerBlob(id: string): Promise<Blob | null> {
    const layer = this.getLayer(id)
    if (!layer) return null
    let canvas: HTMLCanvasElement
    try {
      canvas = this.app.renderer.extract.canvas({
        target: layer.renderTexture,
      }) as HTMLCanvasElement
    } catch {
      return null
    }
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  /**
   * Restore a layer's pixels from a PNG `Blob`.
   *
   * Decodes via `createImageBitmap` — faster than the Image + data URL
   * path used by `restoreLayerFromBase64` because it runs on the
   * browser's image worker on supporting platforms, and it never
   * serialises through a giant data-URL string.
   *
   * Invalidates the layer's `lastSavedBase64` cache so the next
   * extract.base64 call (for serializer / remove-layer capture) pulls
   * fresh pixels matching the restored state. Not updating it here
   * would risk the disk-save fallback returning pre-undo pixels on a
   * GPU extract failure.
   */
  async restoreLayerFromBlob(id: string, blob: Blob): Promise<void> {
    const layer = this.getLayer(id)
    if (!layer) return

    const bitmap = await createImageBitmap(blob)
    const texture = Texture.from({ resource: bitmap, label: `restore-${id}` })
    const sprite = new Sprite(texture)
    try {
      this.app.renderer.render({
        container: sprite,
        target: layer.renderTexture,
        clear: true,
      })
    } finally {
      sprite.destroy()
      texture.destroy()
      // `bitmap` is managed by the texture's resource — destroying the
      // texture releases it. Calling `bitmap.close()` here would be a
      // double-free. (Pixi v8 takes ownership when the texture is
      // created from an `ImageBitmap` resource.)
    }
    layer.lastSavedBase64 = null
  }

  /* ---- Load from file data ---- */

  /**
   * Rebuild the layer stack from persisted data.
   *
   * Two pixel-source paths are supported:
   *
   *   1. `bitmaps` map (v4 path): callers that have already read sidecar
   *      PNG files from disk and decoded them into `ImageBitmap`s pass
   *      them here. A layer whose id is not in the map loads blank.
   *   2. `imageData` on the layer record (v3 path): a base64 PNG data
   *      URL is decoded inline via `HTMLImageElement`. Used for legacy
   *      files — the v4 serializer always writes `null` here.
   *
   * The two paths are mutually exclusive per layer: if a bitmap exists
   * for a layer it wins over `imageData`. This is intentional — it lets
   * a v3→v4 migration coexist in one call (v3 JSON with inline base64
   * that a future caller has *also* converted to bitmaps is unusual but
   * valid). `lastSavedBase64` is populated only from the v3 path; for
   * the v4 path it is left `null` and the first successful
   * `extract.base64` call (serializer / remove-layer capture) will fill
   * it.
   */
  async loadLayers(
    layersData: CanvasLayerData[],
    activeId: string,
    bitmaps?: ReadonlyMap<string, ImageBitmap>,
  ): Promise<void> {
    // Clear existing
    for (const l of this.layers) {
      this.viewport.removeChild(l.container)
      l.renderTexture.destroy(true)
      l.sprite.destroy()
      l.container.destroy()
    }
    this.layers = []

    // Reseed the monotonic layer counter from the loaded names so a later
    // `+` never produces a name that already exists. `Layer 1 copy` and
    // other non-standard names are ignored; only `Layer <N>` matches.
    this._layerSeq = 0
    for (const ld of layersData) {
      const n = extractLayerSuffix(ld.name)
      if (n !== null && n > this._layerSeq) this._layerSeq = n
    }

    for (const ld of layersData) {
      const rt = RenderTexture.create({
        width: this._canvasWidth,
        height: this._canvasHeight,
      })
      const sprite = new Sprite(rt)
      const container = new Container()
      container.label = `layer-${ld.id}`
      container.addChild(sprite)
      this.viewport.addChild(container)

      const bitmap = bitmaps?.get(ld.id)
      const layer: LayerRuntime = {
        id: ld.id,
        name: ld.name,
        visible: ld.visible,
        opacity: ld.opacity,
        locked: ld.locked,
        blendMode: ld.blendMode,
        container,
        sprite,
        renderTexture: rt,
        // v3 path populates the cache so extract-failure fallbacks have
        // something to return; v4 leaves it null until the next successful
        // base64 extract.
        lastSavedBase64: bitmap ? null : ld.imageData,
      }

      if (bitmap) {
        // v4: blit the pre-decoded ImageBitmap into the RT. The bitmap is
        // owned by the caller, but Pixi takes ownership when we hand it
        // to a Texture — we don't `.close()` it here.
        try {
          const tex = Texture.from({ resource: bitmap, label: `load-${ld.id}` })
          const s = new Sprite(tex)
          this.app.renderer.render({ container: s, target: rt, clear: true })
          s.destroy()
          tex.destroy()
        } catch {
          // Failed to upload — layer starts blank.
        }
      } else if (ld.imageData && ld.imageData.length > 64) {
        // v3: decode inline base64 PNG.
        try {
          const img = new Image()
          img.src = ld.imageData
          await img.decode()
          const tex = Texture.from({ resource: img, label: `load-${ld.id}` })
          const s = new Sprite(tex)
          this.app.renderer.render({ container: s, target: rt, clear: true })
          s.destroy()
          tex.destroy()
        } catch {
          // Failed to decode — layer starts blank.
        }
      }

      this.layers.push(layer)
    }

    this._activeLayerId = this.layers.find((l) => l.id === activeId)?.id
      ?? this.layers[this.layers.length - 1]?.id
      ?? null
    this.syncVisuals()
    this.reorderScratchpad()
  }

  /* ---- Internal ---- */

  private syncVisuals(): void {
    for (const l of this.layers) {
      l.container.visible = l.visible
      l.container.alpha = l.opacity
      l.sprite.blendMode = l.blendMode as Sprite['blendMode']
    }
  }

  private rebuildDisplayOrder(): void {
    // Remove all layer containers, re-add in order, then scratchpad on top
    for (const l of this.layers) {
      if (l.container.parent === this.viewport) {
        this.viewport.removeChild(l.container)
      }
    }
    if (this.scratchpadContainer.parent === this.viewport) {
      this.viewport.removeChild(this.scratchpadContainer)
    }

    for (const l of this.layers) {
      this.viewport.addChild(l.container)
    }
    this.reorderScratchpad()
  }

  /** Keep scratchpad above the active layer. */
  private reorderScratchpad(): void {
    if (this.scratchpadContainer.parent === this.viewport) {
      this.viewport.removeChild(this.scratchpadContainer)
    }

    const activeIdx = this.layers.findIndex((l) => l.id === this._activeLayerId)
    if (activeIdx >= 0 && activeIdx < this.layers.length - 1) {
      // Insert scratchpad right after the active layer
      const nextLayer = this.layers[activeIdx + 1]
      const childIdx = this.viewport.children.indexOf(nextLayer.container)
      this.viewport.addChildAt(this.scratchpadContainer, childIdx)
    } else {
      // Active is topmost or none — scratchpad on very top
      this.viewport.addChild(this.scratchpadContainer)
    }
  }

  /** Clean up all GPU resources. */
  destroy(): void {
    for (const l of this.layers) {
      l.renderTexture.destroy(true)
      l.sprite.destroy()
      l.container.destroy()
    }
    this.layers = []
    this.scratchpadRT.destroy(true)
    this.scratchpadSprite.destroy()
    this.scratchpadContainer.destroy()
  }
}

/**
 * Extract the numeric suffix from a default-style layer name (`Layer 7`
 * → 7). Returns `null` for custom names like `Layer 1 copy`, `Sky`, or
 * anything else that doesn't match the canonical `Layer <positive int>`
 * pattern exactly. The strict match is intentional — we only want to
 * bump the monotonic counter past names the counter itself could have
 * produced, so user-renamed layers (even if they end in a digit) don't
 * accidentally inflate the sequence.
 */
function extractLayerSuffix(name: string): number | null {
  const m = /^Layer (\d+)$/.exec(name)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parse a `#rrggbb` or `#rgb` hex string to integer RGB channels 0–255.
 * Falls back to white on unrecognised input — keeps eyedropper total
 * rather than throwing on a malformed stored background.
 */
function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim()
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16)
    const g = parseInt(h[1] + h[1], 16)
    const b = parseInt(h[2] + h[2], 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b }
    }
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b }
    }
  }
  return { r: 255, g: 255, b: 255 }
}

/** Draw a white background rectangle into a RenderTexture. */
export function fillBackground(
  app: Application,
  rt: RenderTexture,
  color: number,
  width: number,
  height: number,
): void {
  const g = new Graphics()
  g.rect(0, 0, width, height).fill({ color })
  app.renderer.render({ container: g, target: rt, clear: true })
  g.destroy()
}
