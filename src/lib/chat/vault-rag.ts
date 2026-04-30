/**
 * Vault-scoped RAG (v1, MiniSearch-backed).
 *
 * The tier-1 "whole vault" chat surface needs to answer questions that span
 * every note/PDF in the vault — but pasting the whole vault into the model
 * is wasteful at best and impossible at scale. v1 reuses the existing
 * MiniSearch index (built at vault open in `lib/search/index.ts`) to find
 * the top-K most relevant documents for the user's prompt, then pulls an
 * excerpt around the best-matching region of each.
 *
 * This is deliberately *not* embedding-based. MiniSearch is already in the
 * bundle, the index is already warm, and lexical search is surprisingly
 * good at "what did I write about X?" queries that dominate PKM use. A
 * true embeddings path (Transformers.js or a vector service) is deferred —
 * see docs/LAUNCH_DEFERRALS.md.
 *
 * Tradeoffs accepted in v1:
 *   - Purely lexical: synonyms/paraphrase can miss relevant docs.
 *   - Canvas files are indexed by title only, so RAG excerpts won't pull
 *     from drawings.
 *   - Truncated — we cap both the per-doc excerpt length and the overall
 *     context so the prompt stays under `maxContextChars`.
 */

import { getSearchIndex } from '@/lib/search'
import { parseNote } from '@/lib/markdown'
import { loadPdfjs } from '@/lib/pdf/pdfjs-loader'
import type { FileSystemAdapter } from '@/lib/fs'
import type { SearchIndexDocument } from '@/types/search'
import type { ChatSettings } from '@/types/chat'

/** Default number of matches to pull in per query. */
export const DEFAULT_RAG_TOP_K = 6

/** Max per-doc excerpt in characters — keeps a single 200-page PDF from dominating. */
const PER_DOC_EXCERPT_CHARS = 3_000

/** Hard minimum so we never return an empty context for a matched doc. */
const MIN_EXCERPT_CHARS = 400

export interface VaultRagHit {
  path: string
  title: string
  type: 'markdown' | 'pdf' | 'canvas' | 'spreadsheet'
  score: number
  excerpt: string
}

export interface VaultContext {
  query: string
  hits: VaultRagHit[]
  /** Concatenated excerpts, ready to paste into a system prompt. */
  content: string
  /** True if we trimmed hits or excerpts to fit under the char budget. */
  truncated: boolean
  /** Fraction of the configured cap that ended up as content (0..1). */
  fillRatio: number
}

interface RawHit {
  id: string
  path: string
  title: string
  type: 'markdown' | 'pdf' | 'canvas' | 'spreadsheet'
  score: number
  content: string
  queryTerms: string[]
}

/** Run a MiniSearch query and coerce the raw results into a shape we can work with. */
function searchTopK(query: string, topK: number): RawHit[] {
  const index = getSearchIndex()
  const q = query.trim()
  if (!q) return []
  // `prefix: true` + `fuzzy: 0.2` is already the default on the shared index,
  // which gives us a useful recall floor for typo-ed queries.
  const raw = index.search(q).slice(0, topK)
  return raw.map((r) => {
    const doc = r as unknown as SearchIndexDocument
    return {
      id: String(r.id),
      path: doc.path,
      title: doc.title,
      type: doc.fileType,
      score: r.score,
      content: doc.content ?? '',
      queryTerms: r.queryTerms,
    }
  })
}

/**
 * Pick a window around the first occurrence of any query term. This is a
 * cheap "best-region" heuristic that works surprisingly well for the PKM
 * shape of prompts (short, factual) without needing a tokenizer.
 */
function extractExcerpt(content: string, terms: string[], maxChars: number): string {
  if (content.length <= maxChars) return content
  const lower = content.toLowerCase()
  let hitAt = -1
  for (const term of terms) {
    const t = term.toLowerCase()
    const i = lower.indexOf(t)
    if (i >= 0 && (hitAt === -1 || i < hitAt)) hitAt = i
  }
  if (hitAt < 0) return content.slice(0, maxChars)
  const half = Math.floor(maxChars / 2)
  const start = Math.max(0, hitAt - half)
  const end = Math.min(content.length, start + maxChars)
  // Expand backwards on word boundary where cheap; keeps snippets readable.
  const leftEllipsis = start > 0 ? '…' : ''
  const rightEllipsis = end < content.length ? '…' : ''
  return `${leftEllipsis}${content.slice(start, end)}${rightEllipsis}`
}

/**
 * For PDFs the search index holds extracted text already, but older indexes
 * may predate the PDF indexer. Fall back to re-extracting from disk when
 * the stored content is empty.
 */
async function rehydrateIfEmpty(
  hit: RawHit,
  vaultFs: FileSystemAdapter,
): Promise<string> {
  if (hit.content.length > 0) return hit.content
  try {
    if (hit.type === 'markdown') {
      const raw = await vaultFs.readTextFile(hit.path)
      return parseNote(hit.path, raw).content ?? ''
    }
    if (hit.type === 'pdf') {
      const bytes = await vaultFs.readFile(hit.path)
      const pdfjs = await loadPdfjs()
      const doc = await pdfjs.getDocument({ data: bytes }).promise
      const chunks: string[] = []
      const pages = Math.min(doc.numPages, 30)
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        chunks.push(
          tc.items
            .filter((it) => 'str' in it)
            .map((it) => (it as { str: string }).str)
            .join(' '),
        )
      }
      return chunks.join('\n\n')
    }
  } catch {
    /* fall through */
  }
  return ''
}

function fmtKind(type: VaultRagHit['type']): string {
  return type === 'markdown' ? 'note' : type
}

/**
 * Run the RAG pass. Returns a ready-to-embed context block plus the raw
 * hits so the UI can show "sources" chips if desired.
 */
export async function buildVaultContext(
  vaultFs: FileSystemAdapter,
  query: string,
  settings: ChatSettings,
  opts: { topK?: number } = {},
): Promise<VaultContext> {
  const topK = opts.topK ?? DEFAULT_RAG_TOP_K
  const maxChars = Math.max(1_000, settings.maxContextChars || 40_000)

  const raw = searchTopK(query, topK)
  if (raw.length === 0) {
    return {
      query,
      hits: [],
      content: '',
      truncated: false,
      fillRatio: 0,
    }
  }

  // Budget excerpts so the sum stays under `maxChars`. Give each hit at
  // least `MIN_EXCERPT_CHARS` if its share would otherwise shrink too far.
  const perDoc = Math.max(
    MIN_EXCERPT_CHARS,
    Math.min(PER_DOC_EXCERPT_CHARS, Math.floor(maxChars / raw.length)),
  )

  const hits: VaultRagHit[] = []
  let total = 0
  let truncated = false

  for (const r of raw) {
    const content = await rehydrateIfEmpty(r, vaultFs)
    const excerpt = extractExcerpt(content, r.queryTerms, perDoc)
    // Stop adding hits once we'd exceed the cap; never drop mid-excerpt.
    if (total + excerpt.length > maxChars) {
      truncated = true
      break
    }
    hits.push({
      path: r.path,
      title: r.title,
      type: r.type,
      score: r.score,
      excerpt,
    })
    total += excerpt.length
  }

  const body = hits
    .map(
      (h, i) =>
        `<source index="${i + 1}" path="${h.path}" title="${h.title}" kind="${fmtKind(h.type)}">\n${h.excerpt}\n</source>`,
    )
    .join('\n\n')

  return {
    query,
    hits,
    content: body,
    truncated,
    fillRatio: Math.min(1, total / maxChars),
  }
}

const DEFAULT_VAULT_SYSTEM_PROMPT = [
  'You are an assistant embedded inside the user\'s personal notes app.',
  'Answer strictly from the <source> blocks provided below.',
  'Cite sources inline by their path in backticks (e.g. `Notes/Plan.md`) so the user can jump to them.',
  'If the sources do not contain the answer, say so briefly instead of guessing.',
  'Keep replies concise and use markdown.',
].join(' ')

export function buildVaultSystemMessage(
  context: VaultContext,
  settings: ChatSettings,
): string {
  const base = settings.systemPrompt?.trim() || DEFAULT_VAULT_SYSTEM_PROMPT

  if (context.hits.length === 0) {
    return `${base}\n\n(No vault content matched the user's question — tell them you couldn't find anything relevant and ask them to rephrase.)`
  }

  const note = context.truncated
    ? ' Only the top-matching excerpts were included; more vault content may exist.'
    : ''

  return `${base}\n\nThe following excerpts were retrieved from the user's vault.${note}\n\n${context.content}`
}
