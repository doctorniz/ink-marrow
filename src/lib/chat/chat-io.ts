/**
 * Sidecar JSON IO for per-document chat threads.
 *
 * Layout mirrors Canvas v5's drawings folder:
 *
 *     _marrow/_chats/<chatAssetId>/<threadId>.json
 *
 * `chatAssetId` is a stable UUID the document carries in its own content
 * (frontmatter for markdown; a separate index for PDFs, deferred). This
 * means renaming the document does NOT move the chat folder — the link
 * travels with the UUID, not the filename. `_marrow/` is hidden by
 * `src/lib/notes/tree-filter.ts`, so chat sidecars never appear in the
 * vault tree, file browser, search results, or graph.
 *
 * Writes are crash-safe: temp file + rename, so a mid-save crash leaves
 * the previous valid JSON intact rather than a half-written one.
 */

import type { FileSystemAdapter } from '@/lib/fs'
import {
  CHAT_SCHEMA_VERSION,
  type ChatMessage,
  type ChatThread,
} from '@/types/chat'
import { MARROW_DIR } from '@/types/vault'

export const CHATS_DIR = `${MARROW_DIR}/_chats`

/** Vault-relative folder that holds all threads for one document. */
export function threadFolder(chatAssetId: string): string {
  return `${CHATS_DIR}/${chatAssetId}`
}

/** Vault-relative path for one thread file. */
export function threadPath(chatAssetId: string, threadId: string): string {
  return `${threadFolder(chatAssetId)}/${threadId}.json`
}

async function ensureDir(vaultFs: FileSystemAdapter, path: string): Promise<void> {
  try {
    await vaultFs.mkdir(path)
  } catch {
    // mkdir is idempotent on OPFS/FSAPI adapters — swallow "already exists".
  }
}

/** Factory for a fresh empty thread. */
export function newThread({
  documentAssetId,
  documentPath,
  title,
}: {
  documentAssetId: string
  documentPath: string
  title?: string
}): ChatThread {
  const now = new Date().toISOString()
  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    documentAssetId,
    documentPath,
    title: title ?? 'New chat',
    createdAt: now,
    modifiedAt: now,
    messages: [],
  }
}

export function newMessage(
  role: ChatMessage['role'],
  content: string,
  model?: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(model ? { model } : {}),
  }
}

/** List thread ids (UUIDs) under a chatAssetId. Missing folder → []. */
export async function listThreadIds(
  vaultFs: FileSystemAdapter,
  chatAssetId: string,
): Promise<string[]> {
  const dir = threadFolder(chatAssetId)
  const exists = await vaultFs.exists(dir).catch(() => false)
  if (!exists) return []
  try {
    const entries = await vaultFs.readdir(dir)
    return entries
      .filter((e) => !e.isDirectory && e.name.endsWith('.json'))
      .map((e) => e.name.replace(/\.json$/, ''))
  } catch {
    return []
  }
}

export async function readThread(
  vaultFs: FileSystemAdapter,
  chatAssetId: string,
  threadId: string,
): Promise<ChatThread | null> {
  const p = threadPath(chatAssetId, threadId)
  try {
    const raw = await vaultFs.readTextFile(p)
    const parsed = JSON.parse(raw) as ChatThread
    if (
      !parsed ||
      parsed.schemaVersion !== CHAT_SCHEMA_VERSION ||
      typeof parsed.id !== 'string' ||
      !Array.isArray(parsed.messages)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function writeThread(
  vaultFs: FileSystemAdapter,
  thread: ChatThread,
): Promise<void> {
  await ensureDir(vaultFs, CHATS_DIR)
  await ensureDir(vaultFs, threadFolder(thread.documentAssetId))

  const finalPath = threadPath(thread.documentAssetId, thread.id)
  const tmpPath = `${finalPath}.tmp`

  const payload: ChatThread = {
    ...thread,
    schemaVersion: CHAT_SCHEMA_VERSION,
    modifiedAt: new Date().toISOString(),
  }

  const json = JSON.stringify(payload, null, 2)
  await vaultFs.writeTextFile(tmpPath, json)
  try {
    // Prefer atomic rename when the adapter supports it. If the final
    // path already exists the rename may fail on some backends — fall
    // back to remove+rename.
    try {
      await vaultFs.rename(tmpPath, finalPath)
    } catch {
      await vaultFs.remove(finalPath).catch(() => undefined)
      await vaultFs.rename(tmpPath, finalPath)
    }
  } catch (err) {
    // Last-resort: leave tmp in place for a future recovery pass rather
    // than throwing data away silently.
    await vaultFs.remove(tmpPath).catch(() => undefined)
    throw err
  }
}

export async function deleteThread(
  vaultFs: FileSystemAdapter,
  chatAssetId: string,
  threadId: string,
): Promise<void> {
  const p = threadPath(chatAssetId, threadId)
  try {
    await vaultFs.remove(p)
  } catch {
    /* already gone */
  }
}

/** Read every thread for a document, newest first. */
export async function listThreadsFull(
  vaultFs: FileSystemAdapter,
  chatAssetId: string,
): Promise<ChatThread[]> {
  const ids = await listThreadIds(vaultFs, chatAssetId)
  const out: ChatThread[] = []
  for (const id of ids) {
    const t = await readThread(vaultFs, chatAssetId, id)
    if (t) out.push(t)
  }
  out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return out
}
