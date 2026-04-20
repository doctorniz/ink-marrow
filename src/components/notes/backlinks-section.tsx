'use client'

/**
 * Collapsible backlinks section, designed to sit inside the unified
 * right-side column alongside the chat panel.
 *
 * Distinct from `BacklinksPanel` (which owns its own 200px / 40px-rail
 * column): this one renders as a stacked section — a header bar with a
 * chevron + count that toggles the list below. When `collapsed`, only
 * the header shows so the chat panel above can use the remaining
 * vertical space.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react'
import type { FileSystemAdapter } from '@/lib/fs'
import { findBacklinksForNote } from '@/lib/notes/backlinks'
import { cn } from '@/utils/cn'

export function BacklinksSection({
  vaultFs,
  markdownPaths,
  activeNotePath,
  scanPulse,
  onOpenNote,
  collapsed,
  onCollapsedChange,
  maxExpandedHeightClass = 'max-h-[40%]',
}: {
  vaultFs: FileSystemAdapter
  markdownPaths: string[]
  activeNotePath: string | null
  scanPulse: number
  onOpenNote: (path: string) => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
  /** Tailwind class cap on the expanded list; default 40% of container. */
  maxExpandedHeightClass?: string
}) {
  const [backlinks, setBacklinks] = useState<
    Awaited<ReturnType<typeof findBacklinksForNote>>
  >([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeNotePath) {
      setBacklinks([])
      setBusy(false)
      return
    }
    let cancelled = false
    setBusy(true)
    void findBacklinksForNote(vaultFs, markdownPaths, activeNotePath).then(
      (hits) => {
        if (!cancelled) {
          setBacklinks(hits)
          setBusy(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [vaultFs, markdownPaths, activeNotePath, scanPulse])

  // When expanded with `flex-1` (no-chat case) we need to GROW to fill
  // the column, so we must not apply `shrink-0`. In every other case
  // (collapsed header-only, or expanded with a capped max-height) we
  // want to hold our natural height and let a flex sibling (the chat
  // panel) take the remainder — `shrink-0` protects us there.
  const growsToFill = !collapsed && maxExpandedHeightClass === 'flex-1'

  return (
    <section
      className={cn(
        'border-border flex flex-col border-t',
        growsToFill ? 'flex-1 min-h-0' : 'shrink-0',
        collapsed ? 'h-auto' : maxExpandedHeightClass,
      )}
      aria-label="Backlinks"
    >
      <button
        type="button"
        onClick={() => onCollapsedChange(!collapsed)}
        className="hover:bg-bg-hover flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="text-fg-muted size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="text-fg-muted size-3.5 shrink-0" aria-hidden />
        )}
        <Link2 className="text-fg-muted size-3.5 shrink-0" aria-hidden />
        <span className="text-fg-secondary min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide uppercase">
          Backlinks
        </span>
        {backlinks.length > 0 && (
          <span className="bg-accent/10 text-accent shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
            {backlinks.length}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {busy ? (
            <p className="text-fg-muted px-2 py-3 text-center text-xs">
              Scanning…
            </p>
          ) : backlinks.length === 0 ? (
            <p className="text-fg-muted px-2 py-3 text-center text-xs leading-relaxed">
              {activeNotePath
                ? 'No notes link here yet.'
                : 'Open a note to see backlinks.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {backlinks.map((b) => (
                <li key={b.path}>
                  <button
                    type="button"
                    onClick={() => onOpenNote(b.path)}
                    className={cn(
                      'hover:bg-bg-hover text-fg w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                      'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
                    )}
                  >
                    {b.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
