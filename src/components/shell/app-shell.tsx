'use client'

import { useEffect, useState } from 'react'
import { MainSidebar } from '@/components/shell/main-sidebar'
import { MobileNavMasthead } from '@/components/shell/mobile-nav-masthead'
import { ViewRouter } from '@/components/shell/view-router'
import { VaultSearchBootstrap } from '@/components/search/vault-search-bootstrap'
import { KeyboardShortcutsDialog } from '@/components/shell/keyboard-shortcuts-dialog'
import { SettingsDialog } from '@/components/shell/settings-dialog'
import { useUiStore } from '@/stores/ui'
import { useEditorStore } from '@/stores/editor'
import { usePdfStore } from '@/stores/pdf'
import { useCanvasStore } from '@/stores/canvas'
import { ViewMode } from '@/types/vault'

const VIEW_BY_DIGIT: Record<string, ViewMode> = {
  '0': ViewMode.VaultChat,
  '1': ViewMode.Vault,
  '2': ViewMode.Board,
  '3': ViewMode.Tasks,
  '4': ViewMode.Bookmarks,
  '5': ViewMode.Calendar,
  '6': ViewMode.Graph,
  '7': ViewMode.Files,
  '8': ViewMode.Search,
}

export function AppShell({ onCloseVault }: { onCloseVault: () => void }) {
  const setActiveView = useUiStore((s) => s.setActiveView)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const hasDirtyTabs = useEditorStore.getState().tabs.some((t) => t.isDirty)
      const hasDirtyPdf = usePdfStore.getState().hasUnsavedChanges
      const hasDirtyCanvas = useCanvasStore.getState().hasUnsavedChanges
      if (hasDirtyTabs || hasDirtyPdf || hasDirtyCanvas) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.shiftKey && e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
        return
      }

      if (!mod) return

      if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        setSettingsOpen((o) => !o)
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('ink:open-new-popover'))
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setActiveView(ViewMode.Search)
        return
      }

      const view = VIEW_BY_DIGIT[e.key]
      if (view) {
        e.preventDefault()
        setActiveView(view)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setActiveView, toggleSidebar])

  return (
    <div className="bg-bg flex h-screen w-full overflow-hidden">
      <MainSidebar
        onCloseVault={onCloseVault}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="bg-bg-secondary flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNavMasthead
          onCloseVault={onCloseVault}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <VaultSearchBootstrap />
        <ViewRouter />
      </main>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
