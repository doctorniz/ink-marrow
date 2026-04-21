import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * A CodeMirror theme that reads the app's CSS variables so it follows
 * the user's Light / Dark / System preference automatically.
 */
export const inkEditorTheme = EditorView.theme(
  {
    '&': {
      fontSize: '14px',
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      height: '100%',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'var(--color-fg)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-fg)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: 'var(--color-accent-muted, rgba(96,165,250,0.25))',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--color-bg-hover)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-bg-secondary)',
      color: 'var(--color-fg-muted)',
      borderRight: '1px solid var(--color-border)',
      minWidth: '3em',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-bg-hover)',
      color: 'var(--color-fg)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
      fontSize: '13px',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--color-accent-muted, rgba(96,165,250,0.3))',
      outline: '1px solid var(--color-accent, #3b82f6)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(255,200,0,0.3)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(255,200,0,0.5)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-bg-tertiary)',
      border: '1px solid var(--color-border)',
      color: 'var(--color-fg-muted)',
      padding: '0 4px',
      borderRadius: '3px',
    },
  },
  { dark: false },
)

/**
 * Syntax highlight style using the app's `--hl-*` CSS variables
 * (same colours as the Tiptap code blocks).
 */
export const inkHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--hl-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.definition(t.variableName))], color: 'var(--hl-function)' },
    { tag: [t.number, t.integer, t.float, t.bool], color: 'var(--hl-number)' },
    { tag: [t.tagName, t.angleBracket], color: 'var(--hl-tag)' },
    { tag: [t.attributeName], color: 'var(--hl-attr)' },
    { tag: [t.typeName, t.className, t.namespace], color: 'var(--hl-builtin)' },
    { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: 'var(--hl-operator)' },
    { tag: [t.punctuation, t.separator, t.paren, t.squareBracket, t.brace], color: 'var(--hl-punctuation)' },
    { tag: [t.variableName], color: 'var(--color-fg)' },
    { tag: [t.definition(t.variableName)], color: 'var(--hl-function)' },
    { tag: [t.propertyName], color: 'var(--hl-attr)' },
    { tag: [t.meta], color: 'var(--hl-comment)' },
  ]),
)
