/**
 * Provider-specific model catalog fetching.
 *
 * Each cloud provider has a "list models" API. After the user validates
 * their API key via `testConnection`, we call `fetchModels` to populate
 * the model dropdown in Settings → AI with real models from their account.
 *
 * For local/browser providers (window-ai, webllm, ollama) we either return
 * a fixed list or query the local service. WebLLM pulls from the
 * @mlc-ai/web-llm package's prebuilt model catalog dynamically.
 */

import type { ChatProviderId } from '@/types/chat'

export interface ModelEntry {
  id: string
  label: string
}

/* ------------------------------------------------------------------ */
/*  OpenAI                                                             */
/* ------------------------------------------------------------------ */

async function fetchOpenAIModels(
  apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  const base = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const json = (await res.json()) as { data?: { id: string }[] }
  const models = (json.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o[1-9]|chatgpt-)/.test(id))
    .sort()
  return models.map((id) => ({ id, label: id }))
}

/* ------------------------------------------------------------------ */
/*  OpenRouter                                                         */
/* ------------------------------------------------------------------ */

async function fetchOpenRouterModels(
  _apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  const base = (baseUrl?.trim() || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/models`)
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const json = (await res.json()) as {
    data?: { id: string; name?: string }[]
  }
  const models = (json.data ?? []).slice(0, 200)
  return models.map((m) => ({ id: m.id, label: m.name ?? m.id }))
}

/* ------------------------------------------------------------------ */
/*  Anthropic                                                          */
/* ------------------------------------------------------------------ */

async function fetchAnthropicModels(
  apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  const base = (baseUrl?.trim() || 'https://api.anthropic.com/v1').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (res.ok) {
      const json = (await res.json()) as { data?: { id: string; display_name?: string }[] }
      if (json.data && json.data.length > 0) {
        return json.data.map((m) => ({ id: m.id, label: m.display_name ?? m.id }))
      }
    }
  } catch {
    /* fall through to curated list */
  }
  // Fallback curated list — Anthropic's models endpoint requires specific permissions
  return [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-20250414', label: 'Claude Haiku 4' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
  ]
}

/* ------------------------------------------------------------------ */
/*  Gemini                                                             */
/* ------------------------------------------------------------------ */

async function fetchGeminiModels(
  apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  const base = (baseUrl?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  )
  const res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey)}`)
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const json = (await res.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
  }
  const chatModels = (json.models ?? []).filter((m) =>
    m.supportedGenerationMethods?.includes('generateContent'),
  )
  return chatModels.map((m) => {
    const id = m.name.replace(/^models\//, '')
    return { id, label: m.displayName ?? id }
  })
}

/* ------------------------------------------------------------------ */
/*  Hugging Face                                                       */
/* ------------------------------------------------------------------ */

async function fetchHuggingFaceModels(
  _apiKey: string,
  _baseUrl?: string,
): Promise<ModelEntry[]> {
  // HF's router doesn't have a simple list endpoint; use curated list
  return [
    { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B Instruct' },
    { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', label: 'Llama 3.1 70B Instruct' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.3', label: 'Mistral 7B Instruct v0.3' },
    { id: 'microsoft/Phi-3.5-mini-instruct', label: 'Phi-3.5 Mini Instruct' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B Instruct' },
    { id: 'google/gemma-2-9b-it', label: 'Gemma 2 9B IT' },
  ]
}

/* ------------------------------------------------------------------ */
/*  Ollama                                                             */
/* ------------------------------------------------------------------ */

async function fetchOllamaModels(
  _apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  // Ollama's native API uses /api/tags; the OpenAI-compat layer uses /v1/models.
  const base = (baseUrl?.trim() || 'http://localhost:11434').replace(/\/$/, '')
  // Try native Ollama endpoint first
  let res: Response
  try {
    res = await fetch(`${base}/api/tags`)
  } catch {
    // If native fails, try the /v1 compatible endpoint
    try {
      const v1Base = base.endsWith('/v1') ? base : `${base}/v1`
      res = await fetch(`${v1Base}/models`)
      if (!res.ok) return []
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.id }))
    } catch {
      return []
    }
  }
  if (!res.ok) return []
  const json = (await res.json()) as { models?: { name: string; size?: number }[] }
  return (json.models ?? []).map((m) => ({
    id: m.name,
    label: m.name,
  }))
}

/* ------------------------------------------------------------------ */
/*  window.ai — single fixed model                                    */
/* ------------------------------------------------------------------ */

function windowAiModels(): ModelEntry[] {
  return [{ id: 'gemini-nano', label: 'Gemini Nano (on-device)' }]
}

/* ------------------------------------------------------------------ */
/*  WebLLM — pull from @mlc-ai/web-llm prebuilt catalog                */
/* ------------------------------------------------------------------ */

let webLlmModelsCache: ModelEntry[] | null = null

async function fetchWebLlmModels(): Promise<ModelEntry[]> {
  if (webLlmModelsCache) return webLlmModelsCache

  try {
    const mod = (await import('@mlc-ai/web-llm')) as unknown as {
      prebuiltAppConfig?: { model_list?: { model_id: string; model_size?: number }[] }
    }
    const list = mod.prebuiltAppConfig?.model_list ?? []
    webLlmModelsCache = list.map((m) => ({
      id: m.model_id,
      label: m.model_id.replace(/-MLC$/, ''),
    }))
    return webLlmModelsCache
  } catch {
    // Fallback if the package isn't installed or import fails
    return [
      { id: 'gemma-3-4b-it-q4f16_1-MLC', label: 'Gemma 3 4B IT (q4f16)' },
      { id: 'gemma-3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B IT (q4f16)' },
      { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 Mini Instruct (q4f16)' },
      { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', label: 'SmolLM2 1.7B Instruct (q4f16)' },
      { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B Instruct (q4f16)' },
      { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B Instruct (q4f16)' },
    ]
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch available models for a given provider. May throw on network errors
 * for cloud providers. Returns empty array on unrecoverable failures for
 * local providers.
 */
export async function fetchModels(
  provider: ChatProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<ModelEntry[]> {
  switch (provider) {
    case 'openai':
      return fetchOpenAIModels(apiKey, baseUrl)
    case 'openrouter':
      return fetchOpenRouterModels(apiKey, baseUrl)
    case 'anthropic':
      return fetchAnthropicModels(apiKey, baseUrl)
    case 'gemini':
      return fetchGeminiModels(apiKey, baseUrl)
    case 'huggingface':
      return fetchHuggingFaceModels(apiKey, baseUrl)
    case 'ollama':
      return fetchOllamaModels(apiKey, baseUrl)
    case 'window-ai':
      return windowAiModels()
    case 'webllm':
      return fetchWebLlmModels()
    default:
      return []
  }
}

/** Whether this provider requires an API key to function. */
export function providerNeedsApiKey(provider: ChatProviderId): boolean {
  return !['window-ai', 'webllm', 'ollama'].includes(provider)
}

/** Whether this provider needs the base URL field. */
export function providerNeedsBaseUrl(provider: ChatProviderId): boolean {
  return !['window-ai', 'webllm'].includes(provider)
}
