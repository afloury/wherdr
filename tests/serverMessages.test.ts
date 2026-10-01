// Messages produced on the server and shown in the app are English, and the
// client translates them (shared/message.ts, app/utils/i18n.ts). This test
// catches a raw French message added on the server, and an error message with
// no French entry.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FR_DICTIONARY, french } from '../app/utils/i18n'
import { fmt } from '../shared/message'
import { readOnlyMessage } from '../shared/projectsActions'
import { agentNotificationTitle } from '../server/utils/push'

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p, ext)
    return ext.test(f) ? [p] : []
  })
}

// Code without its comments (line comments, block comments, shell comments).
const code = (src: string, shell: boolean) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(l => l.replace(shell ? /^\s*#.*$/ : /(^|\s)\/\/.*$/, ''))
  .join('\n')

const FRENCH = /[àâçéèêëîïôûùœ]|\b(introuvable|injoignable|invalide|impossible|dossier|inconnue?|déjà)\b/i
// Places that hold French on purpose: the French half of a bilingual pair
// (lang === 'fr', tl-like pairs, titleFr), and text matched in Herdr's output.
const BILINGUAL = /\blang\b|\bfr\b|Fr\b|\bfr:|introuvable\/i/

// Bilingual by design: the coordinator rules and TASKS.md template written in the
// project's language, and reply markers recognized in both languages.
const BILINGUAL_FILES = new Set(['shared/projectBoard.ts', 'shared/replyQuote.ts'])

const SERVER = [
  ...files('server', /\.ts$/).map(f => ({ f, src: code(readFileSync(f, 'utf8'), false) })),
  ...files('shared', /\.ts$/).map(f => ({ f, src: code(readFileSync(f, 'utf8'), false) })),
  ...files('scripts', /\.sh$/).map(f => ({ f, src: code(readFileSync(f, 'utf8'), true) })),
]

describe('server messages', () => {
  it('contain no raw French outside bilingual pairs', () => {
    const found = SERVER.flatMap(({ f, src }) => src.split('\n').map((l, i) => ({ l, at: `${f}:${i + 1}` })))
      .filter(({ l, at }) => !BILINGUAL_FILES.has(at.split(':')[0]!) && FRENCH.test(l) && /['"`]/.test(l) && !BILINGUAL.test(l))
      .map(({ l, at }) => `${at}: ${l.trim().slice(0, 120)}`)
    expect(found).toEqual([])
  })

  it('give every literal error message a French entry', () => {
    // new HerdrError('code', 'Message') / new AuthError(…) / fail('code', 'Message'),
    // or the template of fmt('… {name} …', {…}) in that position.
    const CALL = /(?:new (?:HerdrError|AuthError|SpaceActionError|SkipMachine)|(?<![\w.])fail)\(\s*'[\w-]*',\s*(?:fmt\()?'((?:[^'\\\n]|\\.)*)'/g
    const missing = SERVER.flatMap(({ f, src }) => [...src.matchAll(CALL)]
      .map(m => m[1]!.replace(/\\(.)/g, '$1'))
      .filter(k => !(k in FR_DICTIONARY))
      .map(k => `${f}: ${k}`))
    expect(missing).toEqual([])
  })

  it('have no duplicate key in the French dictionary', () => {
    const src = readFileSync('app/utils/i18n.ts', 'utf8')
    const keys = [...src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':|, '((?:[^'\\]|\\.)*)':/gm)].map(m => m[1] ?? m[2])
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })

  it('are translated back from a filled template, values included', () => {
    const msg = fmt('{machine} is unreachable: {reason}', { machine: 'laptop', reason: 'Herdr server not responding' })
    expect(msg).toBe('laptop is unreachable: Herdr server not responding')
    expect(french(msg)).toBe('laptop injoignable : Serveur Herdr muet')
    expect(french(fmt('{machine} is unreachable', { machine: 'laptop' }))).toBe('laptop injoignable')
    expect(french(fmt('Not a Git repository: {path}', { path: '~/demo' }))).toBe('Pas un dépôt Git : ~/demo')
    expect(french(fmt('{count} tasks', { count: 3 }))).toBe('3 tâches')
    expect(french('Invalid pane')).toBe('pane invalide')
    expect(french('Some text from Herdr')).toBeUndefined()
  })

  it('explain a read-only home folder in English, translated by the client', () => {
    const raw = 'herdr-projects: could not create /home/demo/.herdr-projects/test: Read-only file system (os error 30)'
    const en = readOnlyMessage(raw, { docker: false })!
    expect(en).toBe('herdr-projects cannot write to /home/demo/.herdr-projects/test: read-only file system.')
    expect(french(en)).toBe('herdr-projects ne peut pas écrire dans /home/demo/.herdr-projects/test : système de fichiers en lecture seule.')
  })

  it('build agent notification titles in both languages', () => {
    expect(agentNotificationTitle('blocked', 'laptop · Claude')).toEqual({ title: 'laptop · Claude needs your input', titleFr: 'laptop · Claude attend ta réponse' })
    expect(agentNotificationTitle('done', 'Codex')).toEqual({ title: 'Codex has finished', titleFr: 'Codex a terminé' })
  })
})
