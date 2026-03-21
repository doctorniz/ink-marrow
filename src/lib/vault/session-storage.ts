const ACTIVE_VAULT_KEY = 'ink-marrow:active-vault-path'

export function getStoredActiveVaultPath(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_VAULT_KEY)
}

export function setStoredActiveVaultPath(path: string | null): void {
  if (typeof window === 'undefined') return
  if (path) window.localStorage.setItem(ACTIVE_VAULT_KEY, path)
  else window.localStorage.removeItem(ACTIVE_VAULT_KEY)
}
