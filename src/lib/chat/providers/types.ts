/**
 * Provider-agnostic chat completion contract.
 *
 * Every concrete provider (OpenRouter first; Anthropic/OpenAI/Gemini/HF/
 * window.ai later) implements `ChatProvider`. The UI/store only talks to
 * this interface, so swapping providers is a one-line change in
 * `providers/index.ts` / `ChatSettings.provider`.
 *
 * Streaming is the first-class path. Non-streaming callers should consume
 * `stream` and join the deltas; there's no separate blocking call.
 */

import type { ChatMessage, ChatProviderId } from '@/types/chat'

/** Minimal role+content shape sent on the wire; strips app-only fields. */
export interface WireMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionRequest {
  /** Model id in provider-native form, e.g. `anthropic/claude-sonnet-4`. */
  model: string
  /** Already ordered: system first, then conversation history. */
  messages: WireMessage[]
  /** Optional provider override; falls back to provider default. */
  baseUrl?: string
  /** API key for this call. Never logged or persisted beyond IndexedDB. */
  apiKey: string
  /** Abort in-flight request — wired to UI cancel button. */
  signal?: AbortSignal
}

/** One streamed chunk: either a content delta or a terminal marker. */
export type ChatStreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface ChatProvider {
  id: ChatProviderId
  /** Human-readable label for settings UI. */
  label: string
  /** Default base URL if the user hasn't overridden it. */
  defaultBaseUrl: string
  /**
   * Open an SSE-style completion stream. Implementations MUST respect
   * `signal.aborted` (check between chunks) and close cleanly.
   */
  streamChat: (req: ChatCompletionRequest) => AsyncIterable<ChatStreamChunk>
}

/** Helper — strip app-only fields (`id`, `createdAt`, `streaming`, …). */
export function toWire(messages: ChatMessage[]): WireMessage[] {
  return messages
    .filter((m) => !m.error && m.content.length > 0)
    .map((m) => ({ role: m.role, content: m.content }))
}
