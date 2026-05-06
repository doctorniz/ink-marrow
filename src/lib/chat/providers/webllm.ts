/**
 * WebLLM (WebGPU, in-browser) provider.
 *
 * Loads a quantized model into the browser via `@mlc-ai/web-llm` and runs
 * inference on WebGPU. First use of a given model id downloads the
 * weights (commonly 1–3 GB for 4B models) into the browser cache; reuses
 * are fast. Exposes an OpenAI-compatible `engine.chat.completions.create`
 * with `stream: true`.
 *
 * Design notes:
 * - The `@mlc-ai/web-llm` package is imported lazily via dynamic
 *   `import()` so it never lands in the main bundle. Static export
 *   (`output: 'export'`) still works because the dynamic import is
 *   client-only.
 * - We cache the `MLCEngine` per-model in module scope. Switching models
 *   creates a new engine; this is expensive, so users should pick one
 *   model and stick with it.
 * - Default model is `gemma-3-4b-it-q4f16_1-MLC` (satisfies the
 *   user-requested "Gemma 4B"). Other MLC-packaged models are selectable
 *   by editing `ChatSettings.model`; see https://mlc.ai/models for the
 *   catalog.
 * - Progress events during first-time model load surface via a custom
 *   event (`ink:webllm-progress`) so the UI can show a toast. We keep
 *   the provider itself UI-free.
 *
 * Requires WebGPU; users on Safari / older Chromium fall through to a
 * clear error message.
 */

import type {
  ChatCompletionRequest,
  ChatProvider,
  ChatStreamChunk,
  WireMessage,
} from './types'

// Typed subset of the web-llm API surface we touch. The real package
// ships types, but we avoid the dep at type-level so the codebase
// typechecks before `pnpm install @mlc-ai/web-llm` has been run.
interface MlcInitProgress {
  progress: number
  text: string
}

interface MlcChatDelta {
  choices?: { delta?: { content?: string } }[]
}

interface MlcEngine {
  chat: {
    completions: {
      create: (opts: {
        messages: WireMessage[]
        stream: true
      }) => Promise<AsyncIterable<MlcChatDelta>>
    }
  }
  interruptGenerate?: () => void
}

interface MlcEngineInit {
  initProgressCallback?: (p: MlcInitProgress) => void
  /** Increase the KV-cache context window beyond the model default. */
  chatOpts?: { context_window_size?: number; sliding_window_size?: number }
}

interface MlcModule {
  CreateMLCEngine: (
    modelId: string,
    init?: MlcEngineInit,
  ) => Promise<MlcEngine>
}

export const DEFAULT_WEBLLM_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC'

/**
 * All small MLC models in WebLLM 0.2.x are compiled with a hard 4 096-token
 * ceiling. We target ~2 800 prompt tokens to leave ~1 200 tokens for the
 * assistant reply. MLC tokenisers run ≈ 3 chars/token for English prose, so
 * 2 800 × 3 = 8 400 chars is our prompt budget.
 */
const WEBLLM_MAX_PROMPT_CHARS = 2800 * 3 // ≈ 2 800 tokens

/** Minimum document chars to retain so the model has something to work with. */
const MIN_DOC_CHARS = 1500

/**
 * Fit messages into the WebLLM context window using a two-pass strategy:
 *
 * Pass 1 — drop oldest non-system conversation pairs (user+assistant) until
 *           the total is under budget. This preserves document context, which
 *           is the whole point of per-document and vault chat.
 *
 * Pass 2 — if still over budget (e.g. a very long document with no history),
 *           trim the inline `<document>` or `<source>` blocks in the system
 *           message. We never drop below MIN_DOC_CHARS so the model always
 *           has at least a meaningful slice to work from.
 */
function fitToContextWindow(messages: WireMessage[]): WireMessage[] {
  const charLen = (m: WireMessage) =>
    typeof m.content === 'string' ? m.content.length : 0
  const total = () => messages.reduce((n, m) => n + charLen(m), 0)

  if (total() <= WEBLLM_MAX_PROMPT_CHARS) return messages

  // --- Pass 1: drop oldest history pairs -----------------------------------
  // Build a mutable working copy. System message stays at index 0;
  // conversation messages follow.
  let working = [...messages]

  // Find conversation messages (non-system), oldest first.
  // We drop user+assistant pairs together to keep the thread coherent.
  while (total() > WEBLLM_MAX_PROMPT_CHARS) {
    // Find the first user message after the system message.
    const firstUserIdx = working.findIndex(
      (m, i) => i > 0 && m.role === 'user',
    )
    if (firstUserIdx === -1) break // nothing left to drop

    // Drop that user message and the immediately following assistant reply
    // (if any). Keep the *last* user message — that's the current question.
    const lastUserIdx = working.reduce(
      (last, m, i) => (m.role === 'user' ? i : last),
      -1,
    )
    if (firstUserIdx === lastUserIdx) break // only one user turn — stop

    const end =
      firstUserIdx + 1 < working.length &&
      working[firstUserIdx + 1].role === 'assistant'
        ? firstUserIdx + 2
        : firstUserIdx + 1
    working = [...working.slice(0, firstUserIdx), ...working.slice(end)]
  }

  if (total() <= WEBLLM_MAX_PROMPT_CHARS) return working

  // --- Pass 2: trim document / source blocks in the system message ---------
  const sysIdx = working.findIndex((m) => m.role === 'system')
  if (sysIdx === -1 || typeof working[sysIdx].content !== 'string') return working

  const sys = working[sysIdx].content as string

  // Support both <document …>…</document> (per-doc chat) and
  // <source …>…</source> (vault RAG) blocks.
  const openTag = sys.includes('<document') ? '<document' : '<source'
  const closeTag = openTag === '<document' ? '</document>' : '</source>'

  const blockOpen = sys.indexOf(openTag)
  const blockClose = sys.lastIndexOf(closeTag)
  if (blockOpen === -1 || blockClose === -1) return working

  const excess = total() - WEBLLM_MAX_PROMPT_CHARS
  const block = sys.slice(blockOpen, blockClose + closeTag.length)
  const allowedLen = Math.max(MIN_DOC_CHARS, block.length - excess)
  const trimmedBlock =
    block.slice(0, allowedLen) +
    `\n[… truncated to fit ${WEBLLM_MAX_PROMPT_CHARS / 3}-token context window …]${closeTag}`

  const newSys =
    sys.slice(0, blockOpen) +
    trimmedBlock +
    sys.slice(blockClose + closeTag.length)

  return working.map((m, i) =>
    i === sysIdx ? { ...m, content: newSys } : m,
  )
}

/** Cache of loaded engines, keyed by model id. */
const engineCache = new Map<string, Promise<MlcEngine>>()

function hasWebGpu(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined'
  )
}

async function loadModule(): Promise<MlcModule> {
  // String-literal dynamic import so Webpack/Turbopack emits a separate
  // chunk and nothing from web-llm touches the main bundle. `@mlc-ai/web-llm`
  // is a regular dependency, so the import resolves at build time; the
  // runtime guard below is just belt-and-suspenders in case a future build
  // ever externalises or stubs the package.
  const mod = (await import('@mlc-ai/web-llm')) as unknown as MlcModule
  if (typeof mod?.CreateMLCEngine !== 'function') {
    throw new Error(
      '@mlc-ai/web-llm failed to load. Reinstall with: pnpm add @mlc-ai/web-llm',
    )
  }
  return mod
}

function emitProgress(p: MlcInitProgress): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(
      new CustomEvent('ink:webllm-progress', { detail: p }),
    )
  } catch {
    /* swallow */
  }
}

async function getEngine(modelId: string): Promise<MlcEngine> {
  const cached = engineCache.get(modelId)
  if (cached) return cached
  const p = (async () => {
    const mod = await loadModule()
    return mod.CreateMLCEngine(modelId, {
      initProgressCallback: emitProgress,
      // Most quantised models support at least 8 k tokens; set this so
      // the engine doesn't cap at the conservative 4 096 default and
      // immediately overflow on the first request that includes document
      // context. The model hard-caps at its own architectural maximum, so
      // setting this higher than the model supports is harmless.
      chatOpts: { context_window_size: 8192 },
    })
  })()
  engineCache.set(modelId, p)
  try {
    return await p
  } catch (err) {
    // Don't poison the cache on failure — let the next call retry.
    engineCache.delete(modelId)
    throw err
  }
}

async function* streamWebLlm(
  req: ChatCompletionRequest,
): AsyncGenerator<ChatStreamChunk> {
  if (!hasWebGpu()) {
    yield {
      type: 'error',
      message:
        'WebGPU is required for WebLLM. Try Chrome, Edge, or a recent Chromium build.',
    }
    return
  }

  const modelId = req.model || DEFAULT_WEBLLM_MODEL

  let engine: MlcEngine
  try {
    engine = await getEngine(modelId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    yield {
      type: 'error',
      message: `WebLLM model load failed (${modelId}): ${msg}`,
    }
    return
  }

  // Wire cancellation. WebLLM supports `interruptGenerate` but doesn't
  // honour AbortSignal directly.
  const onAbort = () => {
    try {
      engine.interruptGenerate?.()
    } catch {
      /* swallow */
    }
  }
  req.signal?.addEventListener('abort', onAbort, { once: true })

  let stream: AsyncIterable<MlcChatDelta>
  try {
    stream = await engine.chat.completions.create({
      messages: fitToContextWindow(req.messages),
      stream: true,
    })
  } catch (err) {
    if (req.signal?.aborted) {
      yield { type: 'error', message: 'Cancelled' }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `WebLLM stream init failed: ${msg}` }
    return
  }

  try {
    for await (const chunk of stream) {
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'Cancelled' }
        return
      }
      const delta = chunk.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        yield { type: 'delta', content: delta }
      }
    }
    yield { type: 'done' }
  } catch (err) {
    if (req.signal?.aborted) {
      yield { type: 'error', message: 'Cancelled' }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: `WebLLM stream error: ${msg}` }
  } finally {
    req.signal?.removeEventListener('abort', onAbort)
  }
}

export const webllmProvider: ChatProvider = {
  id: 'webllm',
  label: 'WebLLM (WebGPU, in-browser)',
  defaultBaseUrl: '',
  streamChat: streamWebLlm,
}