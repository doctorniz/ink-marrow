'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  FileSearch,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { ChatInput } from '@/components/chat/chat-input'
import { ChatMessage } from '@/components/chat/chat-message'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { getChatKey } from '@/lib/chat/key-store'
import {
  useVaultChatStore,
  selectActiveVaultThread,
} from '@/stores/vault-chat'
import { useEditorStore } from '@/stores/editor'
import { useFileTreeStore } from '@/stores/file-tree'
import { useUiStore } from '@/stores/ui'
import {
  DEFAULT_CHAT_SETTINGS,
  type ChatMessage as ChatMessageT,
  type ChatSettings,
} from '@/types/chat'
import { ViewMode } from '@/types/vault'
import { cn } from '@/utils/cn'

/**
 * Tier-1 whole-vault chat.
 *
 * Full-viewport surface (no embedded editor column) that routes every
 * message through a RAG pass over the live MiniSearch index. Thread list
 * lives in a left sidebar; messages + composer occupy the main pane.
 * Threads are persisted under `_marrow/_chats/_vault/` via the shared
 * chat-io helpers; see `stores/vault-chat.ts` for the state machine.
 */
function mergeSettings(from: ChatSettings | undefined): ChatSettings {
  return { ...DEFAULT_CHAT_SETTINGS, ...(from ?? {}) }
}

export function VaultChatView() {
  const { vaultFs, vaultPath, config } = useVaultSession()
  const settings = useMemo(() => mergeSettings(config.chat), [config.chat])

  const threads = useVaultChatStore((s) => s.threads)
  const activeThreadId = useVaultChatStore((s) => s.activeThreadId)
  const isStreaming = useVaultChatStore((s) => s.isStreaming)
  const error = useVaultChatStore((s) => s.error)
  const initialized = useVaultChatStore((s) => s.initialized)
  const init = useVaultChatStore((s) => s.init)
  const selectThread = useVaultChatStore((s) => s.selectThread)
  const createThread = useVaultChatStore((s) => s.createThread)
  const deleteThread = useVaultChatStore((s) => s.deleteThread)
  const sendMessage = useVaultChatStore((s) => s.sendMessage)
  const cancel = useVaultChatStore((s) => s.cancel)
  const activeThread = useVaultChatStore(selectActiveVaultThread)

  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyChecked, setKeyChecked] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load threads when the view mounts. Persisted across sessions, so on
  // subsequent opens the user lands on their most recent thread.
  useEffect(() => {
    void init({ vaultFs })
  }, [vaultFs, init])

  // Pull the API key for the configured provider; recheck when provider/vault changes.
  useEffect(() => {
    let cancelled = false
    setKeyChecked(false)
    if (!settings.provider) {
      setApiKey(null)
      setKeyChecked(true)
      return
    }
    void getChatKey(settings.provider, vaultPath)
      .then((rec) => {
        if (cancelled) return
        setApiKey(rec?.apiKey ?? null)
        setKeyChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        setApiKey(null)
        setKeyChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [settings.provider, vaultPath])

  // Autoscroll to bottom as messages stream in.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeThread?.messages.length, activeThread?.modifiedAt, isStreaming])

  const handleSend = useCallback(
    (text: string) => {
      if (!apiKey || !settings.provider) return
      void sendMessage({ vaultFs, settings, apiKey, input: text })
    },
    [apiKey, settings, sendMessage, vaultFs],
  )

  const handleNewThread = useCallback(async () => {
    if (isStreaming) return
    await createThread()
  }, [isStreaming, createThread])

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      await deleteThread({ vaultFs, threadId })
    },
    [deleteThread, vaultFs],
  )

  const providerMissing = !settings.provider
  const keyMissing = keyChecked && !apiKey && !!settings.provider
  const composerDisabled =
    providerMissing || keyMissing || !activeThread || !initialized

  return (
    <div className="bg-bg flex h-full min-h-0 w-full">
      {/* Left: thread list */}
      <aside className="border-border hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="text-accent size-4" aria-hidden />
            <span className="text-fg text-sm font-medium">Vault chat</span>
          </div>
          <button
            type="button"
            onClick={handleNewThread}
            disabled={isStreaming}
            title="New chat"
            className="text-fg-secondary hover:bg-bg-hover hover:text-fg flex size-7 items-center justify-center rounded-md disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {threads.length === 0 ? (
            <p className="text-fg-muted px-3 py-2 text-xs">No chats yet.</p>
          ) : (
            threads.map((t) => {
              const active = t.id === activeThreadId
              return (
                <div
                  key={t.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1.5',
                    active
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-secondary hover:bg-bg-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className="min-w-0 flex-1 truncate text-left text-xs"
                    title={t.title}
                  >
                    {t.title || 'New chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteThread(t.id)}
                    className="text-fg-muted hover:text-danger opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete chat"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Right: messages + composer */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-border flex items-center gap-2 border-b px-4 py-2">
          <Sparkles className="text-accent size-4" aria-hidden />
          <span className="text-fg text-sm font-medium">Chat with your vault</span>
          {settings.model && (
            <span className="text-fg-muted truncate text-xs" title={settings.model}>
              {settings.model}
            </span>
          )}
          <span className="text-fg-muted ml-auto hidden text-xs sm:inline">
            Answers are grounded in your notes via local search. Nothing is sent
            to the model without your vault content being attached.
          </span>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-3">
          {!activeThread || activeThread.messages.length === 0 ? (
            <EmptyState
              providerMissing={providerMissing}
              keyMissing={keyMissing}
            />
          ) : (
            activeThread.messages.map((m) => (
              <VaultChatMessageRow key={m.id} message={m} />
            ))
          )}
        </div>

        {error && (
          <div className="text-danger border-border border-t px-4 py-2 text-xs">
            {error}
          </div>
        )}

        <ChatInput
          disabled={composerDisabled}
          isStreaming={isStreaming}
          placeholder={
            providerMissing
              ? 'Configure a provider in Settings → AI'
              : keyMissing
                ? 'Add an API key in Settings → AI'
                : 'Ask anything about your vault…'
          }
          onSend={handleSend}
          onCancel={cancel}
        />
      </section>
    </div>
  )
}

/**
 * Thin wrapper around `ChatMessage` that makes inline citations clickable.
 * The system prompt asks the model to cite sources as backticked paths, so
 * after each assistant message we render a Sources strip that opens the
 * Vault view with the file pre-selected when clicked.
 */
function VaultChatMessageRow({ message }: { message: ChatMessageT }) {
  const { vaultFs } = useVaultSession()

  const openPath = useCallback(
    async (path: string) => {
      useUiStore.getState().setActiveView(ViewMode.Vault)
      useFileTreeStore.getState().setSelectedPath(path)
      useEditorStore.getState().addRecentFile(path)
      const { detectEditorTabType } = await import(
        '@/lib/notes/editor-tab-from-path'
      )
      const type = await detectEditorTabType(vaultFs, path)
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        path,
        type,
        title: path.split('/').pop() ?? path,
        isDirty: false,
      })
    },
    [vaultFs],
  )

  // Extract `path/in/vault.md`-style citations (rough heuristic: backticks
  // around something with a slash or one of our known extensions).
  const citations = useMemo(() => {
    if (message.role !== 'assistant' || message.streaming) return []
    const out = new Set<string>()
    const re = /`([^`\n]{2,200})`/g
    let m: RegExpExecArray | null
    while ((m = re.exec(message.content))) {
      const candidate = m[1].trim()
      if (
        (candidate.includes('/') ||
          /\.(md|pdf|canvas)$/i.test(candidate)) &&
        !candidate.includes(' — ') &&
        candidate.length < 160
      ) {
        out.add(candidate)
      }
    }
    return Array.from(out)
  }, [message.role, message.streaming, message.content])

  return (
    <div>
      <ChatMessage message={message} />
      {citations.length > 0 && (
        <div className="ml-[3.25rem] mt-0.5 mb-2 flex flex-wrap gap-1.5 pr-3">
          {citations.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => void openPath(path)}
              title={`Open ${path}`}
              className="text-accent hover:bg-accent/10 border-border inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
            >
              <FileSearch className="size-3" aria-hidden />
              <span className="max-w-[280px] truncate">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  providerMissing,
  keyMissing,
}: {
  providerMissing: boolean
  keyMissing: boolean
}) {
  return (
    <div className="text-fg-secondary flex h-full flex-col items-center justify-center px-6 py-12 text-center text-sm">
      <Sparkles className="text-accent/60 mb-3 size-10" />
      {providerMissing ? (
        <>
          <p className="text-fg font-medium">Vault chat isn&apos;t set up yet</p>
          <p className="text-fg-muted mt-1 max-w-md text-xs">
            Pick an AI provider in Settings → AI. Cloud providers need a key;
            Ollama, Chrome built-in, and WebLLM run locally with no account.
          </p>
        </>
      ) : keyMissing ? (
        <>
          <p className="text-fg font-medium">API key required</p>
          <p className="text-fg-muted mt-1 max-w-md text-xs">
            Open Settings → AI and paste a key for this provider. Keys are
            stored locally in the browser, never synced.
          </p>
        </>
      ) : (
        <>
          <p className="text-fg font-medium">Ask anything about your vault</p>
          <p className="text-fg-muted mt-1 max-w-md text-xs">
            Every question runs a local search over your notes, PDFs, and
            canvases — the top matches are attached as context. Try{' '}
            <em>&quot;what did I write about X?&quot;</em> or{' '}
            <em>&quot;summarise my notes from last week.&quot;</em>
          </p>
        </>
      )}
    </div>
  )
}
