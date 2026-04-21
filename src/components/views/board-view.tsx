'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Plus } from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { ThoughtCard } from '@/components/board/thought-card'
import { BOARD_ASSETS_DIR } from '@/lib/board'
import { useBoardStore } from '@/stores/board'
import type { ThoughtColor } from '@/types/board'
import { THOUGHT_COLORS } from '@/types/board'
import { cn } from '@/utils/cn'

const COLOR_DOT: Record<ThoughtColor, string> = {
  yellow: 'bg-amber-400',
  blue: 'bg-sky-400',
  pink: 'bg-pink-400',
  green: 'bg-emerald-400',
  purple: 'bg-violet-400',
  white: 'bg-zinc-300 dark:bg-zinc-600',
}

function ColorPickerPopover({
  open,
  onPick,
  onClose,
}: {
  open: boolean
  onPick: (color: ThoughtColor) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="border-border bg-bg absolute top-full right-0 z-20 mt-1 flex gap-1.5 rounded-lg border p-2 shadow-lg"
    >
      {THOUGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => { onPick(c); onClose() }}
          className={cn('size-6 rounded-full border-2 border-transparent transition-transform hover:scale-110', COLOR_DOT[c])}
          aria-label={`${c} thought`}
        />
      ))}
    </div>
  )
}

export function BoardView() {
  const { vaultFs } = useVaultSession()
  const items = useBoardStore((s) => s.items)
  const loading = useBoardStore((s) => s.loading)
  const loadBoard = useBoardStore((s) => s.loadBoard)
  const addThought = useBoardStore((s) => s.addThought)
  const updateItem = useBoardStore((s) => s.updateItem)
  const setActiveItem = useBoardStore((s) => s.setActiveItem)

  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadBoard(vaultFs)
  }, [vaultFs, loadBoard])

  const handleAdd = useCallback(
    (color?: ThoughtColor) => {
      void addThought(vaultFs, color)
    },
    [vaultFs, addThought],
  )

  const handleImageUpload = useCallback(
    async (file: File) => {
      const exists = await vaultFs.exists(BOARD_ASSETS_DIR)
      if (!exists) {
        await vaultFs.mkdir(BOARD_ASSETS_DIR)
      }

      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
      const ts = Date.now().toString(36)
      const rand = Math.random().toString(36).slice(2, 6)
      const assetName = `${ts}-${rand}.${ext}`
      const assetPath = `${BOARD_ASSETS_DIR}/${assetName}`

      const buf = await file.arrayBuffer()
      await vaultFs.writeFile(assetPath, new Uint8Array(buf))

      const item = await addThought(vaultFs, 'white')
      const titleLine = file.name.replace(/\.[^.]+$/, '')
      const body = `\n# ${titleLine}\n\n![${titleLine}](${assetPath})\n`
      await updateItem(vaultFs, item.path, body)
      setActiveItem(null)
    },
    [vaultFs, addThought, updateItem, setActiveItem],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleImageUpload(file)
      e.target.value = ''
    },
    [handleImageUpload],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="border-border bg-bg-secondary flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <h1 className="text-fg text-sm font-semibold">Board</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-fg-secondary hover:text-fg border-border hover:bg-bg-tertiary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            aria-label="Add image to board"
          >
            <ImagePlus className="size-3.5" />
            Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => handleAdd('yellow')}
              onContextMenu={(e) => {
                e.preventDefault()
                setColorPickerOpen(true)
              }}
              className="bg-accent text-accent-fg hover:bg-accent/90 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              aria-label="Add thought"
              title="Click to add, right-click for color"
            >
              <Plus className="size-3.5" />
              Thought
            </button>
            <ColorPickerPopover
              open={colorPickerOpen}
              onPick={handleAdd}
              onClose={() => setColorPickerOpen(false)}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-fg-muted size-6 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <p className="text-fg-muted text-sm">Your board is empty.</p>
            <button
              type="button"
              onClick={() => handleAdd('yellow')}
              className="bg-accent text-accent-fg hover:bg-accent/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              Add a thought
            </button>
          </div>
        ) : (
          <div className="p-4" style={{ columns: '280px', columnGap: '12px' }}>
            {items.map((item) => (
              <ThoughtCard key={item.path} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
