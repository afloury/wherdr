// Every English key passed to t('…') has a French entry (otherwise French users
// see English), and every French entry is still used somewhere in the code.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FR_DICTIONARY, t, tl } from '../app/utils/i18n'

// Messages that come from Herdr itself or from a remote shell probe
// (forwarded as-is, then translated).
const EXTERNAL = new Set(['timed out waiting for agent startup', 'herdr not found'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(vue|ts)$/.test(f) ? [p] : []
  })
}

const SOURCES = [...files('app'), ...files('server'), ...files('shared')]
  .filter(f => !f.endsWith('utils/i18n.ts'))
  .map(f => ({ f, src: readFileSync(f, 'utf8') }))

// Plain string literals ('…', "…", `…` without ${}) in a piece of code.
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g
const unescape = (s: string) => s.replace(/\\(.)/g, '$1')
function literals(code: string): string[] {
  return [...code.matchAll(LITERAL)].map(m => unescape(m[1] ?? m[2] ?? m[3] ?? '')).filter(Boolean)
}

// The argument text of each t(…) call: balanced parentheses, quotes skipped.
function tArguments(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/(?<![\w.$])t\(/g)) {
    let i = m.index! + m[0].length, depth = 0, quote = ''
    const start = i
    for (; i < src.length; i++) {
      const c = src[i]!
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = ''
        continue
      }
      if (c === '\'' || c === '"' || c === '`') quote = c
      else if (c === '(') depth++
      else if (c === ')' && depth-- === 0) break
    }
    out.push(src.slice(start, i))
  }
  return out
}

describe('i18n', () => {
  it('has a French entry for every t() key used in the code', () => {
    const missing = SOURCES.flatMap(({ f, src }) =>
      tArguments(src).flatMap(literals).filter(k => !(k in FR_DICTIONARY)).map(k => `${f}: ${k}`))
    expect(missing).toEqual([])
  })

  it('has no unused French entry', () => {
    // Used = quoted somewhere: in t(), in a label table, or in a server error message.
    const all = SOURCES.map(s => s.src).join('\n')
    const quoted = (k: string) => [`'${k.replace(/'/g, '\\\'')}'`, `"${k}"`, `\`${k}\``].some(q => all.includes(q))
    const unused = Object.keys(FR_DICTIONARY).filter(k => !quoted(k) && !EXTERNAL.has(k))
    expect(unused).toEqual([])
  })

  it('uses English keys: entries are not French-to-English leftovers', () => {
    const french = Object.keys(FR_DICTIONARY).filter(k => /[àâçéèêëîïôûùœ]/i.test(k))
    expect(french).toEqual([])
  })

  it('shows English as-is outside French', () => {
    expect(t('Rename pane')).toBe('Rename pane')
    expect(t('Text with no entry')).toBe('Text with no entry')
    expect(tl('English', 'Français')).toBe('English')
  })
})
