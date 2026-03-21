'use client'

import { useCallback, useState } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { VaultLanding } from '@/components/landing/vault-landing'
import { VaultFsProvider, type VaultSessionValue } from '@/contexts/vault-fs-context'
import { useVaultStore } from '@/stores/vault'
import { useUiStore } from '@/stores/ui'
import { ViewMode } from '@/types/vault'
import { setStoredActiveVaultPath } from '@/lib/vault/session-storage'

export function AppRoot() {
  const [session, setSession] = useState<VaultSessionValue | null>(null)

  const handleVaultReady = useCallback((next: VaultSessionValue) => {
    setSession(next)
    const { vaultPath, config } = next
    const store = useVaultStore.getState()
    store.setActiveVaultPath(vaultPath)
    store.setConfig(config)
    store.setOpen(true)
    store.setError(null)
    store.addRecentVault({
      path: vaultPath,
      name: config.name,
      fileCount: 0,
      lastOpened: new Date().toISOString(),
    })
    useUiStore.getState().setActiveView(config.defaultView ?? ViewMode.Notes)
  }, [])

  const handleCloseVault = useCallback(() => {
    setStoredActiveVaultPath(null)
    setSession(null)
    useVaultStore.getState().reset()
    useUiStore.getState().setActiveView(ViewMode.Notes)
  }, [])

  if (!session) {
    return <VaultLanding onVaultReady={handleVaultReady} />
  }

  return (
    <VaultFsProvider value={session}>
      <AppShell onCloseVault={handleCloseVault} />
    </VaultFsProvider>
  )
}
