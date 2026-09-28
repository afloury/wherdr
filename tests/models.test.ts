// Modèle des agents : libellés, lecture dans les transcriptions (Claude, Codex)
// et menus /model réels capturés dans la session de test (Claude Code v2.1.282,
// Codex v0.156.1).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claudeEffortCommand, claudeEffortLevels, claudeModelLabel, codexCachedEfforts, codexConfigModel, codexFooterModel, codexModelLabel, effortMatches, effortValue, lastModel, modelFromLine, parseClaudeEffortSlider, parseClaudeEffortScreen, claudeScreenEffort, parseModelMenu, sameModel, switchConfirmKeys,
} from '../server/utils/models'
import { createTranscripts, parseLines } from '../server/utils/transcripts'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const j = (o: unknown) => JSON.stringify(o)

describe('libellés', () => {
  it('Claude', () => {
    expect(claudeModelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(claudeModelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(claudeModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(claudeModelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(claudeModelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1 (1M)')
    expect(claudeModelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  })
  it('Codex', () => {
    expect(codexModelLabel('gpt-6-sol')).toBe('GPT-6-Sol')
    expect(codexModelLabel('gpt-5.6-terra')).toBe('GPT-5.6-Terra')
    expect(codexModelLabel('gpt-5.5')).toBe('GPT-5.5')
  })
  it('compare sans les variantes entre parenthèses', () => {
    expect(sameModel('Opus 5.5', 'Opus 5.5 (1M)')).toBe(true)
    expect(sameModel('Opus 5.5', 'Opus 5')).toBe(false)
  })
})

describe('modèle dans une transcription Claude', () => {
  const assistant = (model: string, ts: string, extra = {}) => j({ type: 'assistant', timestamp: ts, message: { model, role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, ...extra })
  const stdout = (text: string, ts: string, type = 'user') => (type === 'user'
    ? j({ type: 'user', timestamp: ts, message: { role: 'user', content: `<local-command-stdout>${text}</local-command-stdout>` } })
    : j({ type: 'system', subtype: 'local_command', timestamp: ts, content: `<local-command-stdout>${text}</local-command-stdout>` }))

  it('prend message.model de la dernière réponse', () => {
    const lines = [assistant('claude-sonnet-5', 't1'), assistant('claude-opus-5-5', 't2')]
    expect(lastModel(lines, 'claude')).toEqual({ id: 'claude-opus-5-5', label: 'Opus 5.5', effort: null, at: 't2' })
  })

  it('lit le niveau de raisonnement de la réponse (effort)', () => {
    const line = JSON.stringify({ ...JSON.parse(assistant('claude-opus-5-5', 't1')), effort: 'high' })
    expect(lastModel([line], 'claude')).toMatchObject({ label: 'Opus 5.5', effort: 'high' })
  })

  it('« Set model to … » après la dernière réponse l’emporte (changement via /model)', () => {
    const lines = [assistant('claude-opus-5-5', 't1'), stdout('Set model to `Sonnet 5` for this session only', 't2')]
    expect(lastModel(lines, 'claude')).toEqual({ id: null, label: 'Sonnet 5', at: 't2' })
    // …puis la réponse suivante, faite avec le nouveau modèle.
    expect(lastModel([...lines, assistant('claude-sonnet-5', 't3')], 'claude')!.id).toBe('claude-sonnet-5')
  })

  it('lit aussi les sorties en message système, « Kept model as » et le suffixe (1M context) (default)', () => {
    expect(modelFromLine(stdout('Kept model as `Opus 5.5 (default)`', 't', 'system'), 'claude')!.label).toBe('Opus 5.5')
    expect(modelFromLine(stdout('Set model to `Opus 5 (1M context) (default)` and saved as your default for new sessions\u001b[2m\u001b[22m', 't'), 'claude')!.label).toBe('Opus 5 (1M)')
  })

  it('ignore les réponses synthétiques, les sous-agents et le texte cité', () => {
    expect(modelFromLine(assistant('<synthetic>', 't'), 'claude')).toBeNull()
    expect(modelFromLine(assistant('claude-haiku-4-5-20251001', 't', { isSidechain: true }), 'claude')).toBeNull()
    expect(modelFromLine(j({ type: 'user', message: { role: 'user', content: 'écris « Set model to `X` »' } }), 'claude')).toBeNull()
  })

  it('la transcription réelle de test', () => {
    // Session de test : réponses faites par Opus.
    expect(lastModel(fx('claude-session.jsonl').split('\n'), 'claude')!.label).toMatch(/^(Opus|Sonnet|Haiku|Fable) /)
  })
})

describe('modèle dans une rollout Codex', () => {
  const tc = (model: string, effort: string, ts: string) => j({ timestamp: ts, type: 'turn_context', payload: { model, effort, collaboration_mode: { settings: { model, reasoning_effort: effort } } } })
  it('prend le dernier turn_context, avec l’effort', () => {
    const lines = [tc('gpt-6-sol', 'medium', 't1'), j({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }), tc('gpt-6-luna', 'high', 't2')]
    expect(lastModel(lines, 'codex')).toEqual({ id: 'gpt-6-luna', label: 'GPT-6-Luna', effort: 'high', at: 't2' })
  })
  it('lit la ligne d’état de Codex au repos (modèle réellement en service)', () => {
    expect(codexFooterModel(fx('codex-idle.txt'))).toEqual({ id: null, label: 'GPT-6-Sol', effort: 'medium', at: null })
    expect(codexFooterModel('› Ask Codex to do anything\n\n  GPT-5.6-Terra medium · ~ · Répondre pong')!.label).toBe('GPT-5.6-Terra')
    expect(codexFooterModel(fx('codex-model-1.txt'))).toBeNull()
  })
  it('lit le modèle par défaut de config.toml (clés de premier niveau seulement)', () => {
    const toml = 'model = "gpt-6-sol"\nmodel_reasoning_effort = "medium"\n[profiles.x]\nmodel = "gpt-5.5"\n'
    expect(codexConfigModel(toml)).toEqual({ id: 'gpt-6-sol', label: 'GPT-6-Sol', effort: 'medium', at: null })
    expect(codexConfigModel('[tui]\nmodel = "x"')).toBeNull()
  })
})

describe('conversation : commandes locales des sélecteurs', () => {
  it('masque /model et « Kept model as », affiche un vrai changement', () => {
    const cmd = j({ type: 'system', subtype: 'local_command', timestamp: 't', content: '<command-name>/model</command-name>\n<command-args></command-args>' })
    const kept = j({ type: 'system', subtype: 'local_command', timestamp: 't', content: '<local-command-stdout>Kept model as `Opus 5.5`</local-command-stdout>' })
    const userCmd = j({ type: 'user', timestamp: 't', message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args></command-args>' } })
    const set = j({ type: 'user', timestamp: 't', message: { role: 'user', content: '<local-command-stdout>Set model to `Sonnet 4.6` for this session only</local-command-stdout>' } })
    const items = parseLines([cmd, kept, userCmd, set].join('\n'), 'claude')
    expect(items.map(i => `${i.role}:${i.text}`)).toEqual(['system:/model → Sonnet 4.6'])
  })

  it('masque le curseur /effort annulé et affiche une seule confirmation système', () => {
    const command = (type: 'user' | 'system') => type === 'user'
      ? j({ type, timestamp: 't', message: { role: 'user', content: '<command-name>/effort</command-name>\n<command-args></command-args>' } })
      : j({ type, subtype: 'local_command', timestamp: 't', content: '<command-name>/effort</command-name>\n<command-args></command-args>' })
    const output = (value: string) => j({ type: 'user', timestamp: 't', message: { role: 'user', content: `<local-command-stdout>${value}</local-command-stdout>` } })
    const human = j({ type: 'user', timestamp: 't', message: { role: 'user', content: 'Aide-moi' } })
    const items = parseLines([
      command('system'), output('Cancelled'), command('user'),
      output('Set effort level to low (this session only): Quick, straightforward implementation'), human,
    ].join('\n'), 'claude')
    expect(items.map(i => `${i.role}:${i.text}`)).toEqual([
      'system:Effort : low (cette session)', 'user:Aide-moi',
    ])
    expect(parseLines(output('Set effort level to high (for this session only)'), 'claude').map(i => i.text))
      .toEqual(['Effort : high (cette session)'])
    expect(parseLines(output('Set effort level to max and saved as your default'), 'claude').map(i => i.text))
      .toEqual(['Set effort level to max and saved as your default'])
  })
})

describe('transcripts.model()', () => {
  it('suit la transcription au fil des ajouts (lecture incrémentale)', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-model-'))
    const dir = path.join(home, '.claude/projects/-x')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'sess.jsonl')
    const a = (m: string) => j({ type: 'assistant', timestamp: '2026-09-26T00:00:00Z', message: { model: m, content: [] } }) + '\n'
    writeFileSync(file, a('claude-opus-5-5') + j({ type: 'user', message: { content: 'x'.repeat(700000) } }) + '\n')
    const tr = createTranscripts({ home, herdr: async () => ({}) })
    const pane = { id: 'w1:p1', agent: 'claude', cwd: null, agentSession: 'sess' }
    expect((await tr.model(pane))!.label).toBe('Opus 5.5')
    writeFileSync(file, readFileSync(file, 'utf8') + a('claude-sonnet-5'))
    expect((await tr.model(pane))!.label).toBe('Sonnet 5')
    writeFileSync(file, readFileSync(file, 'utf8') + j({ type: 'user', message: { content: 'rien' } }) + '\n')
    expect((await tr.model(pane))!.label).toBe('Sonnet 5')
  })
})

describe('menu /model', () => {
  it('propose les efforts Claude selon le modèle et construit une commande valide', () => {
    expect(claudeEffortLevels('Opus 5.5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
    expect(claudeEffortLevels('Sonnet 4.6')).toEqual(['low', 'medium', 'high', 'max'])
    expect(claudeEffortLevels('Opus 5.5 (1M)')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
    expect(claudeEffortLevels('Haiku 4.5')).toEqual([])
    expect(claudeEffortLevels('autre')).toEqual([])
    expect(claudeEffortCommand('max', 'Opus 5.5')).toBe('/effort')
    expect(claudeEffortCommand('max', 'Haiku 4.5')).toBeNull()
    expect(claudeEffortCommand('high\n/clear', 'Opus 5.5')).toBeNull()
    expect(parseClaudeEffortSlider('● High effort\ns to use this session only')).toBe('high')
  })
  it('lit le curseur /effort de Claude 2.1.283 (▲ au-dessus du libellé courant)', () => {
    const all = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']
    for (const level of ['low', 'medium', 'max', 'ultracode']) {
      expect(parseClaudeEffortScreen(fx(`claude-effort-${level}.txt`))).toEqual({ current: level, levels: all })
    }
    expect(claudeEffortCommand('ultracode', 'Opus 5.5')).toBe('/effort')
    expect(claudeEffortCommand('ultracode', 'Haiku 4.5')).toBeNull()
  })
  it('ignore un curseur refermé et reste compatible avec l’ancien écran', () => {
    const text = fx('claude-effort-medium.txt')
    expect(parseClaudeEffortScreen(text.replace(/.*Esc to cancel.*\n?/, ''))).toBeNull()
    expect(parseClaudeEffortScreen(fx('claude-idle.txt'))).toBeNull()
    expect(parseClaudeEffortScreen('◐ Medium effort (default) ←/→ to adjust\nEnter to confirm · s to use this session only · Esc to cancel'))
      .toEqual({ current: 'medium', levels: [] })
    // Écran étroit : libellés resserrés, ▲ entre deux mots → le plus proche.
    const narrow = ' Effort\n  ───────────▲─┊──\n  low medium high xhigh max ultracode\n ←/→ · s for this session only · Esc'
    expect(parseClaudeEffortSlider(narrow)).toBe('high')
  })
  it('lit l’effort courant de Claude sur la bannière ou le retour de /effort', () => {
    expect(claudeScreenEffort(fx('claude-effort-low.txt'))).toBe('medium')
    expect(claudeScreenEffort(' Opus 5.5 with low effort · Claude Pro')).toBe('low')
    expect(claudeScreenEffort('Opus 5.5 with medium effort\n⎿  Set effort level to low (for this session only)')).toBe('low')
    expect(claudeScreenEffort('rien')).toBeNull()
  })
  it('lit les niveaux proposés par le menu Codex', () => {
    const menu = parseModelMenu(fx('codex-model-2.txt'))
    expect(menu?.options.map(o => effortValue(o.label)).filter(Boolean)).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(effortValue('More reasoning…')).toBeNull()
  })
  it('lit les niveaux disponibles du catalogue Codex pour le modèle actif', () => {
    const json = JSON.stringify({ models: [{ slug: 'gpt-6-sol', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }, { effort: 'ultra' }] }] })
    expect(codexCachedEfforts(json, 'GPT-6-Sol')).toEqual(['low', 'max', 'ultra'])
  })
  it('Claude : 10 options visibles, défilement, coche, descriptions, effort, validation « s »', () => {
    const m = parseModelMenu(fx('claude-model-1.txt'))!
    expect(m.kind).toBe('model')
    expect(m.cursor).toBe(1)
    expect(m.options.map(o => o.label)).toEqual(['Default (recommended)', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5', 'Haiku 4.5', 'Opus 5', 'Fable 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6'])
    expect(m.options[0]).toMatchObject({ current: true, hint: 'Sonnet 5 · Efficient for routine tasks' })
    expect(m.options[1]).toMatchObject({ current: false, hint: 'Most capable for ambitious work' })
    expect(m.scrollDown).toBe(true) // « ↓ 10. » et « … +1 model »
    expect(m.sessionKey).toBe(true)
    expect(m.enterSelects).toBe(false) // Entrée = enregistrer comme défaut : jamais
    expect(m.effort).toBe('high')
    expect(effortValue(m.effort || '')).toBe('high')
  })

  it('Claude : page suivante (↑ 2. … ❯ 11.)', () => {
    const m = parseModelMenu(fx('claude-model-2.txt'))!
    expect(m.cursor).toBe(11)
    expect(m.options[0]!.n).toBe(2)
    expect(m.options[m.options.length - 1]).toMatchObject({ n: 11, label: 'Sonnet 4.6' })
  })

  it('Codex : modèle (défaut, courant), puis effort', () => {
    const m = parseModelMenu(fx('codex-model-1.txt'))!
    expect(m.kind).toBe('model')
    expect(m.options.map(o => o.label)).toEqual(['GPT-6-Astra', 'GPT-6-Sol', 'GPT-6-Luna', 'GPT-5.6-Sol', 'GPT-5.6-Terra', 'GPT-5.6-Luna', 'GPT-5.5'])
    expect(m.options[0]!.isDefault).toBe(true)
    expect(m.options[1]!.current).toBe(true)
    expect(m.cursor).toBe(2)
    expect(m.scrollDown).toBe(false)
    expect(m.enterSelects).toBe(true)
    expect(m.sessionKey).toBe(false)

    const e = parseModelMenu(fx('codex-model-2.txt'))!
    expect(e.kind).toBe('effort')
    expect(e.options.map(o => o.label)).toEqual(['Low', 'Medium', 'High', 'Extra high', 'More reasoning…'])
    expect(e.cursor).toBe(2)
    expect(e.sessionKey).toBe(true)
    expect(e.enterSelects).toBe(false)
    expect(effortMatches('Extra high', 'xhigh')).toBe(true)
    expect(effortMatches('Medium (default)', 'medium')).toBe(true)
  })

  it('Claude : confirmation « Switch model? » en cours de conversation (seulement pour ce modèle)', () => {
    const text = fx('claude-model-confirm.txt')
    expect(parseModelMenu(text)).toBeNull()
    expect(switchConfirmKeys(text, 'Sonnet 4.6')).toEqual(['enter'])
    expect(switchConfirmKeys(text, 'Opus 5.5')).toBeNull()
    expect(switchConfirmKeys(fx('claude-ask.txt'), 'Sonnet 4.6')).toBeNull()
  })

  it('pas de menu : écran au repos, ou menu refermé', () => {
    expect(parseModelMenu(fx('claude-idle.txt'))).toBeNull()
    expect(parseModelMenu(fx('codex-idle.txt'))).toBeNull()
    expect(parseModelMenu(fx('codex-model-1.txt').replace('enter select · esc back', ''))).toBeNull()
  })
})
