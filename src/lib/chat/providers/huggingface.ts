/**
 * HuggingFace router provider.
 *
 * HuggingFace ships an OpenAI-compatible `chat/completions` endpoint at
 * `https://router.huggingface.co/v1/chat/completions` that fan-outs to
 * Inference Endpoints and third-party providers (Together, Fireworks,
 * etc.) depending on the model. The wire format is OpenAI's, so the
 * parser is shared with `openai.ts` / `openrouter.ts`.
 *
 * Model ids look like `meta-llama/Meta-Llama-3-8B-Instruct` or
 * `mistralai/Mistral-7B-Instruct-v0.3`. Self-hosted Inference Endpoints
 * can override `baseUrl` to their own `/v1` prefix.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
} from './types'

const DEFAULT_BASE_URL = 'https://router.huggingface.co/v1'

async function* streamHuggingFace(
  req: ChatCompletionRequest,
): AsyncGenerator<ChatStreamChunk> {
  const base = (req.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = `${base}/chat/completions`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
      }),
      signal: req.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `Network error: ${msg}` }
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
      message: `HuggingFace ${res.status}${detail ? `: ${detail}` : ''}`,
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

export const huggingfaceProvider: ChatProvider = {
  id: 'huggingface',
  label: 'HuggingFace',
  defaultBaseUrl: DEFAULT_BASE_URL,
  streamChat: streamHuggingFace,
}
