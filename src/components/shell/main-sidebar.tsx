'use client'

import {
  FileStack,
  FolderOpen,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  PlusCircle,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { ViewMode } from '@/types/vault'
import { cn } from '@/utils/cn'

const NAV: { mode: ViewMode; label: string; icon: typeof FolderOpen; shortcut: string }[] = [
  { mode: ViewMode.FileBrowser, label: 'File Browser', icon: LayoutGrid, shortcut: '1' },
  { mode: ViewMode.Notes, label: 'Notes', icon: FolderOpen, shortcut: '2' },
  { mode: ViewMode.Search, label: 'Search', icon: Search, shortcut: '3' },
  { mode: ViewMode.New, label: 'New', icon: PlusCircle, shortcut: '4' },
]

export function MainSidebar({ onCloseVault }: { onCloseVault: () => void }) {
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const isOpen = useUiStore((s) => s.isSidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const config = useVaultStore((s) => s.config)

  if (!isOpen) {
    return (
      <div className="border-border bg-sidebar-bg flex w-12 flex-col items-center border-r py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
        >
          <PanelLeft className="size-5" />
        </Button>
      </div>
    )
  }

  return (
    <aside
      className="border-border bg-sidebar-bg flex h-full shrink-0 flex-col border-r"
      style={{ width: sidebarWidth }}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-3">
        <div className="bg-accent-light text-accent flex size-9 shrink-0 items-center justify-center rounded-lg">
          <FileStack className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-fg truncate text-sm font-semibold">Ink</p>
          <p className="text-fg-tertiary truncate text-xs">{config?.name ?? 'Vault'}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0"
          onClick={toggleSidebar}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-5" />
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Main views">
        {NAV.map(({ mode, label, icon: Icon, shortcut }) => {
          const active = activeView === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveView(mode)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
                active
                  ? 'bg-accent-light text-accent'
                  : 'text-fg-secondary hover:bg-sidebar-hover hover:text-fg',
              )}
            >
              <Icon className="size-5 shrink-0 opacity-90" aria-hidden />
              <span className="flex-1 truncate">{label}</span>
              <kbd className="text-fg-muted hidden font-mono text-[10px] sm:inline">
                ⌃{shortcut}
              </kbd>
            </button>
          )
        })}
      </nav>

      <div className="border-border mt-auto border-t p-2">
        <Button
          variant="ghost"
          className="text-fg-secondary hover:text-fg h-10 w-full justify-start gap-3 px-3"
          onClick={onCloseVault}
        >
          <LogOut className="size-5 shrink-0" />
          Close vault
        </Button>
      </div>
    </aside>
  )
}
