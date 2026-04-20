/**
 * In-document chat types.
 *
 * A *thread* is a single conversation; a document can have many threads
 * (multi-thread UI is deferred — v1 pins one thread per document). Each
 * thread is stored as a sidecar JSON file under
 * `_marrow/_chats/<chatAssetId>/<threadId>.json`, mirroring the canvas v5
 * drawings-folder convention. `chatAssetId` is a stable UUID stored in
 * the document itself (frontmatter for markdown) so a rename moves the
 * reference, not the folder.
 */

export const CHAT_SCHEMA_VERSION = 1

/** One exchange in a conversation. */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  /** Rendered as markdown for assistant, plain text for user. */
  content: string
  /** ISO-8601; used for sort stability and for display. */
  createdAt: string
  /**
   * The provider + model this specific message was produced with. Lets a
   * thread record mixed-model histories (user switches mid-conversation).
   * Absent for user/system messages.
   */
  model?: string
  /**
   * True while the assistant message is still being streamed in. The
   * content field grows by append during streaming; `done` flips to
   * true (the field goes away / false) once the stream terminates
   * successfully or errors out.
   */
  streaming?: boolean
  /** Populated when the provider returns an error mid-stream. */
  error?: string
}

/** A single conversation thread, persisted as one JSON file. */
export interface ChatThread {
  schemaVersion: typeof CHAT_SCHEMA_VERSION
  /** UUID. File name is `${id}.json`. */
  id: string
  /** The document's `chatAssetId` this thread lives under. */
  documentAssetId: string
  /**
   * Vault-relative path the thread was created from. Informational only —
   * the link that survives rename is `documentAssetId`, not this path.
   */
  documentPath: string
  /** Derived from the first user message or hand-edited later. */
  title: string
  createdAt: string
  modifiedAt: string
  messages: ChatMessage[]
}

/** Supported provider ids. */
export type ChatProviderId =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'huggingface'
  | 'ollama'
  | 'window-ai'
  | 'webllm'

/**
 * Per-vault AI settings. API keys do NOT live here — they go in the
 * IndexedDB key store keyed by `(provider, vaultId)`. Config that IS safe
 * to ship in the vault's `config.json` (and therefore sync to Dropbox)
 * lives here.
 */
export interface ChatSettings {
  /** Active provider id. `null` disables chat entirely. */
  provider: ChatProviderId | null
  /** Default model id (provider-specific, e.g. `anthropic/claude-sonnet-4`). */
  model: string
  /**
   * Optional override for the provider's base URL. Blank = provider
   * default. Useful for self-hosted OpenAI-compatible gateways.
   */
  baseUrl?: string
  /**
   * System prompt prepended to every chat. If blank, the context builder's
   * default (below) is used instead.
   */
  systemPrompt?: string
  /**
   * Max characters of document content to include as context. Above this
   * the context is truncated with an explanatory note. Naive by design —
   * v1 doesn't count tokens.
   */
  maxContextChars: number
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: null,
  model: 'anthropic/claude-sonnet-4',
  maxContextChars: 40_000,
}

/** Shape of the API-key record stored in IndexedDB. */
export interface ChatKeyRecord {
  apiKey: string
  /** Overrides `ChatSettings.baseUrl` at call time if set. */
  baseUrl?: string
}
