import type { FileSystemAdapter } from '@/lib/fs'
import { createScopedAdapter } from '@/lib/fs'
import {
  type VaultConfig,
  DEFAULT_VAULT_CONFIG,
  MARROW_DIR,
  INBOX_DIR,
  SIGNATURES_DIR,
  TEMPLATES_DIR,
  SNAPSHOTS_DIR,
  CONFIG_FILE,
} from '@/types/vault'
import { uniqueVaultSlug, vaultFolderPath, vaultsRootPath } from '@/lib/vault/paths'

export async function createVault(fs: FileSystemAdapter, name: string): Promise<VaultConfig> {
  const config: VaultConfig = { ...DEFAULT_VAULT_CONFIG, name }

  await fs.mkdir(MARROW_DIR)
  await fs.mkdir(INBOX_DIR)
  await fs.mkdir(SIGNATURES_DIR)
  await fs.mkdir(TEMPLATES_DIR)
  await fs.mkdir(SNAPSHOTS_DIR)

  await fs.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2))

  const defaultNote = [
    '---',
    `title: Welcome to ${name}`,
    `created: ${new Date().toISOString()}`,
    '---',
    '',
    `# Welcome to ${name}`,
    '',
    'Start writing your first note here.',
    '',
  ].join('\n')

  await fs.writeTextFile('inbox.md', defaultNote)

  return config
}

export async function loadVaultConfig(fs: FileSystemAdapter): Promise<VaultConfig> {
  try {
    const raw = await fs.readTextFile(CONFIG_FILE)
    const parsed = JSON.parse(raw) as Partial<VaultConfig>
    return { ...DEFAULT_VAULT_CONFIG, ...parsed }
  } catch {
    return DEFAULT_VAULT_CONFIG
  }
}

export async function saveVaultConfig(
  fs: FileSystemAdapter,
  config: VaultConfig,
): Promise<void> {
  await fs.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export async function isVault(fs: FileSystemAdapter): Promise<boolean> {
  return fs.exists(MARROW_DIR)
}

/**
 * Create a new vault folder under OPFS `vaults/<slug>/` and initialize structure.
 */
export async function bootstrapNewVault(
  rootFs: FileSystemAdapter,
  displayName: string,
): Promise<{ vaultPath: string; config: VaultConfig }> {
  await rootFs.mkdir(vaultsRootPath())
  const slug = uniqueVaultSlug(displayName)
  const folder = vaultFolderPath(slug)
  await rootFs.mkdir(folder)
  const scoped = createScopedAdapter(rootFs, folder)
  const config = await createVault(scoped, displayName)
  return { vaultPath: folder, config }
}
