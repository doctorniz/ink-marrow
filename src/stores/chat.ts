import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { FileSystemAdapter } from '@/lib/fs'
import {
  buildDocumentContext,
  buildSystemMessage,
} from '@/lib/chat/context-builder'
import {
  deleteThread as deleteThreadOnDisk,
  listThreadsFull,
  newMessage,
  newThread,
  writeThread,
} from '@/lib/chat/chat-io'
import { getProvider, toWire } from '@/lib/chat/providers'
import type {
  ChatMessage,
  ChatSettings,
  ChatThread,
  ChatProviderId,
} from '@/types/chat'

/**
 * Per-document chat store.
 *
 * `activeDocAssetId` scopes everything — when the user switches documents,
 * the notes-view mounts a new ChatPanel with a different `chatAssetId`,
 * which triggers `openDocument` and replaces the in-memory thread list.
 *
 * Streaming lives here too: `sendMessage` appends an empty assistant
 * message with `streaming: true`, then mutates its `content` as each
 * delta arrives. The persisted sidecar JSON is rewritten on stream end
 * (success or cancel), never per-delta — disk writes per token would
 * thrash the sync layer.
 */

interface SendArgs {
  vaultFs: FileSystemAdapter
  settings: ChatSettings
  apiKey: string
  documentPath: string
  input: string
}

interface OpenDocumentArgs {
  vaultFs: FileSystemAdapter
  chatAssetId: string
  documentPath: string
}

interface ChatState {
  /** Which document's threads are loaded. `null` = chat panel closed. */
  activeDocAssetId: string | null
  /** Threads for the active document, newest first. */
  threads: ChatThread[]
  /** Id of the currently visible thread within `threads`. */
  activeThreadId: string | null
  /** True while streaming an assistant reply. */
  isStreaming: boolean
  /** Set while an assistant reply is in flight; null otherwise. */
  abort: AbortController | null
  /** Last fatal error, surfaced to the UI. Cleared on next send. */
  error: string | null

  openDocument: (args: OpenDocumentArgs) => Promise<void>
  closeDocument: () => void
  selectThread: (threadId: string) => void
  createThread: (args: {
    chatAssetId: string
    documentPath: string
  }) => Promise<ChatThread>
  deleteThread: (args: {
    vaultFs: FileSystemAdapter
    chatAssetId: string
    threadId: string
  }) => Promise<void>
  sendMessage: (args: SendArgs) => Promise<void>
  cancel: () => void
}

const MAX_TITLE_CHARS = 60

function titleFromFirstUserMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'New chat'
  return trimmed.length <= MAX_TITLE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_TITLE_CHARS - 1)}…`
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    activeDocAssetId: null,
    threads: [],
    activeThreadId: null,
    isStreaming: false,
    abort: null,
    error: null,

    openDocument: async ({ vaultFs, chatAssetId, documentPath }) => {
      // Cancel anything still streaming for a previous document.
      get().abort?.abort()

      set((s) => {
        s.activeDocAssetId = chatAssetId
        s.threads = []
        s.activeThreadId = null
        s.isStreaming = false
        s.abort = null
        s.error = null
      })

      const existing = await listThreadsFull(vaultFs, chatAssetId)

      if (existing.length > 0) {
        set((s) => {
          s.threads = existing
          s.activeThreadId = existing[0].id
        })
        return
      }

      // First open — start an empty draft thread in memory. It isn't
      // persisted until the first send succeeds, so users who open the
      // panel and immediately close it don't leave empty JSON on disk.
      const draft = newThread({
        documentAssetId: chatAssetId,
        documentPath,
      })
      set((s) => {
        s.threads = [draft]
        s.activeThreadId = draft.id
      })
    },

    closeDocument: () => {
      get().abort?.abort()
      set((s) => {
        s.activeDocAssetId = null
        s.threads = []
        s.activeThreadId = null
        s.isStreaming = false
        s.abort = null
        s.error = null
      })
    },

    selectThread: (threadId) => {
      set((s) => {
        if (s.threads.some((t) => t.id === threadId)) {
          s.activeThreadId = threadId
        }
      })
    },

    createThread: async ({ chatAssetId, documentPath }) => {
      const draft = newThread({
        documentAssetId: chatAssetId,
        documentPath,
      })
      set((s) => {
        s.threads.unshift(draft)
        s.activeThreadId = draft.id
      })
      // Not persisted until first send — matches `openDocument` contract.
      return draft
    },

    deleteThread: async ({ vaultFs, chatAssetId, threadId }) => {
      await deleteThreadOnDisk(vaultFs, chatAssetId, threadId)
      set((s) => {
        s.threads = s.threads.filter((t) => t.id !== threadId)
        if (s.activeThreadId === threadId) {
          s.activeThreadId = s.threads[0]?.id ?? null
        }
      })
    },

    sendMessage: async ({
      vaultFs,
      settings,
      apiKey,
      documentPath,
      input,
    }) => {
      const text = input.trim()
      if (!text) return

      const state = get()
      if (state.isStreaming) return
      if (!state.activeDocAssetId) return
      const thread = state.threads.find((t) => t.id === state.activeThreadId)
      if (!thread) return
      if (!settings.provider) {
        set((s) => {
          s.error = 'Select a chat provider in Settings → AI first.'
        })
        return
      }
      if (!apiKey) {
        set((s) => {
          s.error = 'Add an API key in Settings → AI to start chatting.'
        })
        return
      }
      const provider = getProvider(settings.provider)
      if (!provider) {
        set((s) => {
          s.error = `Provider "${settings.provider}" is not available yet.`
        })
        return
      }

      const userMsg: ChatMessage = newMessage('user', text)
      const assistantMsg: ChatMessage = {
        ...newMessage('assistant', '', settings.model),
        streaming: true,
      }

      const abort = new AbortController()

      set((s) => {
        s.error = null
        s.isStreaming = true
        s.abort = abort
        const t = s.threads.find((x) => x.id === thread.id)
        if (!t) return
        t.messages.push(userMsg, assistantMsg)
        if (t.messages.filter((m) => m.role === 'user').length === 1) {
          t.title = titleFromFirstUserMessage(text)
        }
        t.modifiedAt = new Date().toISOString()
      })

      // Build document context + system message *after* user message is
      // in the thread so the system sees the latest doc state even if
      // the user just edited the note.
      let systemMessage: string
      try {
        const ctx = await buildDocumentContext(vaultFs, documentPath, settings)
        systemMessage = buildSystemMessage(ctx, settings)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        set((s) => {
          s.isStreaming = false
          s.abort = null
          const t = s.threads.find((x) => x.id === thread.id)
          const last = t?.messages[t.messages.length - 1]
          if (last && last.role === 'assistant') {
            last.streaming = false
            last.error = `Context build failed: ${msg}`
          }
        })
        return
      }

      // Compose wire messages: system + all prior, but skip the empty
      // assistant placeholder we just pushed.
      const prior = thread.messages.concat(userMsg)
      const wire = [
        { role: 'system' as const, content: systemMessage },
        ...toWire(prior),
      ]

      let sawDelta = false
      let streamError: string | null = null

      try {
        for await (const chunk of provider.streamChat({
          model: settings.model,
          messages: wire,
          apiKey,
          baseUrl: settings.baseUrl,
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break
          if (chunk.type === 'delta') {
            sawDelta = true
            set((s) => {
              const t = s.threads.find((x) => x.id === thread.id)
              const last = t?.messages[t.messages.length - 1]
              if (last && last.role === 'assistant') {
                last.content += chunk.content
              }
            })
          } else if (chunk.type === 'error') {
            streamError = chunk.message
            break
          } else if (chunk.type === 'done') {
            break
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err.message : String(err)
      }

      // Finalize the assistant message.
      set((s) => {
        const t = s.threads.find((x) => x.id === thread.id)
        const last = t?.messages[t.messages.length - 1]
        if (last && last.role === 'assistant') {
          last.streaming = false
          if (streamError) last.error = streamError
          if (!sawDelta && !streamError && abort.signal.aborted) {
            last.error = 'Cancelled'
          }
        }
        if (t) t.modifiedAt = new Date().toISOString()
        s.isStreaming = false
        s.abort = null
        if (streamError) s.error = streamError
      })

      // Persist once per turn. Don't block the UI on it — failures here
      // are surfaced via toast in the UI layer.
      const finalThread = get().threads.find((t) => t.id === thread.id)
      if (finalThread) {
        try {
          await writeThread(vaultFs, finalThread)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          set((s) => {
            s.error = `Failed to save chat: ${msg}`
          })
        }
      }
    },

    cancel: () => {
      const { abort } = get()
      if (abort && !abort.signal.aborted) abort.abort()
    },
  })),
)

/** Selector helpers for components. */
export function selectActiveThread(s: ChatState): ChatThread | null {
  if (!s.activeThreadId) return null
  return s.threads.find((t) => t.id === s.activeThreadId) ?? null
}

/** Which providers currently have a wired implementation. */
export const IMPLEMENTED_PROVIDERS: ChatProviderId[] = [
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'huggingface',
  'ollama',
  'window-ai',
  'webllm',
]
