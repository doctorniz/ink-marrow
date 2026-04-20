/**
 * Path → chatAssetId index for documents that can't carry the id inline.
 *
 * Markdown notes embed `chatAssetId` in their frontmatter so the id
 * travels with the file when it's renamed or moved. PDFs (and any
 * future binary format) have no equivalent place to stash the id, so
 * we keep a single JSON index at `_marrow/_chats/index.json` mapping
 * `vault/relative/path` → `uuid`.
 *
 * Trade-off vs. frontmatter: the index is keyed on the file *path*, so
 * an out-of-band rename (e.g. via the OS file browser while the app is
 * closed) drops the association. Rename operations performed through
 * the app call `movePdfChatAssetId` to migrate the entry. For markdown
 * we still prefer frontmatter — this module is a fallback, not a
 * replacement.
 *
 * Writes are crash-safe (temp file + rename), same pattern as
 * `chat-io.ts`.
 */

import type { FileSystemAdapter } from '@/lib/fs'
import { MARROW_DIR } from '@/types/vault'
import { CHATS_DIR } from './chat-io'

export const CHAT_ASSET_INDEX_PATH = `${CHATS_DIR}/index.json`
const SCHEMA_VERSION = 1

interface IndexShape {
  schemaVersion: number
  /** Vault-relative path → chatAssetId UUID. */
  entries: Record<string, string>
}

async function ensureDir(
  vaultFs: FileSystemAdapter,
  path: string,
): Promise<void> {
  try {
    await vaultFs.mkdir(path)
  } catch {
    /* idempotent */
  }
}

async function readIndex(vaultFs: FileSystemAdapter): Promise<IndexShape> {
  try {
    const raw = await vaultFs.readTextFile(CHAT_ASSET_INDEX_PATH)
    const parsed = JSON.parse(raw) as IndexShape
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      typeof parsed.entries !== 'object' ||
      parsed.entries === null
    ) {
      return { schemaVersion: SCHEMA_VERSION, entries: {} }
    }
    return parsed
  } catch {
    // Missing or unreadable → empty index. We'll write one on first insert.
    return { schemaVersion: SCHEMA_VERSION, entries: {} }
  }
}

async function writeIndex(
  vaultFs: FileSystemAdapter,
  next: IndexShape,
): Promise<void> {
  await ensureDir(vaultFs, MARROW_DIR)
  await ensureDir(vaultFs, CHATS_DIR)
  const finalPath = CHAT_ASSET_INDEX_PATH
  const tmpPath = `${finalPath}.tmp`
  const json = JSON.stringify(next, null, 2)
  await vaultFs.writeTextFile(tmpPath, json)
  try {
    try {
      await vaultFs.rename(tmpPath, finalPath)
    } catch {
      await vaultFs.remove(finalPath).catch(() => undefined)
      await vaultFs.rename(tmpPath, finalPath)
    }
  } catch (err) {
    await vaultFs.remove(tmpPath).catch(() => undefined)
    throw err
  }
}

/** Look up the chatAssetId for a document path, or `null` if none. */
export async function lookupChatAssetId(
  vaultFs: FileSystemAdapter,
  documentPath: string,
): Promise<string | null> {
  const idx = await readIndex(vaultFs)
  return idx.entries[documentPath] ?? null
}

/**
 * Ensure a document has a `chatAssetId` in the index; mint one and
 * persist it if missing. Idempotent — safe to call repeatedly.
 */
export async function ensureChatAssetIdForPath(
  vaultFs: FileSystemAdapter,
  documentPath: string,
): Promise<string> {
  const idx = await readIndex(vaultFs)
  const existing = idx.entries[documentPath]
  if (existing) return existing

  const minted = crypto.randomUUID()
  const next: IndexShape = {
    schemaVersion: SCHEMA_VERSION,
    entries: { ...idx.entries, [documentPath]: minted },
  }
  await writeIndex(vaultFs, next)
  return minted
}

/**
 * Rewrite the index entry after a file rename/move. If the old path
 * wasn't indexed this is a no-op.
 */
export async function movePdfChatAssetId(
  vaultFs: FileSystemAdapter,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return
  const idx = await readIndex(vaultFs)
  const id = idx.entries[oldPath]
  if (!id) return
  const nextEntries = { ...idx.entries }
  delete nextEntries[oldPath]
  nextEntries[newPath] = id
  await writeIndex(vaultFs, {
    schemaVersion: SCHEMA_VERSION,
    entries: nextEntries,
  })
}

/** Remove an entry from the index (e.g. after file deletion). */
export async function dropChatAssetId(
  vaultFs: FileSystemAdapter,
  documentPath: string,
): Promise<void> {
  const idx = await readIndex(vaultFs)
  if (!(documentPath in idx.entries)) return
  const nextEntries = { ...idx.entries }
  delete nextEntries[documentPath]
  await writeIndex(vaultFs, {
    schemaVersion: SCHEMA_VERSION,
    entries: nextEntries,
  })
}
