'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/utils/cn'

/**
 * Two-pane horizontal split with a draggable divider between them.
 *
 * - Right pane width is pointer-driven and persisted to localStorage by
 *   `storageKey`, so it survives reloads and panel re-opens.
 * - Width is stored in pixels rather than percentage so the chat column
 *   doesn't expand/shrink weirdly as the parent resizes. We clamp at
 *   `minRight` / `maxRightRatio` on every render and on resize.
 * - The left pane is flex-1 so it always soaks up the remainder and
 *   never reports negative width.
 *
 * Collapsing: when `collapsed` is true the right pane is unmounted and
 * the divider hidden. This lets a toolbar toggle mount/unmount the chat
 * panel without the split component needing its own state.
 */
interface ResizableSplitProps {
  left: ReactNode
  right: ReactNode
  /** Initial / default width of the right pane in px. */
  defaultRightPx?: number
  /** Minimum width the right pane can be dragged to, in px. */
  minRightPx?: number
  /** Maximum right-pane size as a fraction of the container (0..1). */
  maxRightRatio?: number
  /** localStorage key for persisted width; omit to skip persistence. */
  storageKey?: string
  /** Hide right pane and divider. */
  collapsed?: boolean
  className?: string
}

export function ResizableSplit({
  left,
  right,
  defaultRightPx = 380,
  minRightPx = 280,
  maxRightRatio = 0.7,
  storageKey,
  collapsed = false,
  className,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rightPx, setRightPx] = useState<number>(() => {
    if (typeof window === 'undefined' || !storageKey) return defaultRightPx
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultRightPx
  })
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)

  const clamp = useCallback(
    (px: number): number => {
      const el = containerRef.current
      if (!el) return Math.max(minRightPx, px)
      const total = el.clientWidth
      const max = Math.max(minRightPx, Math.floor(total * maxRightRatio))
      return Math.min(Math.max(minRightPx, px), max)
    },
    [minRightPx, maxRightRatio],
  )

  // Re-clamp when the container resizes (window resize, pane toggle).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setRightPx((cur) => clamp(cur))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [clamp])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, String(rightPx))
  }, [rightPx, storageKey])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = rect.right - e.clientX
      setRightPx(clamp(next))
    },
    [clamp],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer may have already been released */
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn('relative flex min-h-0 min-w-0 flex-1', className)}
    >
      <div className="flex min-h-0 min-w-0 flex-1">{left}</div>

      {!collapsed && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              'group relative z-10 w-1 cursor-col-resize shrink-0 select-none',
              'bg-border hover:bg-accent/60 transition-colors',
              dragging && 'bg-accent',
            )}
          >
            {/* Widen the hit target without visually taking space. */}
            <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>

          <div
            className="flex min-h-0 shrink-0 flex-col"
            style={{ width: `${rightPx}px` }}
          >
            {right}
          </div>
        </>
      )}
    </div>
  )
}
