import type { Container } from 'pixi.js'
import type { ViewportState } from '@/types/canvas'
import { MIN_ZOOM, MAX_ZOOM } from '@/lib/canvas/constants'
import type { Point } from '@/lib/canvas/math'

/**
 * Manages pan and zoom on the root PixiJS Container.
 * All layer sprites live inside this container, so transforming it
 * transforms the entire canvas view.
 */
export class ViewportController {
  private root: Container
  private _state: ViewportState = { x: 0, y: 0, zoom: 1 }
  private _isPanning = false
  private _panStart = { x: 0, y: 0 }
  private _panStartState = { x: 0, y: 0 }

  constructor(root: Container) {
    this.root = root
  }

  get state(): ViewportState {
    return { ...this._state }
  }

  /** Apply a viewport state (e.g. loaded from file). */
  setState(vp: ViewportState): void {
    this._state = {
      x: Number.isFinite(vp.x) ? vp.x : 0,
      y: Number.isFinite(vp.y) ? vp.y : 0,
      zoom: clampZoom(Number.isFinite(vp.zoom) ? vp.zoom : 1),
    }
    this.applyTransform()
  }

  /** Convert a screen-space point (e.g. mouse position) to canvas-space. */
  screenToCanvas(screenX: number, screenY: number, canvasRect: DOMRect): Point {
    return {
      x: (screenX - canvasRect.left - this._state.x) / this._state.zoom,
      y: (screenY - canvasRect.top - this._state.y) / this._state.zoom,
    }
  }

  /* ---- Pan ---- */

  beginPan(clientX: number, clientY: number): void {
    this._isPanning = true
    this._panStart = { x: clientX, y: clientY }
    this._panStartState = { x: this._state.x, y: this._state.y }
  }

  updatePan(clientX: number, clientY: number): void {
    if (!this._isPanning) return
    this._state.x = this._panStartState.x + (clientX - this._panStart.x)
    this._state.y = this._panStartState.y + (clientY - this._panStart.y)
    this.applyTransform()
  }

  endPan(): void {
    this._isPanning = false
  }

  get isPanning(): boolean {
    return this._isPanning
  }

  panBy(dx: number, dy: number): void {
    this._state.x += dx
    this._state.y += dy
    this.applyTransform()
  }

  /* ---- Zoom ---- */

  /**
   * Zoom toward/away from a pivot point (in screen coords relative to canvas element).
   * `delta` > 0 zooms in, < 0 zooms out.
   */
  zoomAtPoint(delta: number, pivotX: number, pivotY: number): void {
    const oldZoom = this._state.zoom
    const newZoom = clampZoom(oldZoom * (1 + delta * 0.001))
    if (newZoom === oldZoom) return

    // Adjust pan so the pivot point stays fixed on screen
    const scale = newZoom / oldZoom
    this._state.x = pivotX - (pivotX - this._state.x) * scale
    this._state.y = pivotY - (pivotY - this._state.y) * scale
    this._state.zoom = newZoom
    this.applyTransform()
  }

  /** Set zoom to a specific level centered on the viewport. */
  setZoom(zoom: number, viewWidth: number, viewHeight: number): void {
    const cx = viewWidth / 2
    const cy = viewHeight / 2
    const oldZoom = this._state.zoom
    const newZoom = clampZoom(zoom)
    const scale = newZoom / oldZoom
    this._state.x = cx - (cx - this._state.x) * scale
    this._state.y = cy - (cy - this._state.y) * scale
    this._state.zoom = newZoom
    this.applyTransform()
  }

  /* ---- Transform ---- */

  private applyTransform(): void {
    this.root.position.set(this._state.x, this._state.y)
    this.root.scale.set(this._state.zoom)
  }
}

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}
