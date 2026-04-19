import {
  Container,
  Sprite,
  Texture,
  type Application,
  type RenderTexture,
} from 'pixi.js'
import type { BrushSettings } from '@/types/canvas'
import type { InterpolatedStamp } from '@/lib/canvas/math'

/**
 * Renders brush stamps into a target RenderTexture.
 *
 * Both the normal brush and the eraser use the same fundamental pattern:
 * a pooled `Sprite` sampling a pre-rendered mask texture, positioned
 * and scaled per stamp. They differ only in the mask, tint, and blend:
 *
 * 1. **Normal brush** — radial-gradient alpha-falloff mask whose shape
 *    depends on `settings.hardness`. Sprite is `tint`-ed with the brush
 *    colour, `alpha` is the per-stamp opacity, and it renders with
 *    `blendMode = 'normal'` into the scratchpad RT. The scratchpad is
 *    composited into the active layer once at stroke-commit time
 *    (see `LayerManager.commitScratchpad`).
 *
 * 2. **Eraser** — solid white disc mask, `blendMode = 'erase'`, rendered
 *    directly into the active layer RT so alpha is subtracted on each
 *    pointermove.
 *
 * Why a Sprite + CanvasSource mask texture instead of `Graphics`?
 * In PixiJS v8 both `Graphics.blendMode = 'erase'` (eraser regression)
 * and naïve multi-circle alpha stacking (previous soft-brush impl —
 * BUG-07) were unreliable. A Sprite sampling an HTMLCanvas-backed
 * texture goes through Pixi's textured-quad path, where blend mode
 * and tint behave predictably across GL backends. It also lets us
 * express soft brushes via an alpha gradient baked into the mask
 * rather than by stacking concentric fills — one draw per stamp
 * instead of three, and no compositing artefacts at the edges.
 *
 * Hardness caching: the brush mask is regenerated only when hardness
 * changes, quantized to 20 steps (0.00, 0.05, …, 1.00). Dragging the
 * hardness slider therefore rebuilds at most once per 5 %-point change
 * rather than every frame.
 *
 * Future: custom GLSL shaders with tip shapes + grain texture, and a
 * proper texture atlas so we don't upload a fresh mask on each rebuild.
 */
export class BrushSystem {
  private app: Application

  /** Pre-rendered opaque white circle used as the eraser alpha mask. */
  private eraserMaskTexture: Texture
  /** Reusable sprite pool; grows up to the largest batch we've ever seen. */
  private eraserSpritePool: Sprite[] = []
  /** Container parent for a single batch's worth of eraser sprites. */
  private eraserBatchContainer: Container

  /** Radial-gradient mask for the normal brush; rebuilt on hardness change. */
  private brushMaskTexture: Texture
  /** Last hardness value (quantized) baked into `brushMaskTexture`. */
  private brushMaskHardness = -1
  private brushSpritePool: Sprite[] = []
  private brushBatchContainer: Container

  constructor(app: Application) {
    this.app = app
    this.eraserBatchContainer = new Container()
    this.brushBatchContainer = new Container()
    this.eraserMaskTexture = createCircleMaskTexture()
    // Seed with a full-hardness mask; `renderBrushStamps` will rebuild
    // at the configured hardness on first use if it differs.
    this.brushMaskTexture = createSoftBrushMaskTexture(1)
    this.brushMaskHardness = 1
  }

  /**
   * Render a batch of stamps into the target texture.
   * This is the hot path during drawing — called for each set of
   * interpolated points between pointermove events.
   */
  renderStamps(
    stamps: InterpolatedStamp[],
    settings: BrushSettings,
    target: RenderTexture,
    isEraser = false,
  ): void {
    if (stamps.length === 0) return

    if (isEraser) {
      this.renderEraserStamps(stamps, settings, target)
      return
    }

    this.renderBrushStamps(stamps, settings, target)
  }

  /**
   * Eraser path — alpha-subtract circles via pooled Sprites.
   *
   * Each sprite is positioned at the stamp coordinate, sized to
   * `diameter = 2 * radius`, and blended with `'erase'` so the target
   * layer's alpha is multiplied by `(1 - mask.alpha)` per pixel. Opaque
   * parts of the mask (the circle interior) therefore zero out the
   * corresponding alpha in the layer — the canonical destination-out
   * operation.
   *
   * The sprite pool avoids per-stamp GC churn; the container is reused
   * across calls and its children are cleared afterwards so no stale
   * sprites remain in the scene graph.
   */
  private renderEraserStamps(
    stamps: InterpolatedStamp[],
    settings: BrushSettings,
    target: RenderTexture,
  ): void {
    this.eraserBatchContainer.removeChildren()

    for (let i = 0; i < stamps.length; i++) {
      const stamp = stamps[i]
      const radius = (settings.size / 2) * Math.max(0.2, stamp.pressure)
      const diameter = Math.max(1, radius * 2)

      const sprite = this.getPooledEraserSprite(i)
      sprite.position.set(stamp.x, stamp.y)
      sprite.width = diameter
      sprite.height = diameter

      this.eraserBatchContainer.addChild(sprite)
    }

    this.app.renderer.render({
      container: this.eraserBatchContainer,
      target,
      clear: false,
    })

    // Leave sprites in the pool but unparent them so they aren't
    // re-rendered on the next main-pass tick.
    this.eraserBatchContainer.removeChildren()
  }

  private getPooledEraserSprite(index: number): Sprite {
    while (this.eraserSpritePool.length <= index) {
      const sprite = new Sprite(this.eraserMaskTexture)
      sprite.anchor.set(0.5)
      sprite.blendMode = 'erase'
      this.eraserSpritePool.push(sprite)
    }
    return this.eraserSpritePool[index]
  }

  /**
   * Normal brush path — tinted alpha-mask sprites composited with
   * `blendMode = 'normal'` into the scratchpad. Sprite.tint multiplies
   * the white mask by the brush colour so the stamp paints in the
   * requested hue; Sprite.alpha scales the whole thing by per-stamp
   * opacity.
   *
   * The alpha mask itself already encodes the hardness falloff, so
   * there's no post-draw compositing magic (no ` * 0.5`, no concentric
   * rings). Opacity passed to Pixi is what the user gets — at 100 %
   * opacity and 100 % pressure the core of the stamp is opaque.
   */
  private renderBrushStamps(
    stamps: InterpolatedStamp[],
    settings: BrushSettings,
    target: RenderTexture,
  ): void {
    const mask = this.ensureBrushMask(settings.hardness)
    const tint = parseInt(settings.color.replace('#', ''), 16)

    this.brushBatchContainer.removeChildren()

    for (let i = 0; i < stamps.length; i++) {
      const stamp = stamps[i]
      const radius = (settings.size / 2) * Math.max(0.2, stamp.pressure)
      const diameter = Math.max(1, radius * 2)
      const alpha = settings.opacity * Math.max(0.1, stamp.pressure)

      const sprite = this.getPooledBrushSprite(i, mask)
      sprite.texture = mask
      sprite.tint = tint
      sprite.alpha = alpha
      sprite.position.set(stamp.x, stamp.y)
      sprite.width = diameter
      sprite.height = diameter

      this.brushBatchContainer.addChild(sprite)
    }

    this.app.renderer.render({
      container: this.brushBatchContainer,
      target,
      clear: false,
    })

    this.brushBatchContainer.removeChildren()
  }

  private getPooledBrushSprite(index: number, mask: Texture): Sprite {
    while (this.brushSpritePool.length <= index) {
      const sprite = new Sprite(mask)
      sprite.anchor.set(0.5)
      sprite.blendMode = 'normal'
      this.brushSpritePool.push(sprite)
    }
    return this.brushSpritePool[index]
  }

  /**
   * Return the cached brush mask for the given hardness, rebuilding
   * (and destroying the old texture) if the quantized hardness value
   * has changed since the last call. Quantization to 0.05 steps keeps
   * the rebuild rate bounded while a user drags the slider.
   */
  private ensureBrushMask(hardness: number): Texture {
    const clamped = Math.max(0, Math.min(1, hardness))
    const quantized = Math.round(clamped * 20) / 20
    if (quantized !== this.brushMaskHardness) {
      this.brushMaskTexture.destroy(true)
      this.brushMaskTexture = createSoftBrushMaskTexture(quantized)
      this.brushMaskHardness = quantized
    }
    return this.brushMaskTexture
  }

  /**
   * Render a single stamp (e.g. on pointerdown before any movement).
   */
  stampAt(
    x: number,
    y: number,
    pressure: number,
    settings: BrushSettings,
    target: RenderTexture,
    isEraser = false,
  ): void {
    this.renderStamps(
      [{ x, y, pressure }],
      settings,
      target,
      isEraser,
    )
  }

  destroy(): void {
    for (const sprite of this.eraserSpritePool) sprite.destroy()
    this.eraserSpritePool = []
    for (const sprite of this.brushSpritePool) sprite.destroy()
    this.brushSpritePool = []
    this.eraserBatchContainer.destroy()
    this.brushBatchContainer.destroy()
    this.eraserMaskTexture.destroy(true)
    this.brushMaskTexture.destroy(true)
  }
}

/**
 * Build the eraser alpha-mask texture once at construction: a 128×128
 * offscreen canvas with an opaque white circle filling its bounds.
 *
 * 128px is a compromise — large enough that upsizing to a 200px brush
 * still looks smooth (the max brush size is 200), small enough to keep
 * texture memory tiny (~64 KB).
 */
function createCircleMaskTexture(): Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // Fallback to an empty texture. Eraser will do nothing, but we avoid
    // throwing during canvas engine construction.
    return Texture.EMPTY
  }

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()

  return Texture.from(canvas)
}

/**
 * Build a soft-brush alpha mask for the given hardness in [0, 1].
 *
 * Semantics:
 *   - hardness = 1 → identical to the eraser mask: opaque disc with
 *     a crisp edge. No gradient.
 *   - hardness = 0 → pure radial gradient from opaque white at the
 *     centre to transparent at the edge. Maximally soft.
 *   - intermediate → opaque core of radius `r * hardness`, then a
 *     radial gradient tail from opaque to transparent over the
 *     remaining `r * (1 - hardness)`.
 *
 * The output is a white (tintable) alpha texture — the tint applied
 * by the Sprite at draw time colours the whole mask. Peak alpha at
 * the core is always 1; per-stamp opacity is multiplied in via
 * `Sprite.alpha` by `renderBrushStamps`, so a 100 % opacity soft brush
 * now actually paints at full alpha at the core (fixing BUG-07).
 */
function createSoftBrushMaskTexture(hardness: number): Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) return Texture.EMPTY

  const cx = size / 2
  const cy = size / 2
  const r = size / 2
  const coreRadius = r * Math.max(0, Math.min(1, hardness))

  if (hardness >= 1) {
    // Hard brush: identical to the eraser mask. Single crisp disc.
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Fill the opaque core first (may be zero-radius at hardness=0).
    if (coreRadius > 0) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2)
      ctx.fill()
    }

    // Then paint the gradient tail on top. Using a radial gradient
    // from (coreRadius → r) means the overlap with the solid core is
    // already at full alpha, so there's no banding at the boundary.
    const grad = ctx.createRadialGradient(cx, cy, coreRadius, cx, cy, r)
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return Texture.from(canvas)
}
