import type { StrokePoint, BrushSettings } from '@/types/canvas'
import { interpolateStroke } from '@/lib/canvas/math'
import type { BrushSystem } from '@/lib/canvas/brush-system'
import type { LayerManager } from '@/lib/canvas/layer-manager'

/**
 * Processes pointer events into strokes.
 *
 * On pointerdown: begins a new stroke, stamps the initial point.
 * On pointermove: collects points, interpolates via Catmull-Rom, stamps.
 * On pointerup:
 *   - Normal strokes: commit the scratchpad to the active layer.
 *   - Eraser strokes: no-op — stamps were already rendered straight into
 *     the active layer with blendMode='erase'.
 *
 * Why does the eraser bypass the scratchpad?
 * The scratchpad pattern works for *additive* ink (accumulate stamps into
 * an RT, composite once with normal blend so opacity is bounded to the
 * stroke's settings). Erase semantics are fundamentally different — each
 * stamp must subtract alpha from pixels already on the layer. Rendering
 * Graphics → layer RT with `blendMode='erase'` does exactly that.
 * Applying `'erase'` at commit time via the scratchpad Sprite was
 * unreliable in practice (appeared as translucent grey paint on some
 * backends because the scratchpad RT stores premultiplied alpha and the
 * sprite's blend pass doesn't always respect it). Direct-to-layer erase
 * is the canonical Pixi path and also gives the user real-time feedback
 * as pixels disappear.
 */
export class StrokeEngine {
  private layerManager: LayerManager
  private brushSystem: BrushSystem
  private currentPoints: StrokePoint[] = []
  private _isDrawing = false
  private _isEraser = false

  /** Called when a stroke is committed to the layer. */
  onStrokeCommitted: (() => void) | null = null

  constructor(layerManager: LayerManager, brushSystem: BrushSystem) {
    this.layerManager = layerManager
    this.brushSystem = brushSystem
  }

  get isDrawing(): boolean {
    return this._isDrawing
  }

  /**
   * Returns the RenderTexture that stamps for the current stroke should
   * render into: the active layer directly when erasing, or the shared
   * scratchpad otherwise. Returns null if there is no active layer.
   */
  private getStrokeTarget() {
    if (this._isEraser) {
      const active = this.layerManager.getActiveLayer()
      return active ? active.renderTexture : null
    }
    return this.layerManager.getScratchpadRT()
  }

  beginStroke(point: StrokePoint, settings: BrushSettings, isEraser: boolean): void {
    const active = this.layerManager.getActiveLayer()
    if (!active || active.locked) return

    this._isDrawing = true
    this._isEraser = isEraser
    this.currentPoints = [point]

    const target = this.getStrokeTarget()
    if (!target) return

    this.brushSystem.stampAt(
      point.x,
      point.y,
      point.pressure,
      settings,
      target,
      isEraser,
    )
  }

  continueStroke(point: StrokePoint, settings: BrushSettings): void {
    if (!this._isDrawing) return

    this.currentPoints.push(point)

    // Interpolate the last few points and render stamps.
    // We use the last 4 points for Catmull-Rom context.
    const recent = this.currentPoints.slice(-4)
    if (recent.length < 2) return

    const spacingPx = Math.max(1, settings.size * settings.spacing)
    const stamps = interpolateStroke(recent, spacingPx)

    // Skip the first stamp since it was already rendered by the previous
    // call (beginStroke or the prior continueStroke).
    const newStamps = stamps.slice(1)
    if (newStamps.length === 0) return

    const target = this.getStrokeTarget()
    if (!target) return

    this.brushSystem.renderStamps(newStamps, settings, target, this._isEraser)
  }

  endStroke(): void {
    if (!this._isDrawing) return
    this._isDrawing = false

    if (!this._isEraser) {
      // Normal strokes: commit the accumulated scratchpad to the active
      // layer with normal blend.
      this.layerManager.commitScratchpad(false)
    }
    // Eraser strokes have already been rendered directly into the active
    // layer — nothing to commit, nothing to clear.

    this.currentPoints = []
    this._isEraser = false

    this.onStrokeCommitted?.()
  }

  cancelStroke(): void {
    if (!this._isDrawing) return
    this._isDrawing = false
    // Only the scratchpad has mid-stroke state to discard. Eraser pixels
    // already subtracted from the layer cannot be un-subtracted without
    // an undo snapshot — but cancelStroke is only invoked on tool abort
    // (e.g. Escape/pointercancel), where committing the partial erase is
    // acceptable.
    if (!this._isEraser) {
      this.layerManager.clearScratchpad()
    }
    this.currentPoints = []
    this._isEraser = false
  }
}
