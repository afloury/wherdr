// Transcriptions : Claude (lignes réelles d'une session de test + quelques lignes
// synthétiques) et Codex (rollout de test réduit + appels d'outils synthétiques).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranscripts, parseLines, stripBlobs } from '../server/utils/transcripts'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const HOME = '/home/user'

describe('Claude', () => {
  const items = parseLines(fx('claude-session.jsonl'), 'claude', 0, HOME)
  const texts = items.map(i => `${i.role}:${i.text}`)

  it('garde les messages de l’utilisateur et les réponses', () => {
    expect(texts).toContain('user:Réponds seulement par le mot : pong')
    expect(texts).toContain('assistant:pong')
    expect(texts).toContain('assistant:ok')
  })

  it('résume les outils (chemins raccourcis en ~) et marque les erreurs', () => {
    const write = items.find(i => i.role === 'tool' && i.name === 'Write')!
    expect(write.text).toBe('~/dev/sandbox/hello.txt')
    const sleep = items.find(i => i.role === 'tool' && i.name === 'Bash' && i.text === 'Wait 25 seconds')!
    expect(sleep.error).toBe(true)
    const ask = items.find(i => i.role === 'tool' && i.name === 'AskUserQuestion')!
    expect(ask.text).toMatch(/couleur/)
  })

  it('montre un message pris en cours de tour (attachment queued_command)', () => {
    expect(texts).toContain('user:Ensuite, réponds aussi : encore')
  })

  it('suit la file d’attente de Claude (enqueue, remove, dequeue)', () => {
    expect(items.queue).toEqual([{ text: 'Encore une chose', ts: '2026-09-25T11:40:05.000Z' }])
  })

  it('compte les images et garde la position de la ligne', () => {
    const img = items.find(i => i.role === 'user' && i.images)!
    expect(img.images).toBe(1)
    expect(img.text).toBe('Regarde cette image et décris-la en 3 mots maximum.')
    expect(img.ref).toMatch(/^\d+:\d+$/)
  })

  it('traduit compactage, interruption et commandes ; ignore le bruit et les sous-agents', () => {
    expect(texts).toContain('system:Conversation compactée')
    expect(texts).toContain('system:Interrompu')
    expect(texts).toContain('cmd:/compact garde le plan')
    expect(texts).toContain('cmd:/context')
    expect(texts.some(t => t.includes('bruit'))).toBe(false)
    expect(texts.some(t => t.includes('sous-agent'))).toBe(false)
    expect(texts.some(t => t.includes('Context Usage'))).toBe(false) // isMeta
    expect(texts.some(t => t.includes('task-notification'))).toBe(false)
  })

  it('vide les images base64 des très longues lignes avant JSON.parse', () => {
    const big = JSON.stringify({ type: 'user', message: { content: [{ type: 'image', source: { data: 'A'.repeat(60000) } }] } })
    const s = stripBlobs(big)
    expect(s.length).toBeLessThan(200)
    expect(JSON.parse(s).message.content[0].source.data).toBe('')
  })
})

describe('Codex', () => {
  const items = parseLines(fx('codex-rollout.jsonl'), 'codex')
  it('garde les vrais messages (pas le contexte d’environnement)', () => {
    const msgs = items.filter(i => i.role !== 'tool').map(i => `${i.role}:${i.text}`)
    expect(msgs[0]).toBe('user:Réponds juste : pong')
    expect(msgs[1]).toBe('assistant:pong')
    expect(msgs.some(m => m.includes('environment_context'))).toBe(false)
  })
  it('résume les appels d’outils', () => {
    const tools = items.filter(i => i.role === 'tool').map(i => `${i.name}:${i.text}`)
    expect(tools).toEqual(['shell:bash -lc ls -la', 'exec:git status --short', 'exec:write_stdin', 'shell:npm test'])
  })
  it('compte les images', () => {
    const img = items.find(i => i.images)!
    expect(img.text).toBe('Regarde ça')
    expect(img.images).toBe(1)
  })
})

describe('createTranscripts', () => {
  // Un $HOME temporaire avec une transcription Claude et une rollout Codex.
  const home = mkdtempSync(path.join(tmpdir(), 'hw-home-'))
  const claudeDir = path.join(home, '.claude/projects/-home-x')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(path.join(claudeDir, 'abc-123.jsonl'), fx('claude-session.jsonl'))
  const codexDir = path.join(home, '.codex/sessions/2026/09/25')
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(path.join(codexDir, 'rollout-2026-09-25T21-29-56-00000000-0000-4000-8000-00000000c0de.jsonl'), fx('codex-rollout.jsonl'))
  const herdr = async () => { throw new Error('pas de Herdr dans les tests') }
  const t = createTranscripts({ home, herdr })
  const claude = { id: 'w1:p1', agent: 'claude', cwd: '/home/x', agentSession: 'abc-123' }

  it('retrouve la transcription par l’identifiant de session et répond « inchangé »', async () => {
    const r = await t.chat(claude, {})
    expect(r.available).toBe(true)
    expect(r.file).toBe('abc-123.jsonl')
    expect(r.items!.length).toBeGreaterThan(10)
    const again = await t.chat(claude, { since: r.token })
    expect(again.unchanged).toBe(true)
  })

  it('relit une tranche plus ancienne (before) et le bas depuis un octet (from)', async () => {
    const size = Buffer.byteLength(fx('claude-session.jsonl'))
    const older = await t.chat(claude, { before: Math.floor(size / 2) })
    expect(older.older).toBe(true)
    const tail = await t.chat(claude, { from: Math.floor(size / 2) })
    expect(tail.start).toBe(Math.floor(size / 2))
    expect(tail.items!.length).toBeLessThan((await t.chat(claude, {})).items!.length)
  })

  it('donne l’aperçu de la dernière réponse', async () => {
    expect(await t.preview(claude)).toBe('fini encore') // markdown et sauts de ligne aplatis
  })

  it('relit une image par sa position', async () => {
    const r = await t.chat(claude, {})
    const it2 = r.items!.find(i => i.images)!
    const img = await t.image(claude, r.file!, it2.ref!, 0)
    // Photo réduite en JPEG par le navigateur avant l'envoi.
    expect(img!.type).toBe('image/jpeg')
    expect([...img!.body.subarray(0, 2)]).toEqual([0xFF, 0xD8])
    expect(await t.image(claude, 'autre.jsonl', it2.ref!, 0)).toBeNull()
  })

  it('retrouve une rollout Codex par son identifiant', async () => {
    const codex = { id: 'w2:p1', agent: 'codex', cwd: '/x', agentSession: '00000000-0000-4000-8000-00000000c0de' }
    const r = await t.chat(codex, {})
    expect(r.available).toBe(true)
    expect(r.items![0]!.text).toBe('Réponds juste : pong')
    const it2 = r.items!.find(i => i.images)!
    const img = await t.image(codex, r.file!, it2.ref!, 0)
    expect(img!.type).toBe('image/png')
  })

  it('refuse un agent non géré', async () => {
    expect(await t.chat({ id: 'w3:p1', agent: null, cwd: null }, {})).toEqual({ available: false, reason: 'unsupported' })
  })
})

describe('Codex à démon partagé (hook de session rapporté au mauvais pane)', () => {
  // Trois Codex dans le même dossier ; le démon app-server, lancé par le premier,
  // rapporte la session du troisième au premier pane.
  const home = mkdtempSync(path.join(tmpdir(), 'hw-codex-'))
  const now = new Date()
  const dir = path.join(home, '.codex/sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  const T = now.getTime() - 3 * 3600000
  const born = { a: T, b: T + 3600000, c: T + 3600000 + 200000 }
  const roll = (id: string, ts: number) => writeFileSync(path.join(dir, `rollout-x-${id}.jsonl`), JSON.stringify({
    type: 'session_meta', payload: { id, timestamp: new Date(ts).toISOString(), cwd: '/repo', thread_source: 'user' },
  }) + '\n')
  roll('ra', born.a + 4000)
  roll('rb', born.b + 1000)
  roll('rc', born.c + 1000)
  roll('guardian', born.c + 1200) // pas une conversation principale : jamais choisie
  writeFileSync(path.join(dir, 'rollout-x-guardian.jsonl'), JSON.stringify({
    type: 'session_meta', payload: { id: 'guardian', parent_thread_id: 'rc', timestamp: new Date(born.c + 1200).toISOString(), cwd: '/repo', thread_source: 'guardian_review' },
  }) + '\n')
  const t = createTranscripts({ home, herdr: async () => { throw new Error('pas de Herdr') } })
  const a = { id: 'wA:p1', agent: 'codex', cwd: '/repo', agentSession: 'rc', bornAt: born.a }
  const b = { id: 'wB:p1', agent: 'codex', cwd: '/repo', agentSession: null, bornAt: born.b }
  const c = { id: 'wC:p1', agent: 'codex', cwd: '/repo', agentSession: null, bornAt: born.c }
  t.observe([a, b, c])

  it('rattache chaque Codex à la conversation née avec lui', async () => {
    expect((await t.locate(a))?.session).toBe('ra')
    expect((await t.locate(b))?.session).toBe('rb')
    expect((await t.locate(c))?.session).toBe('rc')
  })

  it('suit une session rapportée qui n’appartient à aucun autre pane (/new, reprise)', async () => {
    roll('rnew', born.c + 600000)
    t.forget(a.id)
    expect((await t.locate({ ...a, agentSession: 'rnew' }))?.session).toBe('rnew')
  })
})
