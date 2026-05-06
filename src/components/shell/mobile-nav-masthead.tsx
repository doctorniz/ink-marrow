'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bookmark,
  CalendarCheck,
  Camera,
  ChevronDown,
  Columns3,
  FileStack,
  FileText,
  Files,
  Layout,
  Menu,
  Mic,
  Monitor,
  Moon,
  Plus,
  LogOut,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Sun,
  Upload,
  Vault,
  LayoutGrid,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNewFileActions } from '@/lib/notes/use-new-file-actions'
import { useUiStore, type ThemeChoice } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { ViewMode, DAILY_NOTES_DIR } from '@/types/vault'
import { openOrCreateDailyNote } from '@/lib/notes/daily-note'
import { cn } from '@/utils/cn'
import { MOBILE_NAV_MEDIA_QUERY } from '@/lib/browser/breakpoints'

type MobileNavEntry =
  | { kind: 'view'; mode: ViewMode; label: string; icon: typeof Vault }
  | { kind: 'todo'; label: string; icon: typeof Vault }

const NAV: MobileNavEntry[] = [
  { kind: 'view', mode: ViewMode.VaultChat,  label: 'Chat',      icon: Sparkles },
  { kind: 'view', mode: ViewMode.Vault,      label: 'Vault',     icon: Vault },
  { kind: 'view', mode: ViewMode.Board,      label: 'Board',     icon: LayoutGrid },
  { kind: 'view', mode: ViewMode.Organizer,  label: 'Organizer', icon: CalendarCheck },
  { kind: 'view', mode: ViewMode.Bookmarks,  label: 'Bookmarks', icon: Bookmark },
  { kind: 'view', mode: ViewMode.Files,      label: 'Files',     icon: Files },
]

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/** Sidebar date pill — opens (or creates) today's daily note on click. */
function DailyNoteDate({ onClose }: { onClose: () => void }) {
  const { vaultFs } = useVaultSession()
  const setActiveView = useUiStore((s) => s.setActiveView)
  const config = useVaultStore((s) => s.config)
  const [busy, setBusy] = useState(false)

  const folder = config?.dailyNotesFolder ?? DAILY_NOTES_DIR
  const enabled = config?.dailyNotesEnabled !== false

  if (!enabled) return null

  const now = new Date()
  const label = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  async function handleClick() {
    if (busy) return
    setBusy(true)
    try {
      const path = await openOrCreateDailyNote(vaultFs, now, folder)
      const { detectEditorTabType, titleFromVaultPath } = await import('@/lib/notes/editor-tab-from-path')
      const type = await detectEditorTabType(vaultFs, path)
      useFileTreeStore.getState().setSelectedPath(path)
      useEditorStore.getState().addRecentFile(path)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path,
        type,
        title: titleFromVaultPath(path),
        isDirty: false,
      })
      setActiveView(ViewMode.Vault)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      title="Open today's daily note"
      className={cn(
        'w-full rounded-lg px-3 py-2 text-center transition-colors',
        'text-fg-secondary hover:bg-sidebar-hover hover:text-fg',
        busy && 'opacity-60',
      )}
    >
      <span className="block truncate text-sm font-medium">{label}</span>
    </button>
  )
}

export function MobileNavMasthead({
  onCloseVault,
  onOpenSettings,
}: {
  onCloseVault: () => void
  onOpenSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [newExpanded, setNewExpanded] = useState(false)
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const config = useVaultStore((s) => s.config)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const closeMenu = useCallback(() => {
    setOpen(false)
    setNewExpanded(false)
  }, [])

  const { createNote, createThought, createDrawing, createKanban, importFiles, busy } =
    useNewFileActions(closeMenu)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setNewExpanded(false)
  }

  useEffect(() => {
    function onOpenNewPopover() {
      if (window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches) {
        setOpen(true)
        setNewExpanded(true)
      }
    }
    window.addEventListener('ink:open-new-popover', onOpenNewPopover)
    return () => window.removeEventListener('ink:open-new-popover', onOpenNewPopover)
  }, [])

  const NEW_ITEMS: { label: string; icon: typeof FileText; accent: string; action: () => void }[] = [
    { label: 'Note',      icon: FileText,   accent: 'text-blue-500',    action: () => void createNote() },
    { label: 'Thought',   icon: StickyNote, accent: 'text-yellow-500',  action: () => void createThought() },
    { label: 'Canvas',    icon: Layout,     accent: 'text-violet-500',  action: () => void createDrawing() },
    { label: 'Kanban',    icon: Columns3,   accent: 'text-amber-500',   action: () => void createKanban() },
    { label: 'Recording', icon: Mic,        accent: 'text-red-500',     action: () => {
      useUiStore.getState().setActiveView(ViewMode.Board)
      setTimeout(() => window.dispatchEvent(new CustomEvent('ink:board-start-recording')), 100)
      closeMenu()
    }},
    { label: 'Photo',     icon: Camera,     accent: 'text-sky-500',     action: () => photoInputRef.current?.click() },
    { label: 'File',      icon: Upload,     accent: 'text-emerald-500', action: () => fileInputRef.current?.click() },
  ]

  return (
    <header className="border-border bg-bg flex shrink-0 items-center gap-2 border-b px-2 py-2 md:hidden">
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-9 shrink-0 p-0"
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden />
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[240] bg-black/40" />
          <Dialog.Content
            className="border-border bg-sidebar-bg fixed top-0 left-0 z-[241] flex h-full w-[min(100vw-2rem,320px)] flex-col border-r shadow-xl outline-none"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Main menu</Dialog.Title>
            <div className="border-border flex items-center gap-2 border-b px-3 py-3">
              <div className="bg-accent-light text-accent flex size-9 shrink-0 items-center justify-center rounded-lg">
                <FileStack className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-fg truncate text-sm font-semibold">Mentis</p>
                <p className="text-fg-tertiary truncate text-xs">{config?.name ?? 'Vault'}</p>
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-9 shrink-0 p-0"
                  aria-label="Close menu"
                >
                  <X className="size-5" />
                </Button>
              </Dialog.Close>
            </div>

            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" aria-label="Main views">
              <DailyNoteDate onClose={closeMenu} />

              {NAV.map((entry) => {
                if (entry.kind === 'todo') {
                  const Icon = entry.icon
                  return (
                    <div
                      key={entry.label}
                      className="text-fg-muted/40 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium select-none cursor-default"
                    >
                      <Icon className="size-5 shrink-0 opacity-50" aria-hidden />
                      <span className="flex-1 truncate">{entry.label}</span>
                      <span className="text-[10px] opacity-60">soon</span>
                    </div>
                  )
                }
                const { mode, label, icon: Icon } = entry
                const vaultModes = [ViewMode.Vault, ViewMode.FileBrowser, ViewMode.Notes]
                const organizerModes = [ViewMode.Tasks, ViewMode.Calendar]
                const active =
                  activeView === mode ||
                  (mode === ViewMode.Vault && vaultModes.includes(activeView)) ||
                  (mode === ViewMode.Organizer && organizerModes.includes(activeView))
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setActiveView(mode)
                      closeMenu()
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent/10 text-accent'
                        : 'text-fg-secondary hover:bg-sidebar-hover hover:text-fg',
                    )}
                  >
                    <Icon className="size-5 shrink-0 opacity-90" aria-hidden />
                    <span className="flex-1 truncate">{label}</span>
                  </button>
                )
              })}

              {/* Hidden file inputs */}
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.currentTarget.value = '' }} />
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.currentTarget.value = '' }} />

              {/* New — inline expand */}
              <button
                type="button"
                onClick={() => setNewExpanded((e) => !e)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                  newExpanded
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-secondary hover:bg-sidebar-hover hover:text-fg',
                )}
              >
                <Plus className={cn('size-5 shrink-0 opacity-90 transition-transform', newExpanded && 'rotate-45')} aria-hidden />
                <span className="flex-1 truncate">New</span>
                <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', newExpanded && 'rotate-180')} aria-hidden />
              </button>

              {newExpanded && (
                <div className="flex flex-col gap-0.5 pl-3">
                  {NEW_ITEMS.map(({ label, icon: Icon, accent, action }) => (
                    <button
                      key={label}
                      type="button"
                      disabled={busy}
                      onClick={action}
                      className="text-fg-secondary hover:bg-sidebar-hover hover:text-fg flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-40"
                    >
                      <Icon className={cn('size-4 shrink-0', accent)} aria-hidden />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </nav>

            <div className="border-border mt-auto border-t p-2">
              <div className="bg-bg-tertiary mb-1 flex rounded-lg p-0.5" role="radiogroup" aria-label="Theme">
                {THEMES.map(({ value, label: themeLabel, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    aria-label={themeLabel}
                    title={themeLabel}
                    onClick={() => setTheme(value)}
                    className={cn(
                      'flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors',
                      theme === value
                        ? 'bg-bg text-fg shadow-sm'
                        : 'text-fg-tertiary hover:text-fg-secondary',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                className="text-fg-secondary hover:text-fg h-9 w-full justify-start gap-3 px-3"
                onClick={() => {
                  closeMenu()
                  onOpenSettings()
                }}
                aria-label="Open settings"
              >
                <Settings className="size-5 shrink-0" />
                Settings
              </Button>
              <Button
                variant="ghost"
                className="text-fg-secondary hover:text-fg h-9 w-full justify-start gap-3 px-3"
                onClick={() => {
                  closeMenu()
                  onCloseVault()
                }}
              >
                <LogOut className="size-5 shrink-0" />
                Close vault
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="bg-accent-light text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
        <FileStack className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-fg truncate text-sm font-semibold">Mentis</p>
        <p className="text-fg-tertiary truncate text-xs">{config?.name ?? 'Vault'}</p>
      </div>
    </header>
  )
}
