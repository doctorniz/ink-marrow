'use client'

import type { ReactNode } from 'react'
import { useUiStore } from '@/stores/ui'
import { ViewMode } from '@/types/vault'
import { VaultView } from '@/components/views/vault-view'
import { FilesView } from '@/components/views/files-view'
import { SearchView } from '@/components/views/search-view'
import { GraphView } from '@/components/views/graph-view'
import { BoardView } from '@/components/views/board-view'
import { TasksView } from '@/components/views/tasks-view'
import { BookmarksView } from '@/components/views/bookmarks-view'
import { NewView } from '@/components/views/new-view'
import { CalendarView } from '@/components/views/calendar-view'
import { VaultChatView } from '@/components/views/vault-chat-view'

export function ViewRouter() {
  const activeView = useUiStore((s) => s.activeView)

  let body: ReactNode
  switch (activeView) {
    case ViewMode.VaultChat:
      body = <VaultChatView />
      break
    case ViewMode.Vault:
    // legacy routes — redirect into the vault (notes) view
    case ViewMode.FileBrowser:
    case ViewMode.Notes:
      body = <VaultView />
      break
    case ViewMode.Files:
      body = <FilesView />
      break
    case ViewMode.Search:
      body = <SearchView />
      break
    case ViewMode.Graph:
      body = <GraphView />
      break
    case ViewMode.Board:
      body = <BoardView />
      break
    case ViewMode.Tasks:
      body = <TasksView />
      break
    case ViewMode.Bookmarks:
      body = <BookmarksView />
      break
    case ViewMode.New:
      body = <NewView />
      break
    case ViewMode.Calendar:
      body = <CalendarView />
      break
    default:
      body = <VaultView />
  }

  return <div className="flex h-full min-h-0 flex-1 flex-col">{body}</div>
}
