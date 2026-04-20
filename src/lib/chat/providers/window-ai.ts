/**
 * Chrome built-in AI (`window.ai`) provider.
 *
 * Implements Chrome's experimental Prompt API — runs the model entirely
 * in the browser (Gemini Nano, bundled with Chromium Canary/Dev when the
 * user enables the "Prompt API for Gemini Nano" flag at
 * `chrome://flags/#optimization-guide-on-device-model`). Zero network,
 * zero API key.
 *
 * The API surface is deliberately un-typed across Chrome versions — we
 * duck-type at call time and surface a friendly error if the Prompt API
 * isn't present. This lets the provider be selectable in Settings on any
 * browser; it just fails with a clear message on unsupported ones.
 *
 * Notes on streaming: the Prompt API exposes `promptStreaming` which
 * returns a `ReadableStream<string>` of *cumulative* text (each chunk is
 * the full text-so-far, not a delta). We diff against the previous value
 * to emit delta-shaped `ChatStreamChunk`s, matching the rest of the
 * provider registry.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
  WireMessage,
} from './types'

// The Prompt API shape is unstable; describe just the bits we touch. The
// runtime shape has moved across Chrome versions — we check both the
// modern namespace (`window.LanguageModel`) and the earlier one
// (`window.ai.languageModel`) so users on either build tier work.
interface PromptSession {
  promptStreaming: (input: string) => ReadableStream<string>
  destroy?: () => void
}

interface LanguageModelNamespace {
  availability?: () => Promise<string>
  capabilities?: () => Promise<{ available?: string }>
  create: (init?: {
    systemPrompt?: string
    initialPrompts?: Array<{ role: string; content: string }>
    signal?: AbortSignal
  }) => Promise<PromptSession>
}

function resolveLanguageModel(): LanguageModelNamespace | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    LanguageModel?: LanguageModelNamespace
    ai?: { languageModel?: LanguageModelNamespace }
  }
  return w.LanguageModel ?? w.ai?.languageModel ?? null
}

async function isAvailable(lm: LanguageModelNamespace): Promise<boolean> {
  try {
    if (typeof lm.availability === 'function') {
      const v = await lm.availability()
      return v === 'available' || v === 'readily' || v === 'downloadable'
    }
    if (typeof lm.capabilities === 'function') {
      const caps = await lm.capabilities()
      return caps.available === 'readily' || caps.available === 'available'
    }
  } catch {
    /* swallow */
  }
  return true
}

/**
 * Split out the leading system messages into Chrome's `systemPrompt`
 * slot; render the rest as the single prompt the Prompt API takes. The
 * API doesn't expose a turn structure identical to OpenAI's — treat
 * assistant turns as prior context by inlining them.
 */
function buildPromptInput(messages: WireMessage[]): {
  systemPrompt?: string
  prompt: string
} {
  const systemParts: string[] = []
  const convo: WireMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content)
    else convo.push(m)
  }
  // Chrome's `prompt` is a single string. Serialize turns so the model
  // sees the conversation structure.
  const rendered = convo
    .map((m) =>
      m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`,
    )
    .join('\n\n')
  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    prompt: rendered.length > 0 ? rendered : '(empty)',
  }
}

async function* streamWindowAi(
  req: ChatCompletionRequest,
): AsyncGenerator<ChatStreamChunk> {
  const lm = resolveLanguageModel()
  if (!lm) {
    yield {
      type: 'error',
      message:
        'Chrome built-in AI is not available. Enable it at chrome://flags/#optimization-guide-on-device-model, then restart the browser.',
    }
    return
  }

  if (!(await isAvailable(lm))) {
    yield {
      type: 'error',
      message:
        'Chrome built-in AI reports unavailable. The on-device model may still be downloading or unsupported on this device.',
    }
    return
  }

  const { systemPrompt, prompt } = buildPromptInput(req.messages)

  let session: PromptSession
  try {
    session = await lm.create({
      systemPrompt,
      signal: req.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `Prompt API create failed: ${msg}` }
    return
  }

  try {
    const stream = session.promptStreaming(prompt)
    const reader = stream.getReader()
    let previous = ''
    try {
      while (true) {
        if (req.signal?.aborted) {
          yield { type: 'error', message: 'Cancelled' }
          return
        }
        const { value, done } = await reader.read()
        if (done) break
        if (typeof value !== 'string') continue
        // Most versions emit cumulative text; guard against the rarer
        // pure-delta builds by only treating strictly-extending values
        // as cumulative.
        if (value.startsWith(previous)) {
          const delta = value.slice(previous.length)
          if (delta.length > 0) yield { type: 'delta', content: delta }
          previous = value
        } else {
          yield { type: 'delta', content: value }
          previous += value
        }
      }
      yield { type: 'done' }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* swallow */
      }
    }
  } catch (err) {
    if (req.signal?.aborted) {
      yield { type: 'error', message: 'Cancelled' }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `Prompt API stream error: ${msg}` }
  } finally {
    try {
      session.destroy?.()
    } catch {
      /* swallow */
    }
  }
}

export const windowAiProvider: ChatProvider = {
  id: 'window-ai',
  label: 'Chrome built-in (window.ai)',
  defaultBaseUrl: '',
  streamChat: streamWindowAi,
}
