'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { FileSystemAdapter } from '@/lib/fs'
import type { VaultConfig } from '@/types/vault'

export interface VaultSessionValue {
  rootFs: FileSystemAdapter
  vaultFs: FileSystemAdapter
  vaultPath: string
  config: VaultConfig
}

const VaultFsContext = createContext<VaultSessionValue | null>(null)

export function VaultFsProvider({
  value,
  children,
}: {
  value: VaultSessionValue
  children: ReactNode
}) {
  return <VaultFsContext.Provider value={value}>{children}</VaultFsContext.Provider>
}

export function useVaultSession(): VaultSessionValue {
  const ctx = useContext(VaultFsContext)
  if (!ctx) {
    throw new Error('useVaultSession must be used within VaultFsProvider')
  }
  return ctx
}

export function useVaultSessionOptional(): VaultSessionValue | null {
  return useContext(VaultFsContext)
}
