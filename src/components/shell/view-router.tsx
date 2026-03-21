'use client'

import { useUiStore } from '@/stores/ui'
import { ViewMode } from '@/types/vault'
import { FileBrowserView } from '@/components/views/file-browser-view'
import { NotesView } from '@/components/views/notes-view'
import { SearchView } from '@/components/views/search-view'
import { NewView } from '@/components/views/new-view'

export function ViewRouter() {
  const activeView = useUiStore((s) => s.activeView)

  switch (activeView) {
    case ViewMode.FileBrowser:
      return <FileBrowserView />
    case ViewMode.Notes:
      return <NotesView />
    case ViewMode.Search:
      return <SearchView />
    case ViewMode.New:
      return <NewView />
    default:
      return <NotesView />
  }
}
