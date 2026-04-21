import type { Extension } from '@codemirror/state'

/**
 * Map file extensions to CodeMirror language support loaders.
 * Lazy-loaded to keep the initial bundle small.
 */

type LanguageLoader = () => Promise<Extension>

const LANG_MAP: Record<string, LanguageLoader> = {
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  mjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  cjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  mts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  cts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  htm: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  scss: () => import('@codemirror/lang-css').then((m) => m.css()),
  less: () => import('@codemirror/lang-css').then((m) => m.css()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  yml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
}

/**
 * Returns a CodeMirror language extension for the given file extension,
 * or `null` if no language support is available (file will still be editable
 * as plain text with line numbers etc.).
 */
export async function languageFromExtension(ext: string): Promise<Extension | null> {
  const loader = LANG_MAP[ext.toLowerCase()]
  if (!loader) return null
  return loader()
}

/** Get the file extension from a vault path (lowercase, no dot). */
export function extFromPath(path: string): string {
  const name = path.split('/').pop() ?? path
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
