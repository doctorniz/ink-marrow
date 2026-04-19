import type { BrushSettings, ViewportState } from '@/types/canvas'

export const DEFAULT_CANVAS_WIDTH = 2048
export const DEFAULT_CANVAS_HEIGHT = 2048
export const DEFAULT_BACKGROUND = '#ffffff'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 10

export const MAX_UNDO_ENTRIES = 30
export const MAX_LAYERS = 12

export const AUTO_SAVE_DELAY_MS = 3_000

export const DEFAULT_BRUSH: BrushSettings = {
  size: 6,
  opacity: 1,
  hardness: 0.8,
  spacing: 0.15,
  color: '#212529',
}

export const DEFAULT_VIEWPORT: ViewportState = { x: 0, y: 0, zoom: 1 }

export const COLOR_SWATCHES = [
  '#212529', '#495057', '#adb5bd', '#ffffff',
  '#e03131', '#f08c00', '#ffd43b', '#40c057',
  '#1c7ed6', '#7950f2', '#e64980', '#20c997',
  '#845ef7', '#fd7e14', '#ffe066', '#69db7c',
  '#339af0', '#be4bdb', '#ff6b6b', '#a9e34b',
]

/**
 * Blend modes that the PixiJS v8 WebGL renderer handles reliably on a
 * `Sprite.blendMode` — either GL-native (normal, multiply, screen) or via
 * the advanced-blend fragment-shader path.
 */
export const STANDARD_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
] as const

/**
 * HSL compositing modes. PixiJS v8 does *not* implement these on
 * `Sprite.blendMode` under all WebGL backends — applying one may silently
 * fall back to `normal`. We keep them in the selectable list so advanced
 * users who want to try them can, but the UI groups them under a
 * "may fall back to Normal" label so the silent-fallback surprise is
 * removed. A proper implementation requires a filter-backed composite
 * pass, which is deferred.
 */
export const HSL_BLEND_MODES = [
  'luminosity',
  'color',
  'saturation',
] as const

/**
 * Legacy flat list — kept so callers that only need to validate stored
 * blend-mode strings don't have to know about the standard/HSL split.
 * UI that renders the dropdown should prefer `STANDARD_BLEND_MODES` +
 * `HSL_BLEND_MODES` to surface the fallback caveat to the user.
 */
export const BLEND_MODES = [
  ...STANDARD_BLEND_MODES,
  ...HSL_BLEND_MODES,
] as const
