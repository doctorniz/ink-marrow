/**
 * Per-vault LLM API key store (IndexedDB).
 *
 * Mirrors `src/lib/sync/token-store.ts` but scoped to chat provider
 * credentials. Keys are kept out of `VaultConfig` / `config.json` so they
 * don't accidentally sync to Dropbox or get committed alongside the vault
 * on disk. They live only in the browser's IndexedDB, keyed per
 * `(provider, vaultId)` — same shape as the sync token store.
 *
 * `vaultId` is the active vault's path (see `useVaultSession().vaultPath`).
 * Changing to a different vault hides other vaults' keys; clearing site
 * data wipes them entirely.
 */

import type { ChatKeyRecord, ChatProviderId } from '@/types/chat'

const DB_NAME = 'mentis-llm-keys'
const DB_VERSION = 1
const STORE_NAME = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function keyId(provider: ChatProviderId, vaultId: string): string {
  return `llm:${provider}:${vaultId}`
}

export async function getChatKey(
  provider: ChatProviderId,
  vaultId: string,
): Promise<ChatKeyRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(keyId(provider, vaultId))
    req.onsuccess = () => resolve((req.result as ChatKeyRecord) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setChatKey(
  provider: ChatProviderId,
  vaultId: string,
  record: ChatKeyRecord,
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(record, keyId(provider, vaultId))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function clearChatKey(
  provider: ChatProviderId,
  vaultId: string,
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(keyId(provider, vaultId))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** Fast "is this provider configured?" check for gating the chat UI. */
export async function hasChatKey(
  provider: ChatProviderId,
  vaultId: string,
): Promise<boolean> {
  const rec = await getChatKey(provider, vaultId)
  return !!rec?.apiKey
}

/* ------------------------------------------------------------------ */
/*  Reactivity signal                                                  */
/* ------------------------------------------------------------------ */

/**
 * Custom event name dispatched on `window` whenever a chat key is saved
 * or cleared. Chat panels listen to this to re-read their API key from
 * IndexedDB without requiring a full page refresh.
 */
export const CHAT_KEY_CHANGED_EVENT = 'ink:chat-key-changed'

/** Dispatch the key-changed signal. Called from setChatKey / clearChatKey wrappers. */
export function notifyChatKeyChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(CHAT_KEY_CHANGED_EVENT))
  } catch {
    /* swallow — no window in SSR */
  }
}
