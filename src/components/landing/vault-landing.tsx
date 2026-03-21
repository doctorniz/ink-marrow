'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileStack, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getFileSystemAdapter, createScopedAdapter } from '@/lib/fs'
import type { FileSystemAdapter } from '@/lib/fs'
import { bootstrapNewVault, loadVaultConfig } from '@/lib/vault'
import { discoverVaults } from '@/lib/vault/discover'
import {
  getStoredActiveVaultPath,
  setStoredActiveVaultPath,
} from '@/lib/vault/session-storage'
import type { VaultConfig } from '@/types/vault'
import { isVault } from '@/lib/vault'

export interface VaultLandingProps {
  onVaultReady: (session: {
    rootFs: FileSystemAdapter
    vaultFs: FileSystemAdapter
    vaultPath: string
    config: VaultConfig
  }) => void
}

export function VaultLanding({ onVaultReady }: VaultLandingProps) {
  const [name, setName] = useState('My Vault')
  const [vaults, setVaults] = useState<{ path: string; displayName: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshList = useCallback(async (root: FileSystemAdapter) => {
    const list = await discoverVaults(root)
    setVaults(list.map((v) => ({ path: v.path, displayName: v.displayName })))
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      setError(null)
      try {
        const root = await getFileSystemAdapter()
        await root.init()
        if (cancelled) return
        await refreshList(root)

        const stored = getStoredActiveVaultPath()
        if (stored) {
          const scoped = createScopedAdapter(root, stored)
          if (await isVault(scoped)) {
            const config = await loadVaultConfig(scoped)
            if (!cancelled) {
              onVaultReady({
                rootFs: root,
                vaultFs: scoped,
                vaultPath: stored,
                config,
              })
              return
            }
          } else {
            setStoredActiveVaultPath(null)
          }
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof Error
              ? e.message
              : 'Could not access local storage. Try a Chromium-based browser with OPFS support.'
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [onVaultReady, refreshList])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const root = await getFileSystemAdapter()
      await root.init()
      const { vaultPath, config } = await bootstrapNewVault(root, name.trim() || 'My Vault')
      const vaultFs = createScopedAdapter(root, vaultPath)
      setStoredActiveVaultPath(vaultPath)
      await refreshList(root)
      onVaultReady({ rootFs: root, vaultFs, vaultPath, config })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vault')
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen(path: string) {
    setBusy(true)
    setError(null)
    try {
      const root = await getFileSystemAdapter()
      await root.init()
      const vaultFs = createScopedAdapter(root, path)
      if (!(await isVault(vaultFs))) {
        setError('That folder is not a valid Ink vault.')
        return
      }
      const config = await loadVaultConfig(vaultFs)
      setStoredActiveVaultPath(path)
      onVaultReady({ rootFs: root, vaultFs, vaultPath: path, config })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open vault')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="text-accent size-10 animate-spin" aria-hidden />
        <p className="text-fg-secondary text-sm">Opening local storage…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="bg-accent-light text-accent mb-4 flex size-16 items-center justify-center rounded-2xl">
            <FileStack className="size-9" />
          </div>
          <h1 className="text-fg text-3xl font-bold tracking-tight">Ink by Marrow</h1>
          <p className="text-fg-secondary mt-2 text-sm leading-relaxed">
            Local-first notes and PDFs. Your vault lives in this browser&apos;s private
            storage (OPFS).
          </p>
        </div>

        {error && (
          <div
            className="border-danger/30 bg-danger/5 text-danger mb-6 rounded-lg border px-4 py-3 text-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="mb-10 space-y-4">
          <label className="block">
            <span className="text-fg-secondary mb-1.5 block text-xs font-medium uppercase tracking-wide">
              New vault
            </span>
            <input
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="Vault name"
              className="border-border-strong focus:border-accent focus:ring-accent/20 bg-bg text-fg placeholder:text-fg-muted w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm focus:ring-2 focus:outline-none"
              disabled={busy}
            />
          </label>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Working…
              </>
            ) : (
              'Create vault'
            )}
          </Button>
        </form>

        {vaults.length > 0 && (
          <div>
            <h2 className="text-fg-secondary mb-3 text-xs font-semibold tracking-wide uppercase">
              Open existing
            </h2>
            <ul className="border-border divide-border max-h-64 divide-y overflow-auto rounded-lg border">
              {vaults.map((v) => (
                <li key={v.path}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleOpen(v.path)}
                    className="hover:bg-bg-hover text-fg flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <span className="truncate">{v.displayName}</span>
                    <span className="text-fg-muted ml-2 shrink-0 font-mono text-xs">
                      {v.path.replace(/^vaults\//, '')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
