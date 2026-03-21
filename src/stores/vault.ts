import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { VaultConfig, VaultMetadata } from '@/types/vault'

interface VaultState {
  /** OPFS path from root, e.g. `vaults/my-vault-abc123` */
  activeVaultPath: string | null
  isOpen: boolean
  config: VaultConfig | null
  metadata: VaultMetadata | null
  recentVaults: VaultMetadata[]
  isLoading: boolean
  error: string | null

  setActiveVaultPath: (path: string | null) => void
  setConfig: (config: VaultConfig) => void
  setMetadata: (metadata: VaultMetadata) => void
  setOpen: (isOpen: boolean) => void
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  addRecentVault: (metadata: VaultMetadata) => void
  reset: () => void
}

export const useVaultStore = create<VaultState>()(
  immer((set) => ({
    activeVaultPath: null,
    isOpen: false,
    config: null,
    metadata: null,
    recentVaults: [],
    isLoading: false,
    error: null,

    setActiveVaultPath: (path) =>
      set((state) => {
        state.activeVaultPath = path
      }),

    setConfig: (config) =>
      set((state) => {
        state.config = config
      }),

    setMetadata: (metadata) =>
      set((state) => {
        state.metadata = metadata
      }),

    setOpen: (isOpen) =>
      set((state) => {
        state.isOpen = isOpen
      }),

    setLoading: (isLoading) =>
      set((state) => {
        state.isLoading = isLoading
      }),

    setError: (error) =>
      set((state) => {
        state.error = error
      }),

    addRecentVault: (metadata) =>
      set((state) => {
        state.recentVaults = [
          metadata,
          ...state.recentVaults.filter((v) => v.path !== metadata.path),
        ].slice(0, 10)
      }),

    reset: () =>
      set((state) => {
        state.activeVaultPath = null
        state.isOpen = false
        state.config = null
        state.metadata = null
        state.isLoading = false
        state.error = null
      }),
  })),
)
