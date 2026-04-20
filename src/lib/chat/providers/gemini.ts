/**
 * Google Gemini (Generative Language API) provider.
 *
 * Endpoint: `POST {base}/models/{model}:streamGenerateContent?alt=sse&key={apiKey}`
 * API key is passed as a query param (Google's convention), not a bearer
 * token. The wire payload is also structurally different from OpenAI:
 *
 *   - `systemInstruction: { parts: [{ text }] }` is top-level (not a role)
 *   - `contents: [{ role: 'user' | 'model', parts: [{ text }] }]`
 *     — assistant maps to `model`
 *   - deltas land on `candidates[0].content.parts[0].text`
 *
 * `alt=sse` forces Server-Sent Events framing (`data: {...}`); without
 * it Gemini returns a JSON array, which is harder to stream.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
} from './types'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

async function* streamGemini(
  req: ChatCompletionRequest,
): AsyncGenerator<ChatStreamChunk> {
  const base = (req.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  // Gemini's REST convention: model name lives in the path, not the body.
  const modelSegment = encodeURIComponent(req.model)
  const url = `${base}/models/${modelSegment}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`

  const systemText = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')

  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
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
      message: `Gemini ${res.status}${detail ? `: ${detail}` : ''}`,
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
        try {
          const json = JSON.parse(payload) as {
            candidates?: {
              content?: { parts?: { text?: string }[] }
              finishReason?: string
            }[]
            error?: { message?: string }
          }
          if (json.error?.message) {
            yield { type: 'error', message: json.error.message }
            return
          }
          const parts = json.candidates?.[0]?.content?.parts
          if (parts) {
            for (const p of parts) {
              if (typeof p.text === 'string' && p.text.length > 0) {
                yield { type: 'delta', content: p.text }
              }
            }
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

export const geminiProvider: ChatProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultBaseUrl: DEFAULT_BASE_URL,
  streamChat: streamGemini,
}
