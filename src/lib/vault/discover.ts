import type { FileSystemAdapter } from '@/lib/fs'
import { createScopedAdapter } from '@/lib/fs'
import { isVault } from '@/lib/vault'
import { vaultsRootPath } from '@/lib/vault/paths'

export interface DiscoverableVault {
  /** Path from OPFS root, e.g. `vaults/my-vault-abc123` */
  path: string
  /** Display name from config if readable, else folder name */
  displayName: string
}

/** Ensure `vaults/` exists and return list of folders that look like vaults. */
export async function discoverVaults(rootFs: FileSystemAdapter): Promise<DiscoverableVault[]> {
  const root = vaultsRootPath()
  if (!(await rootFs.exists(root))) {
    await rootFs.mkdir(root)
    return []
  }

  const entries = await rootFs.readdir(root)
  const dirs = entries.filter((e) => e.isDirectory)
  const out: DiscoverableVault[] = []

  for (const dir of dirs) {
    const scoped = createScopedAdapter(rootFs, dir.path)
    const valid = await isVault(scoped)
    if (!valid) continue

    let displayName = dir.name
    try {
      const raw = await scoped.readTextFile('_marrow/config.json')
      const parsed = JSON.parse(raw) as { name?: string }
      if (parsed.name) displayName = parsed.name
    } catch {
      // keep folder name
    }

    out.push({ path: dir.path, displayName })
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName))
}
