const VAULTS_ROOT = 'vaults'

export function vaultsRootPath(): string {
  return VAULTS_ROOT
}

export function vaultFolderPath(slug: string): string {
  return `${VAULTS_ROOT}/${slug}`
}

/** URL-safe folder name under vaults/ */
export function slugifyVaultName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'vault'
}

export function uniqueVaultSlug(name: string): string {
  const base = slugifyVaultName(name)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base}-${suffix}`
}
