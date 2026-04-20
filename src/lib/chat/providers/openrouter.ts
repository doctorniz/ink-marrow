/**
 * OpenRouter chat provider.
 *
 * OpenRouter is OpenAI-compatible, so this implementation doubles as a
 * template for any `/v1/chat/completions`-style gateway (LM Studio,
 * Ollama, vLLM, self-hosted OpenAI proxies). Switching those on is a
 * `baseUrl` change plus a new entry in `providers/index.ts`.
 *
 * SSE wire format: one `data: {...json...}\n\n` per delta, terminated by a
 * literal `data: [DONE]` line. Each delta's content lives at
 * `choices[0].delta.content`. We yield only non-empty content strings.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
} from './types'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

async function* streamOpenRouter(
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
        // OpenRouter asks for HTTP-Referer + X-Title for leaderboard /
        // routing; they're optional but nice to send.
        'HTTP-Referer':
          typeof window !== 'undefined' ? window.location.origin : '',
        'X-Title': 'Mentis by Marrow',
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
      message: `OpenRouter ${res.status}${detail ? `: ${detail}` : ''}`,
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

      // SSE frames are separated by blank lines. A frame can hold
      // multiple `data:` lines, but OpenRouter uses one per frame.
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
          // Skip malformed chunks — providers occasionally send keep-
          // alive lines or partial JSON while throttled. Treat as a
          // no-op rather than failing the whole stream.
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

export const openrouterProvider: ChatProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  defaultBaseUrl: DEFAULT_BASE_URL,
  streamChat: streamOpenRouter,
}
