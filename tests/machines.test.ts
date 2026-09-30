// Multi-machines : IDs préfixés, routage des appels Herdr, profils `herdr machine
// list`, et accès aux fichiers d'une machine distante par commandes shell
// (exécutées ici en local : mêmes scripts POSIX que par SSH).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PANE_RE, isSelfTarget, joinId, machineKey, machineOf, parseMachineList, parseStatusSocket, routeParams, splitId, targetHost } from '../shared/ids'
import { type ShellExec, createShellFs, LIST_DIRS_SCRIPT, parseDirList, parseStatLine, shq } from '../server/utils/fsx'
import { createTranscripts, isMissing } from '../server/utils/transcripts'
import { FsError } from '../server/utils/fsx'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('IDs', () => {
  it('garde les IDs locaux tels quels (liens des notifications déjà envoyées)', () => {
    expect(joinId('', 'w1:p1')).toBe('w1:p1')
    expect(splitId('w1:p1')).toEqual({ machine: '', local: 'w1:p1' })
    expect(PANE_RE.test('w1:p1')).toBe(true)
    expect(PANE_RE.test('wA:p12')).toBe(true)
  })

  it('préfixe les IDs d’une machine distante', () => {
    const k = machineKey('12345678123456781234567812345678')
    expect(k).toBe('12345678')
    const id = joinId(k, 'w1:p1')
    expect(id).toBe('12345678~w1:p1')
    expect(PANE_RE.test(id)).toBe(true)
    expect(splitId(id)).toEqual({ machine: '12345678', local: 'w1:p1' })
    expect(machineOf(id)).toBe('12345678')
    expect(machineOf('w2:p3')).toBe('')
    // encodeURIComponent garde « ~ » : /#/a/12345678~w1:p1
    expect(encodeURIComponent(id)).toBe('12345678~w1%3Ap1')
  })

  it('refuse les IDs mal formés', () => {
    for (const bad of ['', 'p1', 'w1', 'zz~w1:p1', '12345678~', '~w1:p1', '12345678~w1:p1;rm', '../w1:p1']) {
      expect(PANE_RE.test(bad)).toBe(false)
    }
  })
})

describe('routage des appels Herdr', () => {
  it('route vers la machine du pane et rend l’ID local', () => {
    expect(routeParams({ pane_id: '12345678~w1:p2', keys: ['enter'] }))
      .toEqual({ machine: '12345678', params: { pane_id: 'w1:p2', keys: ['enter'] } })
    expect(routeParams({ target: '12345678~w3:p1', text: 'salut' }))
      .toEqual({ machine: '12345678', params: { target: 'w3:p1', text: 'salut' } })
    expect(routeParams({ workspace_id: '12345678~w3' }).params).toEqual({ workspace_id: 'w3' })
  })

  it('reste local sans préfixe, et sans ID', () => {
    expect(routeParams({ pane_id: 'w1:p1' })).toEqual({ machine: '', params: { pane_id: 'w1:p1' } })
    expect(routeParams({})).toEqual({ machine: null, params: {} })
  })

  it('refuse un appel qui mélange deux machines', () => {
    expect(() => routeParams({ pane_id: 'aaaa1111~w1:p1', workspace_id: 'w1' })).toThrow()
  })
})

describe('herdr machine list --json', () => {
  const raw = JSON.stringify([
    { id: '12345678123456781234567812345678', label: 'Laptop', target: 'laptop', session: 'default', enabled: true, selected: false },
    { id: '0123456789abcdef0123456789abcdef', label: 'Éteinte', target: 'box', session: 'default', enabled: false },
    { id: 'abcdef0123456789abcdef0123456789', label: '', target: 'user@serveur', session: 'travail' },
    { id: 'deadbeefdeadbeefdeadbeefdeadbeef', label: 'Piège', target: '-oProxyCommand=evil', session: 'default', enabled: true },
    { id: 'ffffffff00000000ffffffff00000000', label: 'Session bizarre', target: 'h', session: '../x y', enabled: true },
  ])
  const list = parseMachineList(raw)

  it('garde les profils activés, avec une clé courte', () => {
    expect(list.map(m => m.key)).toEqual(['12345678', 'abcdef01', 'ffffffff'])
    expect(list[0]).toEqual({ key: '12345678', id: '12345678123456781234567812345678', label: 'Laptop', target: 'laptop', session: 'default' })
  })

  it('prend la cible comme libellé par défaut, refuse les cibles-options et les sessions invalides', () => {
    expect(list[1]!.label).toBe('user@serveur')
    expect(list[1]!.session).toBe('travail')
    expect(list.some(m => m.target.startsWith('-'))).toBe(false)
    expect(list[2]!.session).toBe('default')
  })

  it('résiste à une sortie illisible', () => {
    expect(parseMachineList('')).toEqual([])
    expect(parseMachineList('{"a":1}')).toEqual([])
  })

  it('ignore les profils qui visent cette machine elle-même (l’ordinateur a le serveur dans ses machines)', () => {
    const raw2 = JSON.stringify([
      { id: '11111111aaaaaaaa11111111aaaaaaaa', label: 'Server', target: 'alice@host-a', session: 'default', enabled: true },
      { id: '22222222bbbbbbbb22222222bbbbbbbb', label: 'Server FQDN', target: 'host-a.example.ts.net', session: 'default', enabled: true },
      { id: '33333333cccccccc33333333cccccccc', label: 'Moi', target: 'localhost', session: 'default', enabled: true },
      { id: '44444444dddddddd44444444dddddddd', label: 'IP', target: 'alice@100.64.0.7:22', session: 'default', enabled: true },
      { id: '12345678123456781234567812345678', label: 'Laptop', target: 'laptop', session: 'default', enabled: true },
    ])
    expect(parseMachineList(raw2, ['host-a', '100.64.0.7']).map(m => m.label)).toEqual(['Laptop'])
    expect(isSelfTarget('127.0.0.1', [])).toBe(true)
    expect(isSelfTarget('laptop', ['host-a'])).toBe(false)
  })

  it('dédoublonne les profils qui visent le même hôte et la même session', () => {
    const raw3 = JSON.stringify([
      { id: '12345678123456781234567812345678', label: 'Laptop', target: 'laptop', session: 'default', enabled: true },
      { id: 'aaaaaaaa00000000aaaaaaaa00000000', label: 'Laptop (FQDN)', target: 'alice@laptop.example.ts.net', session: 'default', enabled: true },
      { id: 'bbbbbbbb00000000bbbbbbbb00000000', label: 'Laptop work', target: 'laptop', session: 'travail', enabled: true },
    ])
    expect(parseMachineList(raw3).map(m => m.label)).toEqual(['Laptop', 'Laptop work'])
    expect(targetHost('alice@Laptop.example.ts.net.')).toBe('laptop')
    expect(targetHost('user@[fd7a::1]:2222')).toBe('fd7a::1')
    expect(targetHost('host:2222')).toBe('host')
    expect(targetHost('10.0.0.5')).toBe('10.0.0.5')
  })

  it('lit le socket dans `herdr status server`', () => {
    const out = 'status: running\nversion: 0.9.1\nendpoint_compatible: yes\nsocket: /Users/alice/.config/herdr/herdr.sock\n'
    expect(parseStatusSocket(out)).toBe('/Users/alice/.config/herdr/herdr.sock')
    expect(parseStatusSocket('status: stopped\n')).toBeNull()
  })
})

// « Machine distante » simulée : les scripts passent par `sh -c`, comme par SSH.
const localSh: ShellExec = (script, args = [], opts = {}) => new Promise((resolve) => {
  const child = spawn('sh', ['-c', script, 'sh', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  const out: Buffer[] = []
  let err = ''
  child.stdout.on('data', (b: Buffer) => out.push(b))
  child.stderr.on('data', (b: Buffer) => { err += b.toString() })
  child.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: err }))
  child.stdin.end(opts.input || undefined)
})

describe('fichiers d’une machine distante (shell)', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'hw-remote-'))
  mkdirSync(path.join(home, 'projets/app/.git'), { recursive: true })
  mkdirSync(path.join(home, 'projets/notes'), { recursive: true })
  mkdirSync(path.join(home, 'projets/node_modules'), { recursive: true })
  mkdirSync(path.join(home, 'projets/.cache'), { recursive: true })
  mkdirSync(path.join(home, "projets/l'apostrophe et espaces"), { recursive: true })
  writeFileSync(path.join(home, 'projets/fichier.txt'), '0123456789')
  const rfs = createShellFs(localSh, { statTtlMs: 0 })

  it('stat (BSD ou GNU) : taille, type, absent', async () => {
    const [f, d, none] = await rfs.statMany([path.join(home, 'projets/fichier.txt'), path.join(home, 'projets'), path.join(home, 'nope')])
    expect(f).toMatchObject({ size: 10, isFile: true, isDir: false })
    expect(d).toMatchObject({ isFile: false, isDir: true })
    expect(none).toBeNull()
    await expect(rfs.stat(path.join(home, 'nope'))).rejects.toThrow()
    expect(parseStatLine('1234 1758860000 Regular File')).toEqual({ size: 1234, mtimeMs: 1758860000000, isFile: true, isDir: false })
    expect(parseStatLine('0 1758860000 regular empty file')!.isFile).toBe(true)
    expect(parseStatLine('x')).toBeNull()
  })

  it('lit une tranche d’octets, un fichier, un dossier', async () => {
    const f = path.join(home, 'projets/fichier.txt')
    expect((await rfs.read(f, 3, 4)).toString()).toBe('3456')
    expect((await rfs.read(f, 8, 100)).toString()).toBe('89')
    expect(await rfs.readFile(f)).toBe('0123456789')
    expect((await rfs.readdir(path.join(home, 'projets'))).sort()).toEqual(['.cache', 'app', 'fichier.txt', "l'apostrophe et espaces", 'node_modules', 'notes'])
  })

  it('liste les sous-dossiers (dépôts Git marqués, cachés et node_modules exclus)', async () => {
    const r = await localSh(LIST_DIRS_SCRIPT, [path.join(home, 'projets')])
    const dirs = parseDirList(r.stdout.toString())
    expect(dirs.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'app', git: true },
      { name: "l'apostrophe et espaces", git: false },
      { name: 'notes', git: false },
    ])
  })

  it('cite les arguments sans jamais les interpréter', async () => {
    const evil = `a'; echo pwned; '$(id)`
    const r = await localSh(`printf %s "$1"`, [evil])
    expect(r.stdout.toString()).toBe(evil)
    expect(shq("it's")).toBe(`'it'\\''s'`)
  })

  it('relit une transcription distante comme une locale', async () => {
    const claudeDir = path.join(home, '.claude/projects/-Users-x')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(path.join(claudeDir, 'abc-123.jsonl'), fx('claude-session.jsonl'))
    const t = createTranscripts({ home, herdr: async () => { throw new Error('pas de Herdr') }, fs: rfs })
    const pane = { id: '12345678~w1:p1', agent: 'claude', cwd: '/Users/x', agentSession: 'abc-123' }
    const r = await t.chat(pane, {})
    expect(r.available).toBe(true)
    expect(r.items!.length).toBeGreaterThan(10)
    expect(await t.preview(pane)).toBe('fini encore')
    const withImg = r.items!.find(i => i.images)!
    const img = await t.image(pane, r.file!, withImg.ref!, 0)
    expect(img!.type).toBe('image/jpeg')
    const size = Buffer.byteLength(fx('claude-session.jsonl'))
    const older = await t.chat(pane, { before: Math.floor(size / 2) })
    expect(older.older).toBe(true)
  })
})

// Lecture distante qui flanche (SSH coupé, délai dépassé) : la conversation
// déjà trouvée ne doit jamais devenir « introuvable » (la vue se viderait).
describe('transcription distante instable', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'hw-flaky-'))
  const dir = path.join(home, '.claude/projects/-Users-x')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'abc-123.jsonl')
  writeFileSync(file, fx('claude-session.jsonl'))
  let mode: 'ok' | 'fail' | 'timeout' = 'ok'
  const flakySh: ShellExec = (script, args, opts) => {
    if (mode === 'fail') return Promise.resolve({ code: 255, stdout: Buffer.alloc(0), stderr: 'Connection closed by remote host' })
    if (mode === 'timeout') return Promise.resolve({ code: null, stdout: Buffer.alloc(0), stderr: '' }) // tué au délai
    return localSh(script, args, opts)
  }
  const fs = createShellFs(flakySh, { statTtlMs: 0 })
  const noHerdr = async () => { throw new Error('pas de Herdr') }
  const pane = { id: '12345678~w1:p1', agent: 'claude', cwd: '/Users/x', agentSession: 'abc-123' }

  it('distingue un fichier absent d’une lecture ratée', () => {
    expect(isMissing(new FsError('ENOENT', 'introuvable : x'))).toBe(true)
    expect(isMissing(new FsError('remote', 'cat: x: No such file or directory'))).toBe(true)
    expect(isMissing(new FsError('remote', 'Connection closed by remote host'))).toBe(false)
    expect(isMissing(new FsError('remote', 'code null'))).toBe(false)
  })

  it('lecture en échec ou délai dépassé : une erreur, jamais « introuvable »', async () => {
    const t = createTranscripts({ home, herdr: noHerdr, fs })
    mode = 'ok'
    expect((await t.chat(pane, {})).available).toBe(true)
    t.forget(pane.id) // relocalisation forcée : c'est elle qui échouait en « not_found »
    const again = createTranscripts({ home, herdr: noHerdr, fs })
    expect((await again.chat(pane, {})).available).toBe(true)
    for (const m of ['fail', 'timeout'] as const) {
      mode = m
      await expect(again.chat(pane, {})).rejects.toThrow()
    }
    mode = 'ok'
    expect((await again.chat(pane, {})).available).toBe(true)
  })

  it('recherche du fichier ratée : on garde le dernier fichier connu', async () => {
    const t = createTranscripts({ home, herdr: noHerdr, fs })
    mode = 'ok'
    const first = await t.chat(pane, {})
    // Session absente d'un sondage (instantané incomplet) et SSH qui flanche.
    mode = 'fail'
    const loc = await t.locate({ ...pane, agentSession: null })
    expect(loc && loc.file).toBe(file)
    mode = 'ok'
    const r = await t.chat({ ...pane, agentSession: null }, {})
    expect(r.available).toBe(true)
    expect(r.file).toBe(first.file)
  })

  it('fichier vraiment supprimé : « introuvable »', async () => {
    const other = path.join(dir, 'gone-1.jsonl')
    writeFileSync(other, fx('claude-session.jsonl'))
    const t = createTranscripts({ home, herdr: noHerdr, fs })
    mode = 'ok'
    const p = { ...pane, id: '12345678~w1:p2', agentSession: 'gone-1' }
    expect((await t.chat(p, {})).available).toBe(true)
    const { rmSync } = await import('node:fs')
    rmSync(other)
    t.forget(p.id)
    expect(await t.chat(p, {})).toEqual({ available: false, reason: 'not_found' })
  })
})
