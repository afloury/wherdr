// Herdr theme, for the "Follow Herdr" option: [theme] section of
// ~/.config/herdr/config.toml, read-only (TOML subset:
// tables, `key = "text"` or boolean, comments).
import fs from 'node:fs'
import path from 'node:path'
import type { HerdrThemeConfig } from '../../shared/types'
import { HOME } from './env'

// Color value accepted by Herdr AND safe in CSS.
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/i

export function parseHerdrTheme(toml: string): HerdrThemeConfig {
  const out: HerdrThemeConfig = { name: null, autoSwitch: false, darkName: null, lightName: null, custom: {}, customLight: {}, customDark: {} }
  let table = ''
  for (const raw of String(toml || '').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const h = line.match(/^\[\s*([^\]]+?)\s*\]$/)
    if (h) { table = h[1]!.replace(/\s+/g, ''); continue }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(true|false))\s*$/)
    if (!kv) continue
    const key = kv[1]!
    const str = kv[2] ?? kv[3]
    const bool = kv[4]
    if (table === 'theme') {
      if (key === 'auto_switch' && bool) out.autoSwitch = bool === 'true'
      else if (str !== undefined && NAME.test(str)) {
        if (key === 'name') out.name = str
        else if (key === 'dark_name') out.darkName = str
        else if (key === 'light_name') out.lightName = str
      }
      continue
    }
    const target = table === 'theme.custom' ? out.custom : table === 'theme.custom.light' ? out.customLight : table === 'theme.custom.dark' ? out.customDark : null
    if (target && str !== undefined && /^[a-z_]{1,32}$/.test(key) && (COLOR.test(str) || str === 'reset')) target[key] = str
  }
  return out
}

export async function readHerdrTheme(): Promise<HerdrThemeConfig | null> {
  try { return parseHerdrTheme(await fs.promises.readFile(path.join(HOME, '.config/herdr/config.toml'), 'utf8')) }
  catch { return null }
}
