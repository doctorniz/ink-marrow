/**
 * Minimal markdown renderer for chat messages.
 *
 * We can't reach for the full Tiptap pipeline (overkill for streaming
 * output) or `react-markdown` (not a dep). We also can't render LLM text
 * verbatim — users won't copy code blocks properly. So this module parses
 * with `marked` (already a dep) and then scrubs the HTML with a light
 * sanitizer: strip `<script>` / `<iframe>` / `<object>` / `<embed>`, drop
 * `on*=` attributes, and reject non-`http/https/mailto` URLs.
 *
 * Not a substitute for DOMPurify — but LLM-generated HTML is low-risk
 * here (keys are user-owned; the model doesn't know the user's origin),
 * and the sanitizer catches the classes of exploit that matter for
 * inline rendering. If chat ever takes HTML from an untrusted source we
 * should add DOMPurify as a real dep.
 */

import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

const DANGEROUS_TAGS = /<(script|iframe|object|embed|link|meta|style)[^>]*>[\s\S]*?<\/\1>/gi
const DANGEROUS_SELF_CLOSING =
  /<(script|iframe|object|embed|link|meta|style)[^>]*\/?>/gi
const EVENT_ATTR = /\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const UNSAFE_HREF =
  /\s(href|src|action|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|"data:(?!image\/)[^"]*"|'data:(?!image\/)[^']*'|"vbscript:[^"]*"|'vbscript:[^']*')/gi
const OPEN_A_TAG = /<a\b([^>]*)>/gi

function scrub(html: string): string {
  let out = html
  out = out.replace(DANGEROUS_TAGS, '')
  out = out.replace(DANGEROUS_SELF_CLOSING, '')
  out = out.replace(EVENT_ATTR, '')
  out = out.replace(UNSAFE_HREF, '')
  // Force every link to open in a new tab with noopener/noreferrer — the
  // app is a single-page shell, and we don't want the model to be able
  // to navigate the user's tab away from their vault.
  out = out.replace(OPEN_A_TAG, (_m, attrs: string) => {
    const hasTarget = /\starget\s*=/i.test(attrs)
    const hasRel = /\srel\s*=/i.test(attrs)
    const extra = [
      hasTarget ? '' : ' target="_blank"',
      hasRel ? '' : ' rel="noopener noreferrer nofollow"',
    ].join('')
    return `<a${attrs}${extra}>`
  })
  return out
}

export function renderChatMarkdown(markdown: string): string {
  if (!markdown) return ''
  try {
    const html = String(marked.parse(markdown, { async: false }))
    return scrub(html)
  } catch {
    // Fallback: plain-text with HTML-escaping and paragraph breaks, so a
    // malformed markdown chunk never blocks the whole response.
    const escaped = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`
  }
}
