import type { StrokePoint } from '@/types/canvas'

/* ------------------------------------------------------------------ */
/*  2D point helpers                                                   */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number
  y: number
}

export function distanceBetween(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/* ------------------------------------------------------------------ */
/*  Catmull-Rom spline                                                 */
/* ------------------------------------------------------------------ */

/**
 * Evaluate a point on a Catmull-Rom spline defined by four control points.
 * `t` ranges from 0 (at p1) to 1 (at p2).
 */
export function catmullRomPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

/* ------------------------------------------------------------------ */
/*  Velocity                                                           */
/* ------------------------------------------------------------------ */

export function velocityBetween(a: StrokePoint, b: StrokePoint): number {
  const dt = b.timestamp - a.timestamp
  if (dt <= 0) return 0
  return distanceBetween(a, b) / dt
}

/* ------------------------------------------------------------------ */
/*  Stroke interpolation with spacing                                  */
/* ------------------------------------------------------------------ */

export interface InterpolatedStamp {
  x: number
  y: number
  pressure: number
}

/**
 * Given a list of raw stroke points, produce evenly-spaced stamp positions
 * using Catmull-Rom interpolation. `spacingPx` is the distance between stamps.
 *
 * Returns an array of stamps (position + interpolated pressure).
 */
export function interpolateStroke(
  points: StrokePoint[],
  spacingPx: number,
): InterpolatedStamp[] {
  if (points.length === 0) return []
  if (points.length === 1) {
    return [{ x: points[0].x, y: points[0].y, pressure: points[0].pressure }]
  }

  const stamps: InterpolatedStamp[] = []
  let distAccum = 0

  for (let i = 0; i < points.length - 1; i++) {
    // Build 4-point window for Catmull-Rom (mirror at edges)
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const segLen = distanceBetween(p1, p2)
    if (segLen < 0.01) continue

    // Walk along the segment, placing stamps every spacingPx
    const steps = Math.ceil(segLen / spacingPx) * 4 // oversample for accuracy
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const pt = catmullRomPoint(p0, p1, p2, p3, t)
      const press = lerp(p1.pressure, p2.pressure, t)

      if (stamps.length === 0) {
        stamps.push({ x: pt.x, y: pt.y, pressure: press })
        distAccum = 0
        continue
      }

      const last = stamps[stamps.length - 1]
      const d = distanceBetween(last, pt)
      distAccum += d

      if (distAccum >= spacingPx) {
        stamps.push({ x: pt.x, y: pt.y, pressure: press })
        distAccum = 0
      }
    }
  }

  return stamps
}
