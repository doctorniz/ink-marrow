/**
 * Provider registry.
 *
 * Each implementation maps the app's unified `ChatProvider` contract
 * onto its vendor-specific wire format. Adding a new provider is a
 * two-line change here plus the provider file itself — the UI and the
 * store never touch vendor code.
 *
 * Currently wired:
 *   - `openrouter` — OpenAI-compatible gateway; one key unlocks many models
 *   - `openai`     — api.openai.com `/v1/chat/completions`
 *   - `anthropic`  — api.anthropic.com `/v1/messages` (named SSE events)
 *   - `gemini`     — Generative Language API `:streamGenerateContent`
 *   - `huggingface`— router.huggingface.co `/v1/chat/completions`
 *   - `ollama`     — localhost OpenAI-compatible endpoint (user-run server)
 *   - `window-ai`  — Chrome built-in Prompt API (on-device Gemini Nano)
 *   - `webllm`     — @mlc-ai/web-llm, WebGPU in-browser inference (Gemma etc.)
 */

import type { ChatProviderId } from '@/types/chat'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { huggingfaceProvider } from './huggingface'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'
import { openrouterProvider } from './openrouter'
import { webllmProvider } from './webllm'
import { windowAiProvider } from './window-ai'
import type { ChatProvider } from './types'

const PROVIDERS: Partial<Record<ChatProviderId, ChatProvider>> = {
  openrouter: openrouterProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  huggingface: huggingfaceProvider,
  ollama: ollamaProvider,
  'window-ai': windowAiProvider,
  webllm: webllmProvider,
}

export function getProvider(id: ChatProviderId): ChatProvider | null {
  return PROVIDERS[id] ?? null
}

export function listAvailableProviders(): ChatProvider[] {
  return Object.values(PROVIDERS).filter((p): p is ChatProvider => Boolean(p))
}

export type { ChatProvider } from './types'
export { toWire } from './types'
