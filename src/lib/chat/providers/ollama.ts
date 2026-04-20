/**
 * Ollama local provider.
 *
 * Ollama is a desktop runner for open-weight LLMs (Llama, Mistral, Gemma,
 * Phi, …) that exposes an OpenAI-compatible `/v1/chat/completions` SSE
 * endpoint on localhost once the user runs `ollama serve` (or the Ollama
 * desktop app). No API key is required — the `apiKey` field is sent as a
 * placeholder Bearer to keep the fetch path identical to the other
 * OpenAI-compatible providers and because some Ollama deployments front
 * the port with a proxy that *does* require one.
 *
 * Default base URL is `http://localhost:11434/v1`; users with a remote
 * Ollama box can override via Settings → AI → Base URL.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
} from './types'

const DEFAULT_BASE_URL = 'http://localhost:11434/v1'

async function* streamOllama(
  req: ChatCompletionRequest,
): AsyncGenerator<ChatStreamChunk> {
  const base = (req.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = `${base}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // Ollama ignores the Authorization header by default; include it only
  // when the user has bothered to set a key so reverse-proxy setups still
  // work without noise.
  if (req.apiKey && req.apiKey.length > 0) {
    headers.Authorization = `Bearer ${req.apiKey}`
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
      }),
      signal: req.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    yield {
      type: 'error',
      message: `Could not reach Ollama at ${base} — is the server running? (${msg})`,
    }
    return
  }

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      /* swallow */
    }
    yield {
      type: 'error',
      message: `Ollama ${res.status}${detail ? `: ${detail}` : ''}`,
    }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'Cancelled' }
        return
      }
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') {
          yield { type: 'done' }
          return
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[]
          }
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            yield { type: 'delta', content: delta }
          }
        } catch {
          /* swallow malformed chunks */
        }
      }
    }
    yield { type: 'done' }
  } catch (err) {
    if (req.signal?.aborted) {
      yield { type: 'error', message: 'Cancelled' }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `Stream error: ${msg}` }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* swallow */
    }
  }
}

export const ollamaProvider: ChatProvider = {
  id: 'ollama',
  label: 'Ollama (local)',
  defaultBaseUrl: DEFAULT_BASE_URL,
  streamChat: streamOllama,
}
