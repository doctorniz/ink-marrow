/**
 * Iterative scanline flood fill on an RGBA8 pixel buffer.
 *
 * Implementation notes:
 *
 * - This is Smith's "span filling" variant: at each seed we walk the
 *   entire horizontal run of matching pixels in one pass and only
 *   push new seeds for contiguous matching runs in the row above and
 *   below. Compared with a naive 4-way recursive fill this avoids
 *   repeatedly re-testing pixels already inside the run and keeps the
 *   stack small (O(perimeter), not O(area)).
 *
 * - Iterative, not recursive — on a 2048×2048 layer a recursive fill
 *   would blow the JS call stack within a few seconds of sustained
 *   filling. The explicit number-stack also avoids object allocations
 *   per seed.
 *
 * - We match the *target* colour (the RGBA at the clicked pixel)
 *   exactly. No tolerance — a tolerance slider can be layered on top
 *   by changing `matches()` to a distance check.
 *
 * - If the fill colour is byte-for-byte identical to the target we
 *   return early. Otherwise the "paint every matching pixel" loop
 *   would never terminate on a seed that's already been painted,
 *   because post-paint the pixel still "matches" the new target.
 *
 * The pixel buffer is mutated in place.
 */
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillR: number,
  fillG: number,
  fillB: number,
  fillA: number,
): boolean {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false

  const idx = (x: number, y: number) => (y * width + x) * 4

  const si = idx(startX, startY)
  const tR = pixels[si]
  const tG = pixels[si + 1]
  const tB = pixels[si + 2]
  const tA = pixels[si + 3]

  // No-op: clicking on a pixel that already matches the fill colour.
  if (tR === fillR && tG === fillG && tB === fillB && tA === fillA) return false

  const matches = (i: number): boolean =>
    pixels[i] === tR
    && pixels[i + 1] === tG
    && pixels[i + 2] === tB
    && pixels[i + 3] === tA

  const paint = (i: number): void => {
    pixels[i] = fillR
    pixels[i + 1] = fillG
    pixels[i + 2] = fillB
    pixels[i + 3] = fillA
  }

  // Stack of [x, y] seeds, stored as flat numbers to avoid allocation.
  const stack: number[] = [startX, startY]

  while (stack.length > 0) {
    const y = stack.pop()!
    const x = stack.pop()!

    // Walk left from the seed to find the leftmost matching pixel in
    // this row. The seed itself may already be painted (a neighbour
    // of an earlier run pushed it before reaching it in that run); in
    // that case `matches` fails at x and we skip the row.
    let xl = x
    while (xl >= 0 && matches(idx(xl, y))) xl--
    xl++
    if (xl > x) continue // seed was already painted

    // Walk rightward, painting and tracking whether we're currently
    // inside an above/below run so we push at most one seed per run.
    let spanAbove = false
    let spanBelow = false

    for (let xr = xl; xr < width && matches(idx(xr, y)); xr++) {
      paint(idx(xr, y))

      if (y > 0) {
        const aboveMatch = matches(idx(xr, y - 1))
        if (!spanAbove && aboveMatch) {
          stack.push(xr, y - 1)
          spanAbove = true
        } else if (spanAbove && !aboveMatch) {
          spanAbove = false
        }
      }

      if (y < height - 1) {
        const belowMatch = matches(idx(xr, y + 1))
        if (!spanBelow && belowMatch) {
          stack.push(xr, y + 1)
          spanBelow = true
        } else if (spanBelow && !belowMatch) {
          spanBelow = false
        }
      }
    }
  }

  return true
}

/**
 * Convert `#rrggbb` + opacity (0–1) to a 4-tuple of 0–255 channels.
 * Alpha is the opacity mapped to a byte; we do *not* pre-multiply RGB
 * because ImageData is stored as straight (non-premultiplied) RGBA.
 */
export function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  return [r, g, b, a]
}

/** Convert 0–255 RGB channels to lowercase `#rrggbb`. Alpha is dropped. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const to2 = (v: number) => clamp(v).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}
