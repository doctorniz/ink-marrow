'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  FileText,
  FileUp,
  Layout,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { useVaultSession } from '@/contexts/vault-fs-context'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import { useEditorStore } from '@/stores/editor'
import { DEFAULT_VAULT_CONFIG, ViewMode } from '@/types/vault'
import type { PdfNewPageOptions } from '@/types/pdf'
import { insertBlankPage } from '@/lib/pdf/page-operations'
import {
  listTemplates,
  readTemplate,
  saveTemplate,
  deleteTemplate,
  type NoteTemplate,
} from '@/lib/notes/template-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'
import { PDFDocument } from 'pdf-lib'
import { createEmptyCanvasJson } from '@/lib/canvas/serializer'

/* ------------------------------------------------------------------ */
/*  Folder picker helper                                               */
/* ------------------------------------------------------------------ */

function useFolderList() {
  const { vaultFs } = useVaultSession()
  const [folders, setFolders] = useState<string[]>(['/'])

  useEffect(() => {
    void (async () => {
      const result: string[] = ['/']
      async function walk(dir: string) {
        try {
          const entries = await vaultFs.readdir(dir)
          for (const e of entries) {
            if (e.isDirectory && !e.name.startsWith('_') && !e.name.startsWith('.')) {
              const p = dir === '/' ? `/${e.name}` : `${dir}/${e.name}`
              result.push(p)
              await walk(p)
            }
          }
        } catch { /* ignore */ }
      }
      await walk('/')
      setFolders(result)
    })()
  }, [vaultFs])

  return folders
}

/* ------------------------------------------------------------------ */
/*  Markdown note creator                                              */
/* ------------------------------------------------------------------ */

function NewMarkdownNote({ templates, templateFolder }: { templates: NoteTemplate[]; templateFolder: string }) {
  const { vaultFs } = useVaultSession()
  const setActiveView = useUiStore((s) => s.setActiveView)
  const openTab = useEditorStore((s) => s.openTab)
  const defaultFolder = useVaultStore(
    (s) => s.config?.defaultNewFileFolder ?? DEFAULT_VAULT_CONFIG.defaultNewFileFolder,
  )

  const folders = useFolderList()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(defaultFolder)
  const [templateId, setTemplateId] = useState<string | ''>('')

  const create = useCallback(async () => {
    const stem = name.trim() || `Note ${new Date().toISOString().slice(0, 10)}`
    const filename = stem.endsWith('.md') ? stem : `${stem}.md`
    const dir = folder === '/' ? '' : folder
    const filePath = `${dir}/${filename}`.replace(/^\/+/, '')

    let content = `---\ntitle: "${stem.replace(/\.md$/, '')}"\ndate: "${new Date().toISOString()}"\ntags: []\n---\n\n`

    if (templateId) {
      try {
        content = await readTemplate(vaultFs, templateId, templateFolder)
      } catch { /* fall through to default */ }
    }

    await vaultFs.writeTextFile(filePath, content)

    openTab({
      id: crypto.randomUUID(),
      path: filePath,
      type: 'markdown',
      title: stem.replace(/\.md$/, ''),
      isDirty: false,
    })
    setActiveView(ViewMode.Vault)
  }, [name, folder, templateId, vaultFs, openTab, setActiveView])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Note name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled"
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Folder
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === '/' ? 'Root' : f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-fg-secondary flex flex-col gap-1 text-xs">
        Template
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
        >
          <option value="">Blank</option>
          {templates.map((t) => (
            <option key={t.id} value={t.filename}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" onClick={() => void create()}>
        <Plus className="size-3.5" /> Create note
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  PDF note creator                                                   */
/* ------------------------------------------------------------------ */

type PageStyle = PdfNewPageOptions['style']
type PageSize = PdfNewPageOptions['size']

function NewPdfNote() {
  const { vaultFs } = useVaultSession()
  const setActiveView = useUiStore((s) => s.setActiveView)

  const folders = useFolderList()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('/')
  const [style, setStyle] = useState<PageStyle>('blank')
  const [size, setSize] = useState<PageSize>('a4')

  const create = useCallback(async () => {
    const stem = name.trim() || `PDF ${new Date().toISOString().slice(0, 10)}`
    const filename = stem.endsWith('.pdf') ? stem : `${stem}.pdf`
    const dir = folder === '/' ? '' : folder
    const path = `${dir}/${filename}`.replace(/^\/+/, '')

    const blankDoc = await PDFDocument.create()
    const blankBytes = await blankDoc.save()
    const opts: PdfNewPageOptions = { style, size }
    const pdfBytes = await insertBlankPage(blankBytes, 0, opts)
    await vaultFs.writeFile(path, pdfBytes)

    setActiveView(ViewMode.Vault)
  }, [name, folder, style, size, vaultFs, setActiveView])

  const styles: { value: PageStyle; label: string }[] = [
    { value: 'blank', label: 'Blank' },
    { value: 'lined', label: 'Lined' },
    { value: 'grid', label: 'Grid' },
  ]

  const sizes: { value: PageSize; label: string }[] = [
    { value: 'a4', label: 'A4' },
    { value: 'letter', label: 'Letter' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled"
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Folder
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === '/' ? 'Root' : f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-3">
        <fieldset className="space-y-1">
          <legend className="text-fg-secondary text-xs">Page style</legend>
          <div className="flex gap-1.5">
            {styles.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  style === s.value
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-bg-secondary text-fg-secondary hover:bg-bg-hover',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="text-fg-secondary text-xs">Page size</legend>
          <div className="flex gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSize(s.value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  size === s.value
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-bg-secondary text-fg-secondary hover:bg-bg-hover',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <Button size="sm" onClick={() => void create()}>
        <Plus className="size-3.5" /> Create PDF note
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Canvas creator                                                     */
/* ------------------------------------------------------------------ */

function NewCanvas() {
  const { vaultFs } = useVaultSession()
  const setActiveView = useUiStore((s) => s.setActiveView)
  const openTab = useEditorStore((s) => s.openTab)

  const folders = useFolderList()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('/')

  const create = useCallback(async () => {
    const stem = name.trim() || `Drawing ${new Date().toISOString().slice(0, 10)}`
    const filename = stem.endsWith('.canvas') ? stem : `${stem}.canvas`
    const dir = folder === '/' ? '' : folder
    const filePath = `${dir}/${filename}`.replace(/^\/+/, '')

    await vaultFs.writeTextFile(filePath, createEmptyCanvasJson())

    openTab({
      id: crypto.randomUUID(),
      path: filePath,
      type: 'canvas',
      title: stem.replace(/\.canvas$/, ''),
      isDirty: false,
    })
    setActiveView(ViewMode.Vault)
  }, [name, folder, vaultFs, openTab, setActiveView])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Drawing name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled"
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          />
        </label>
        <label className="text-fg-secondary flex flex-col gap-1 text-xs">
          Folder
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="border-border bg-bg-secondary text-fg rounded-md border px-2.5 py-2 text-sm"
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === '/' ? 'Root' : f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button size="sm" onClick={() => void create()}>
        <Plus className="size-3.5" /> Create drawing
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Template manager                                                   */
/* ------------------------------------------------------------------ */

function TemplateManager({
  templates,
  templateFolder,
  onRefresh,
}: {
  templates: NoteTemplate[]
  templateFolder: string
  onRefresh: () => void
}) {
  const { vaultFs } = useVaultSession()
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('---\ntitle: ""\ntags: []\n---\n\n')

  async function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const filename = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
    await saveTemplate(vaultFs, filename, newContent, templateFolder)
    setNewName('')
    setNewContent('---\ntitle: ""\ntags: []\n---\n\n')
    onRefresh()
  }

  async function handleDelete(filename: string) {
    await deleteTemplate(vaultFs, filename, templateFolder)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <h3 className="text-fg text-sm font-semibold">Templates</h3>
      {templates.length === 0 && (
        <p className="text-fg-muted text-xs">No templates yet.</p>
      )}
      <ul className="space-y-1.5">
        {templates.map((t) => (
          <li
            key={t.id}
            className="border-border bg-bg-secondary flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <span className="text-fg">{t.name}</span>
            <button
              type="button"
              aria-label={`Delete template ${t.name}`}
              onClick={() => void handleDelete(t.filename)}
              className="text-fg-muted hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-border space-y-2 rounded-lg border p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Template name"
          aria-label="Template name"
          className="border-border bg-bg text-fg w-full rounded-md border px-2.5 py-1.5 text-sm"
        />
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={5}
          aria-label="Template content"
          className="border-border bg-bg text-fg w-full rounded-md border px-2.5 py-1.5 font-mono text-xs"
        />
        <Button size="sm" variant="secondary" onClick={() => void handleCreate()}>
          <Plus className="size-3.5" /> Add template
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  New view root                                                      */
/* ------------------------------------------------------------------ */

type Tab = 'markdown' | 'pdf' | 'canvas' | 'templates'

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'markdown', label: 'Markdown Note', icon: FileText },
  { id: 'pdf', label: 'PDF Note', icon: FileUp },
  { id: 'canvas', label: 'Drawing', icon: Layout },
  { id: 'templates', label: 'Templates', icon: Settings },
]

export function NewView() {
  const { vaultFs } = useVaultSession()
  const templateFolder = useVaultStore(
    (s) => s.config?.templateFolder ?? DEFAULT_VAULT_CONFIG.templateFolder,
  )
  const [tab, setTab] = useState<Tab>('markdown')
  const [templates, setTemplates] = useState<NoteTemplate[]>([])

  const refresh = useCallback(() => {
    void listTemplates(vaultFs, templateFolder).then(setTemplates)
  }, [vaultFs, templateFolder])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex h-full flex-col p-6 sm:p-8">
      <h2 className="text-fg text-2xl font-semibold tracking-tight">Create</h2>
      <p className="text-fg-secondary mt-1 text-sm">
        Start a new markdown note, PDF note, or drawing.
      </p>

      <div className="border-border mt-6 flex gap-1 border-b">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
              tab === id
                ? 'border-accent text-accent border-b-2'
                : 'text-fg-secondary hover:text-fg border-b-2 border-transparent',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-xl">
        {tab === 'markdown' && <NewMarkdownNote templates={templates} templateFolder={templateFolder} />}
        {tab === 'pdf' && <NewPdfNote />}
        {tab === 'canvas' && <NewCanvas />}
        {tab === 'templates' && <TemplateManager templates={templates} templateFolder={templateFolder} onRefresh={refresh} />}
      </div>
    </div>
  )
}
