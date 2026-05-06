import { Application, Container } from 'pixi.js'
import { LayerManager } from '@/lib/canvas/layer-manager'
import { StrokeEngine } from '@/lib/canvas/stroke-engine'
import { BrushSystem } from '@/lib/canvas/brush-system'
import { ViewportController } from '@/lib/canvas/viewport-controller'
import { UndoManager } from '@/lib/canvas/undo-manager'
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_BACKGROUND,
} from '@/lib/canvas/constants'

/**
 * CanvasEngine — the orchestrator for the PixiJS drawing engine.
 *
 * Owns the PixiJS Application, manages all subsystems.
 * This class has NO React dependencies — it is held in a `useRef`
 * by the React component and initialized/destroyed via effects.
 */
export class CanvasEngine {
  app!: Application
  layerManager!: LayerManager
  strokeEngine!: StrokeEngine
  brushSystem!: BrushSystem
  viewportController!: ViewportController
  undoManager!: UndoManager

  private viewport!: Container
  private _initialized = false
  private _width = DEFAULT_CANVAS_WIDTH
  private _height = DEFAULT_CANVAS_HEIGHT
  private _background = DEFAULT_BACKGROUND
  /**
   * Stable id for this canvas's pixel folder under
   * `_marrow/_drawings/<assetId>/`. `null` until the file has been loaded
   * from a v5 JSON that already has one, or until `writeCanvasFile`
   * mints one on first save. Rename of the `.canvas` file does not
   * touch this id — it travels with the JSON content, not the filename.
   */
  private _assetId: string | null = null

  /**
   * Observes the host container and resizes the PixiJS renderer to
   * match. Required because PixiJS v8's `resizeTo` option only reacts
   * to window resize events — when the *container* resizes (sidebar
   * collapsing, pane drag, devtools docking, etc.) the renderer is
   * left at its init-time dimensions and pointer coordinates fall out
   * of alignment with rendered pixels.
   */
  private resizeObserver: ResizeObserver | null = null

  /** Kept so we can unobserve during teardown. */
  private hostContainer: HTMLElement | null = null

  get initialized(): boolean {
    return this._initialized
  }

  get width(): number {
    return this._width
  }

  get height(): number {
    return this._height
  }

  get background(): string {
    return this._background
  }

  set background(color: string) {
    this._background = color
  }

  get assetId(): string | null {
    return this._assetId
  }

  /**
   * Set the canvas's stable asset id. Called from the load path when a
   * v5 JSON provides one, and from `writeCanvasFile` when a first-save
   * needs to mint one. Never rotate or clear this once it's set — every
   * reference on disk points at the resulting folder.
   */
  setAssetId(id: string): void {
    this._assetId = id
  }

  setDimensions(w: number, h: number): void {
    this._width = w
    this._height = h
    // If the engine is already initialized (e.g. called from readCanvasFile
    // after init), propagate so loadLayers uses the right RT size.
    if (this._initialized) {
      this.layerManager.setCanvasDimensions(w, h)
    }
  }

  /**
   * Expand the canvas to fit the given canvas-space point, if it lies
   * outside the current drawing bounds.
   *
   * Expansion is quantized to 1024-pixel steps so a single stroke near
   * the edge doesn't produce dozens of tiny grow operations. Calling this
   * repeatedly with the same out-of-bounds point is cheap — the inner
   * check in `LayerManager.expandCanvas` short-circuits when the target
   * dimensions haven't changed.
   *
   * Only positive expansion (right / down) is handled. Negative canvas
   * coordinates are not currently drawable — pan back to the canvas
   * origin to reach those areas.
   */
  expandToFit(x: number, y: number): void {
    if (!this._initialized) return
    if (x < this._width && y < this._height) return

    const STEP = 1024
    const newW = x >= this._width
      ? Math.ceil((x + 1) / STEP) * STEP
      : this._width
    const newH = y >= this._height
      ? Math.ceil((y + 1) / STEP) * STEP
      : this._height

    this.layerManager.expandCanvas(newW, newH)
    this._width = this.layerManager.canvasWidth
    this._height = this.layerManager.canvasHeight
  }

  /**
   * Initialize the PixiJS application and all subsystems.
   * Must be called once before any drawing operations.
   */
  async init(container: HTMLElement): Promise<void> {
    if (this._initialized) return

    this.app = new Application()
    await this.app.init({
      resizeTo: container,
      background: this._background,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      powerPreference: 'high-performance',
    })

    // PixiJS v8 canvas element
    const canvas = this.app.canvas as HTMLCanvasElement
    canvas.style.touchAction = 'none'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    // Force cursor inheritance from the viewport host `<div>`. `<canvas>`'s
    // UA-default `cursor: auto` resolves to `default` in Chromium (not to the
    // parent's used value), so the reactive `cursor` on the host div would
    // not actually paint — the canvas overlays it at 100% × 100% and shows
    // the UA default instead. `inherit` is explicit and makes CSS propagate
    // the host's resolved cursor through to the canvas surface. See BUG-06.
    canvas.style.cursor = 'inherit'
    container.appendChild(canvas)

    // Root viewport container (pan/zoom applies here)
    this.viewport = new Container()
    this.viewport.label = 'viewport'
    this.app.stage.addChild(this.viewport)

    // Subsystems
    this.layerManager = new LayerManager(
      this.app,
      this.viewport,
      this._width,
      this._height,
    )
    this.brushSystem = new BrushSystem(this.app)
    this.strokeEngine = new StrokeEngine(this.layerManager, this.brushSystem)
    this.viewportController = new ViewportController(this.viewport)
    this.undoManager = new UndoManager(this.layerManager)

    this._initialized = true

    // Watch the host container for size changes. `resizeTo` above only
    // listens to window resizes — it will not fire when the container
    // itself changes size independently (sidebar toggle, split-pane
    // drag, devtools dock, mobile orientation-triggered layout swap,
    // etc.) so pointer coordinates drift out of sync with rendered
    // pixels and strokes land at the wrong place.
    //
    // The observer is disconnected synchronously at the top of
    // destroy() so its callback cannot fire on a torn-down renderer.
    this.hostContainer = container
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this._initialized) return
      const entry = entries[0]
      if (!entry) return
      const w = Math.max(1, Math.floor(entry.contentRect.width))
      const h = Math.max(1, Math.floor(entry.contentRect.height))
      try {
        this.app.renderer.resize(w, h)
      } catch {
        // Renderer may be mid-teardown. Drop the resize — destroy() is
        // about to nuke everything anyway.
      }
    })
    this.resizeObserver.observe(container)
  }

  /** Set up a default canvas with one blank layer. */
  initDefault(): void {
    this.layerManager.addLayer('Layer 1')
  }

  /** Render the scene (call after visual changes outside pointer events). */
  render(): void {
    if (!this._initialized) return
    try {
      this.app.render()
    } catch {
      // Renderer may be destroyed during teardown
    }
  }

  /** Clean up all GPU resources. */
  destroy(): void {
    if (!this._initialized) return

    // Flip the init flag first so any observer callback that has
    // already been queued for this microtask short-circuits.
    this._initialized = false

    // Disconnect observers SYNCHRONOUSLY before any other teardown.
    // If we disconnected after ticker.stop() / app.destroy(), a pending
    // ResizeObserver callback could still fire and call renderer.resize
    // on a destroyed renderer — the same class of bug CLAUDE.md's
    // "Canvas Lifecycle" section warns about for the Pixi ticker.
    if (this.resizeObserver) {
      try {
        if (this.hostContainer) this.resizeObserver.unobserve(this.hostContainer)
        this.resizeObserver.disconnect()
      } catch { /* ignore */ }
      this.resizeObserver = null
    }
    this.hostContainer = null

    try {
      this.app.ticker?.stop()
    } catch { /* ignore */ }

    this.undoManager.clear()
    this.brushSystem.destroy()
    this.layerManager.destroy()

    try {
      this.app.destroy(true, { children: true })
    } catch { /* ignore */ }
  }
}
