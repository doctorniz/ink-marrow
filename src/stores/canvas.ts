import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CanvasTool, BrushSettings, CanvasLayerMeta, ViewportState } from '@/types/canvas'
import { DEFAULT_BRUSH, DEFAULT_VIEWPORT } from '@/lib/canvas/constants'

interface CanvasState {
  /* Tool */
  activeTool: CanvasTool
  brushSettings: BrushSettings
  eraserSize: number

  /* Layers (metadata only — GPU state lives in engine ref) */
  layers: CanvasLayerMeta[]
  activeLayerId: string | null

  /* Viewport */
  viewport: ViewportState

  /* File state */
  hasUnsavedChanges: boolean

  /* Undo */
  canUndo: boolean
  canRedo: boolean

  /* Recent colors */
  recentColors: string[]

  /* Actions */
  setActiveTool: (tool: CanvasTool) => void
  setBrushSettings: (partial: Partial<BrushSettings>) => void
  setEraserSize: (size: number) => void
  setLayers: (layers: CanvasLayerMeta[]) => void
  setActiveLayerId: (id: string | null) => void
  setViewport: (vp: ViewportState) => void
  markDirty: () => void
  markSaved: () => void
  setUndoState: (canUndo: boolean, canRedo: boolean) => void
  pushRecentColor: (color: string) => void
  reset: () => void
}

const MAX_RECENT_COLORS = 12

export const useCanvasStore = create<CanvasState>()(
  immer((set) => ({
    activeTool: 'brush',
    brushSettings: { ...DEFAULT_BRUSH },
    eraserSize: 20,

    layers: [],
    activeLayerId: null,

    viewport: { ...DEFAULT_VIEWPORT },

    hasUnsavedChanges: false,

    canUndo: false,
    canRedo: false,

    recentColors: [],

    setActiveTool: (tool) =>
      set((s) => {
        s.activeTool = tool
      }),

    setBrushSettings: (partial) =>
      set((s) => {
        Object.assign(s.brushSettings, partial)
        if (partial.size !== undefined) {
          s.brushSettings.size = Math.max(1, Math.min(200, partial.size))
        }
        if (partial.opacity !== undefined) {
          s.brushSettings.opacity = Math.max(0, Math.min(1, partial.opacity))
        }
        if (partial.hardness !== undefined) {
          s.brushSettings.hardness = Math.max(0, Math.min(1, partial.hardness))
        }
        if (partial.spacing !== undefined) {
          s.brushSettings.spacing = Math.max(0.05, Math.min(1, partial.spacing))
        }
      }),

    setEraserSize: (size) =>
      set((s) => {
        s.eraserSize = Math.max(1, Math.min(200, size))
      }),

    setLayers: (layers) =>
      set((s) => {
        s.layers = layers
      }),

    setActiveLayerId: (id) =>
      set((s) => {
        s.activeLayerId = id
      }),

    setViewport: (vp) =>
      set((s) => {
        s.viewport = vp
      }),

    markDirty: () =>
      set((s) => {
        s.hasUnsavedChanges = true
      }),

    markSaved: () =>
      set((s) => {
        s.hasUnsavedChanges = false
      }),

    setUndoState: (canUndo, canRedo) =>
      set((s) => {
        s.canUndo = canUndo
        s.canRedo = canRedo
      }),

    pushRecentColor: (color) =>
      set((s) => {
        s.recentColors = [
          color,
          ...s.recentColors.filter((c) => c !== color),
        ].slice(0, MAX_RECENT_COLORS)
      }),

    reset: () =>
      set((s) => {
        s.activeTool = 'brush'
        s.brushSettings = { ...DEFAULT_BRUSH }
        s.eraserSize = 20
        s.layers = []
        s.activeLayerId = null
        s.viewport = { ...DEFAULT_VIEWPORT }
        s.hasUnsavedChanges = false
        s.canUndo = false
        s.canRedo = false
      }),
  })),
)
