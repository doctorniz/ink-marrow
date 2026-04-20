'use client'

/**
 * Unified editor right-column layout.
 *
 * Hosts the chat panel and (optionally) a collapsible backlinks
 * section in a single resizable column. When the user collapses
 * backlinks, chat "rises to the top" and fills the remaining height.
 *
 *   chat present + trailing present → chat flex-1, trailing at bottom
 *   chat present + trailing null    → chat fills the column
 *   chat null    + trailing present → trailing fills the column
 *   chat null    + trailing null    → column hidden (left fills width)
 *
 * The column's width is controlled by a draggable divider
 * (ResizableSplit) whose value is persisted in localStorage by
 * `storageKey` — pass distinct keys per surface (markdown vs. pdf) so
 * each remembers its own width.
 */

import { type ReactNode } from 'react'
import { ResizableSplit } from '@/components/ui/resizable-split'

export interface EditorRightColumnProps {
  /** The editor (markdown note / pdf viewer). */
  children: ReactNode
  /** Chat panel content — `null` removes the chat section. */
  chat: ReactNode | null
  /** Optional collapsible section (usually <BacklinksSection />). */
  trailing?: ReactNode
  /** Width persistence key; separate keys let md/pdf remember distinct widths. */
  storageKey: string
  /** Default right-column width when no saved value exists. */
  defaultRightPx?: number
  /** Minimum right-column width before the divider refuses further drag. */
  minRightPx?: number
  /** Cap on the right-column width as a fraction of the container. */
  maxRightRatio?: number
}

export function EditorRightColumn({
  children,
  chat,
  trailing,
  storageKey,
  defaultRightPx = 420,
  minRightPx = 220,
  maxRightRatio = 0.6,
}: EditorRightColumnProps) {
  const rightHasContent = chat != null || trailing != null

  return (
    <ResizableSplit
      storageKey={storageKey}
      defaultRightPx={defaultRightPx}
      minRightPx={minRightPx}
      maxRightRatio={maxRightRatio}
      collapsed={!rightHasContent}
      left={children}
      right={
        rightHasContent ? (
          <div className="bg-bg flex h-full min-h-0 w-full flex-col">
            {chat != null && <div className="min-h-0 flex-1">{chat}</div>}
            {trailing}
          </div>
        ) : null
      }
    />
  )
}
