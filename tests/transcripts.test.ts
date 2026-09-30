// Transcriptions : Claude (lignes réelles d'une session de test + quelques lignes
// synthétiques) et Codex (rollout de test réduit + appels d'outils synthétiques).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranscripts, extractImage, parseLines, stripBlobs } from '../server/utils/transcripts'

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
    expect(texts.some(t => t.startsWith('cmd:/context'))).toBe(true)
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

describe('extractImage', () => {
  const b64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')
  it('ne sert jamais une image SVG (ou un type inconnu) comme telle', () => {
    const codex = { payload: { content: [{ type: 'input_image', image_url: `data:image/svg+xml;base64,${b64}` }] } }
    expect(extractImage(codex, 0)!.type).toBe('application/octet-stream')
    const claude = { message: { content: [{ type: 'image', source: { media_type: 'text/html', data: b64 } }] } }
    expect(extractImage(claude, 0)!.type).toBe('application/octet-stream')
  })
  it('garde les types d’images courants', () => {
    const d = { message: { content: [{ type: 'image', source: { media_type: 'image/PNG', data: b64 } }] } }
    expect(extractImage(d, 0)!.type).toBe('image/png')
    expect(extractImage(d, 1)).toBeNull()
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

describe('omp', () => {
  const j = (o: object) => JSON.stringify(o)
  const msg = (message: object, ts: string, extra = {}) => j({ type: 'message', id: ts, timestamp: ts, message, ...extra })
  const hash = 'ab'.repeat(32)
  const lines = [
    j({ type: 'session', version: 3, id: 's1', timestamp: '2026-01-01T00:00:00Z', cwd: '/home/user/x' }),
    j({ type: 'model_change', timestamp: '2026-01-01T00:00:00Z', model: 'anthropic/claude-opus-5-5' }),
    msg({ role: 'user', content: [{ type: 'text', text: 'rappel injecté' }], synthetic: true, attribution: 'agent' }, '2026-01-01T00:00:01Z'),
    msg({ role: 'developer', content: [{ type: 'text', text: '<system-reminder>todo</system-reminder>' }] }, '2026-01-01T00:00:01Z'),
    msg({ role: 'user', content: [{ type: 'text', text: 'Regarde ça [Image #1, 756x477]' }, { type: 'image', data: `blob:sha256:${hash}`, mimeType: 'image/webp' }], attribution: 'user' }, '2026-01-01T00:00:02Z'),
    msg({ role: 'assistant', content: [
      { type: 'thinking', thinking: 'réflexion privée' },
      { type: 'text', text: 'Je lis.' },
      { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/home/user/x/a.ts', i: 'Reading a.ts' } },
      { type: 'toolCall', id: 't2', name: 'bash', arguments: { command: 'false\necho' } },
    ] }, '2026-01-01T00:00:03Z'),
    msg({ role: 'toolResult', toolCallId: 't2', toolName: 'bash', content: [{ type: 'text', text: 'exit 1' }], isError: true }, '2026-01-01T00:00:04Z'),
    j({ type: 'custom_message', customType: 'skill-prompt', attribution: 'user', timestamp: '2026-01-01T00:00:05Z', content: '# Skill…', details: { name: 'plan', args: 'la suite' } }),
    j({ type: 'custom_message', customType: 'advisor', attribution: 'agent', timestamp: '2026-01-01T00:00:05Z', content: 'note interne' }),
    msg({ role: 'assistant', content: [], stopReason: 'aborted', errorMessage: 'Interrupted by user' }, '2026-01-01T00:00:06Z'),
    j({ type: 'compaction', timestamp: '2026-01-01T00:00:07Z', summary: 'résumé' }),
    msg({ role: 'user', content: 'Continue', attribution: 'user', steering: true }, '2026-01-01T00:00:08Z'),
    msg({ role: 'assistant', content: [{ type: 'text', text: '**Fini**' }] }, '2026-01-01T00:00:09Z'),
  ].join('\n') + '\n'

  it('garde les messages de l’utilisateur, les réponses et les outils ; ignore les injections de l’agent', () => {
    const items = parseLines(lines, 'omp', 0, HOME)
    expect(items.map(i => `${i.role}:${i.name ? i.name + ' ' : ''}${i.text}${i.error ? ' !' : ''}`)).toEqual([
      'user:Regarde ça',
      'assistant:Je lis.',
      'tool:Read Reading a.ts',
      'tool:Bash false !',
      'user:/skill:plan la suite',
      'system:Interrompu',
      'system:Conversation compactée',
      'user:Continue',
      'assistant:**Fini**',
    ])
    expect(items[0]!.images).toBe(1)
    expect(items[0]!.ref).toMatch(/^\d+:\d+$/)
  })

  it('remet « /nom args » à la place du texte d’une commande-fichier', () => {
    const body = '# Aside\n\nRéponds vite, puis reprends la tâche.'
    const long = `Revue complète du code. ${'Vérifie chaque fichier modifié. '.repeat(8)}`
    const said = (text: string) => msg({ role: 'user', content: [{ type: 'text', text }], attribution: 'user' }, '2026-01-01T00:00:10Z')
    const items = parseLines([said(`${body}\n\nquelle heure ?`), said(body), said(`${long}\n\nfichier : a.ts`), said('# Aside mais autre chose')].join('\n'), 'omp', 0, HOME,
      [{ name: 'aside', body }, { name: 'review', body: `${long}\n\nPlus de consignes : $ARGUMENTS` }])
    expect(items.map(i => i.text)).toEqual(['/aside quelle heure ?', '/aside', '/review', '# Aside mais autre chose'])
  })

  it('lit la session rapportée par l’intégration (chemin) et relit ses images dans ~/.omp/agent/blobs', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-omp-'))
    const dir = path.join(home, '.omp/agent/sessions/-x')
    mkdirSync(dir, { recursive: true })
    mkdirSync(path.join(home, '.omp/agent/blobs'), { recursive: true })
    const file = path.join(dir, '2026-01-01T00-00-00-000Z_s1.jsonl')
    writeFileSync(file, lines)
    writeFileSync(path.join(home, '.omp/agent/blobs', hash), Buffer.from('RIFF0000WEBP'))
    const t = createTranscripts({ home, herdr: async () => { throw new Error('pas de Herdr') } })
    const omp = { id: 'wO:p1', agent: 'omp', cwd: '/x', agentSession: file }
    const r = await t.chat(omp, {})
    expect(r.available).toBe(true)
    expect(r.file).toBe(path.basename(file))
    expect(await t.preview(omp)).toBe('Fini')
    const img = await t.image(omp, r.file!, r.items!.find(i => i.images)!.ref!, 0)
    expect(img!.type).toBe('image/webp')
    expect(img!.body.toString()).toBe('RIFF0000WEBP')
    expect((await t.search(omp, 'regarde', Date.now() + 5000)).hits.map(h => h.text)).toEqual(['Regarde ça'])
    expect(await t.chat({ ...omp, id: 'wO:p2', agentSession: path.join(dir, 'absent.jsonl') }, {})).toEqual({ available: false, reason: 'not_found' })
    // Un autre .jsonl lisible, hors des sessions d'omp : jamais servi.
    const other = path.join(home, 'autre.jsonl')
    writeFileSync(other, lines)
    expect(await t.chat({ ...omp, id: 'wO:p3', agentSession: other }, {})).toEqual({ available: false, reason: 'not_found' })
    expect(await t.chat({ ...omp, id: 'wO:p4', agentSession: `${dir}/../../../../autre.jsonl` }, {})).toEqual({ available: false, reason: 'not_found' })
    // Commande-fichier de ~/.omp/agent/commands : la conversation montre « /nom args ».
    mkdirSync(path.join(home, '.omp/agent/commands'), { recursive: true })
    writeFileSync(path.join(home, '.omp/agent/commands/aside.md'), '---\ndescription: Aparté\n---\n# Aside\n\nRéponds vite.\n')
    const withCmd = path.join(dir, '2026-01-02T00-00-00-000Z_s2.jsonl')
    writeFileSync(withCmd, msg({ role: 'user', content: [{ type: 'text', text: '# Aside\n\nRéponds vite.\n\nquelle heure ?' }], attribution: 'user' }, '2026-01-02T00:00:00Z') + '\n')
    const t2 = createTranscripts({ home, herdr: async () => { throw new Error('pas de Herdr') } })
    expect((await t2.chat({ ...omp, id: 'wO:p5', agentSession: withCmd }, {})).items!.map(i => i.text)).toEqual(['/aside quelle heure ?'])
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

describe('/clear', () => {
  const j = (o: object) => JSON.stringify(o)
  const u = (content: string, ts: string) => j({ type: 'user', timestamp: ts, message: { role: 'user', content } })
  it('séparateur « Conversation effacée », sans sortie rattachée', () => {
    const items = parseLines([
      u('<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>', '2026-01-01T00:00:00Z'),
      u('<local-command-stdout>✔ Update installed · Restart to update</local-command-stdout>', '2026-01-01T00:00:01Z'),
      j({ type: 'system', subtype: 'local_command', timestamp: '2026-01-01T00:00:02Z', content: '<command-name>/new</command-name><command-args></command-args>' }),
      j({ type: 'system', subtype: 'local_command', timestamp: '2026-01-01T00:00:03Z', content: '<local-command-stdout>(no content)</local-command-stdout>' }),
      u('<command-name>/compact</command-name><command-args></command-args>', '2026-01-01T00:00:04Z'),
      u('<local-command-stdout>Compacted</local-command-stdout>', '2026-01-01T00:00:05Z'),
    ].join('\n'), 'claude')
    expect(items.map(i => `${i.role}:${i.text}`)).toEqual(['system:Conversation effacée', 'system:Conversation effacée', 'cmd:/compact'])
    expect(items.some(i => i.out)).toBe(false)
  })
})

describe('commandes « / »', () => {
  const j = (o: object) => JSON.stringify(o)
  const u = (content: unknown, ts: string, extra = {}) => j({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra })
  const a = (text: string, ts: string) => j({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } })
  const cmd = (name: string, args = '') => `<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`
  const run = (lines: string[]) => parseLines(lines.join('\n'), 'claude').map(i => `${i.role}:${i.text}${i.out ? `|${i.out}` : ''}`)

  it('skill suivi d’une réponse : message utilisateur normal, sans sortie d’écran', () => {
    expect(run([
      u(cmd('/daily-log', 'hier'), '2026-01-01T00:00:00Z'),
      u('<local-command-stdout>Running 1 shell command…\n* Working… (1s · ↓ 113 tokens · thinking)\nTip: use /help</local-command-stdout>', '2026-01-01T00:00:01Z'),
      u([{ type: 'text', text: 'Base directory for this skill: /x' }], '2026-01-01T00:00:01Z', { isMeta: true }),
      a('Voici le journal.', '2026-01-01T00:00:02Z'),
    ])).toEqual(['user:/daily-log hier', 'assistant:Voici le journal.'])
  })

  it('commande locale : ligne système avec la sortie utile seulement', () => {
    expect(run([
      u(cmd('/cost'), '2026-01-01T00:00:00Z'),
      u('<local-command-stdout>Total cost: $0.12\nTotal duration: 3m</local-command-stdout>', '2026-01-01T00:00:01Z'),
      u(cmd('/status'), '2026-01-01T00:00:02Z'),
      u('<local-command-stdout>* Working… (1s)\nTip: press ?</local-command-stdout>', '2026-01-01T00:00:03Z'),
      a('Rien à voir.', '2026-01-01T00:00:10Z'),
    ])).toEqual(['cmd:/cost → Total cost: $0.12', 'user:/status', 'assistant:Rien à voir.'])
  })

  it('commande « ! » : garde son bloc et sa vraie sortie', () => {
    expect(run([
      u('<bash-input>ls</bash-input>', '2026-01-01T00:00:00Z'),
      u('<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>', '2026-01-01T00:00:01Z'),
    ])).toEqual(['bash:ls|a.txt'])
  })
})
