/**
 * Document-scoped context builder.
 *
 * Pulls the current document's text, caps it, and bakes a system prompt
 * that instructs the model to answer *only* from that content. Naive by
 * design — v1 doesn't tokenize, doesn't rank chunks, and doesn't embed.
 * Users who want whole-vault RAG will use the separate higher-level chat
 * feature (deferred).
 *
 * MD is supported directly; PDF extraction goes through the same PDF.js
 * text layer the search index uses. Canvas / image files are deferred —
 * they currently return their title only, which is enough to let the
 * model know what's open without lying about content it can't see.
 */

import { parseNote } from '@/lib/markdown'
import { loadPdfjs } from '@/lib/pdf/pdfjs-loader'
import { extractBestExcerpt } from '@/lib/chat/vault-rag'
import type { FileSystemAdapter } from '@/lib/fs'
import type { ChatSettings } from '@/types/chat'

/**
 * Trim content at a hard char cap with an explanatory footer so the
 * model doesn't assume it's seeing the whole document.
 */
function cap(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const head = content.slice(0, maxChars)
  return `${head}\n\n[... document truncated at ${maxChars.toLocaleString()} characters ...]`
}

function pdfTextExtractCap(maxChars: number): number {
  // Pull a bit more than the final cap so we don't lose information to
  // mid-word truncation during page concat; the outer `cap` tightens it.
  return Math.min(maxChars * 2, 200_000)
}

async function extractPdfText(
  data: Uint8Array,
  maxChars: number,
): Promise<string> {
  try {
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ data }).promise
    const chunks: string[] = []
    const hardCap = pdfTextExtractCap(maxChars)
    let len = 0
    for (let i = 1; i <= doc.numPages && len < hardCap; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const pageText = tc.items
        .filter((it) => 'str' in it)
        .map((it) => (it as { str: string }).str)
        .join(' ')
      chunks.push(`--- page ${i} ---\n${pageText}`)
      len += pageText.length
    }
    return chunks.join('\n\n')
  } catch {
    return ''
  }
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|pdf|canvas)$/i, '')
}

export interface DocumentContext {
  path: string
  title: string
  /** 'markdown' | 'pdf' | 'other' — drives prompt phrasing. */
  kind: 'markdown' | 'pdf' | 'other'
  content: string
  /** True if content was sliced below the full document length. */
  truncated: boolean
  /** Fraction of the configured cap that ended up as content (0..1). */
  fillRatio: number
}

/**
 * Tokenise a plain-text query into searchable terms (3+ char words, lowercased).
 * Mirrors what MiniSearch would extract so `extractBestExcerpt` can find the
 * same regions the search index scores highest.
 */
function queryToTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2)
}

/**
 * Smart-cap: if the body is within budget return it as-is; otherwise use
 * `extractBestExcerpt` to pick the window most relevant to the user's query
 * (highest density of query-term hits). Falls back to head-truncation when no
 * query is provided, preserving the previous behaviour for large-context models.
 */
function smartCap(body: string, maxChars: number, query?: string): string {
  if (body.length <= maxChars) return body
  if (!query) return cap(body, maxChars)
  const terms = queryToTerms(query)
  if (terms.length === 0) return cap(body, maxChars)
  return extractBestExcerpt(body, terms, maxChars)
}

export async function buildDocumentContext(
  vaultFs: FileSystemAdapter,
  path: string,
  settings: ChatSettings,
  /** Current user query — used to extract the most relevant slice when the
   *  document is too long to fit in the context window. */
  query?: string,
): Promise<DocumentContext> {
  const title = titleFromPath(path)
  const maxChars = Math.max(1_000, settings.maxContextChars || 40_000)

  if (path.toLowerCase().endsWith('.md')) {
    try {
      const raw = await vaultFs.readTextFile(path)
      const doc = parseNote(path, raw)
      const fmTitle =
        (typeof doc.frontmatter.title === 'string' && doc.frontmatter.title) ||
        title
      const body = doc.content ?? ''
      const capped = smartCap(body, maxChars, query)
      return {
        path,
        title: fmTitle,
        kind: 'markdown',
        content: capped,
        truncated: capped.length < body.length,
        fillRatio: Math.min(1, capped.length / maxChars),
      }
    } catch {
      return {
        path,
        title,
        kind: 'markdown',
        content: '',
        truncated: false,
        fillRatio: 0,
      }
    }
  }

  if (path.toLowerCase().endsWith('.pdf')) {
    try {
      const bytes = await vaultFs.readFile(path)
      const raw = await extractPdfText(bytes, maxChars)
      const capped = smartCap(raw, maxChars, query)
      return {
        path,
        title,
        kind: 'pdf',
        content: capped,
        truncated: capped.length < raw.length,
        fillRatio: Math.min(1, capped.length / maxChars),
      }
    } catch {
      return {
        path,
        title,
        kind: 'pdf',
        content: '',
        truncated: false,
        fillRatio: 0,
      }
    }
  }

  return {
    path,
    title,
    kind: 'other',
    content: '',
    truncated: false,
    fillRatio: 0,
  }
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are an assistant embedded inside the user\'s personal notes app.',
  'Answer strictly from the document content provided in this message.',
  'If the answer is not present, say so briefly instead of guessing.',
  'Keep replies concise, use markdown, and cite passages inline when useful.',
].join(' ')

/** Compose the `system` message sent with every chat request. */
export function buildSystemMessage(
  context: DocumentContext,
  settings: ChatSettings,
): string {
  const base = settings.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT
  const header =
    context.kind === 'pdf'
      ? `The user is viewing a PDF titled "${context.title}".`
      : context.kind === 'markdown'
        ? `The user is viewing a markdown note titled "${context.title}".`
        : `The user is viewing a file titled "${context.title}".`

  const note = context.truncated
    ? ' The content below has been truncated — mention this if the answer might be in a later section.'
    : ''

  const body = context.content
    ? `\n\n<document path="${context.path}">\n${context.content}\n</document>`
    : `\n\n(No readable text content was available from this document.)`

  return `${base}\n\n${header}${note}${body}`
}
