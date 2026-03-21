'use client'

import { useEffect } from 'react'
import { MainSidebar } from '@/components/shell/main-sidebar'
import { ViewRouter } from '@/components/shell/view-router'
import { useUiStore } from '@/stores/ui'
import { ViewMode } from '@/types/vault'

const VIEW_BY_DIGIT: Record<string, ViewMode> = {
  '1': ViewMode.FileBrowser,
  '2': ViewMode.Notes,
  '3': ViewMode.Search,
  '4': ViewMode.New,
}

export function AppShell({ onCloseVault }: { onCloseVault: () => void }) {
  const setActiveView = useUiStore((s) => s.setActiveView)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        toggleSidebar()
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
      <MainSidebar onCloseVault={onCloseVault} />
      <main className="bg-bg-secondary min-w-0 flex-1 overflow-auto">
        <ViewRouter />
      </main>
    </div>
  )
}
