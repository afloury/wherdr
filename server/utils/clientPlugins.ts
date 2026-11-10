// wherdr plugins (client side): DATA_DIR/plugins/<id>/manifest.json + bundle.
// An empty or missing folder is the normal case: no plugin.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './env'
import { PLUGIN_FILE_RE, PLUGIN_ID_RE, parseManifest, type ClientPluginInfo } from '../../shared/clientPlugins'

export const PLUGINS_DIR = path.join(DATA_DIR, 'plugins')

export async function listClientPlugins(dir = PLUGINS_DIR): Promise<ClientPluginInfo[]> {
  let names: string[]
  try { names = await fsp.readdir(dir) } catch { return [] }
  const out: ClientPluginInfo[] = []
  for (const id of names.sort()) {
    if (!PLUGIN_ID_RE.test(id)) continue
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(dir, id, 'manifest.json'), 'utf8'))
      const info = parseManifest(id, raw)
      if (info) out.push(info)
    } catch { /* no manifest or unreadable: not a plugin */ }
  }
  return out
}

// Absolute path of a file of a plugin, or null when the name is not a plain file name.
export function pluginFile(id: string, file: string, dir = PLUGINS_DIR): string | null {
  if (!PLUGIN_ID_RE.test(id) || !PLUGIN_FILE_RE.test(file)) return null
  return path.join(dir, id, file)
}
