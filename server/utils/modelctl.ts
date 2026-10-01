// Agent models, control side: current model (transcript, choice made
// from the phone, default), list of models read from the /model menu, and
// model change by driving that menu.
//
// ⚠ We always confirm with "s" (this session only), never with
// Enter nor `/model <name>`: those save the model as the user's global
// default (~/.claude/settings.json, ~/.codex/config.toml).
// In Codex, Enter on the first menu only moves on to the effort
// choice ("enter select"), which we then confirm with "s".
import path from 'node:path'
import type { EffortList, ModelInfo, ModelList, ModelOption, Pane } from '../../shared/types'
import { log } from './env'
import { HerdrError, agentPrompt, herdr, sleep } from './herdr'
import { closePanel } from './actions'
import { READY, findPane, poll, transcripts } from './state'
import { machineOfPane } from './machines'
import { type ClaudeEffortSlider, type ModelMenu, claudeEffortCommand, claudeEffortLevels, cleanModelName, codexCachedEfforts, codexConfigModel, claudeScreenEffort, claudeScreenModel, codexFooterModel, effortMatches, effortValue, parseClaudeEffortScreen, parseModelMenu, sameModel, switchConfirmKeys } from './models'

// ---------------------------------------------------------------- current model
// Choice made from the phone: shown right away, until the
// transcript says something newer (Codex only writes the model on the next turn).
const overrides = new Map<string, ModelInfo & { ms: number }>()
const observedEfforts = new Map<string, { label: string, effort: string }>()

async function fallbackModel(p: Pane): Promise<ModelInfo | null> {
  const m = machineOfPane(p.id)
  if (p.agent === 'codex') {
    // Codex config on the agent's machine.
    if (!m || !m.home) return null
    try { return codexConfigModel(await m.fs.readFile(path.posix.join(m.home, '.codex/config.toml'))) }
    catch { return null }
  }
  // Claude without a reply yet: the default model, as the menu announces it
  // ("Default (recommended)  Sonnet 5 · …"), if it has already been read.
  const def = listCache.get(listKey(p.id, 'claude'))?.options[0]
  if (def && /^default\b/i.test(def.label) && def.hint) {
    const label = cleanModelName(def.hint.split('·')[0]!)
    if (label) return { id: null, label, at: null }
  }
  return null
}

// Codex: model read from its status line (screen re-read by state.ts when not working).
const footers = new Map<string, { info: ModelInfo, ms: number }>()
// Claude: effort announced on screen (banner, /effort output), more reliable
// than the transcript, which keeps the default effort.
const screenEfforts = new Map<string, { effort: string, ms: number }>()
// Claude: model from the header (or from a typed /model), fallback while there is no transcript.
const screenModels = new Map<string, ModelInfo>()
export function noteScreen(paneId: string, agent: string | null, text: string | null | undefined) {
  if (agent === 'claude') {
    const model = claudeScreenModel(text)
    if (model) screenModels.set(paneId, model)
    const effort = claudeScreenEffort(text)
    if (effort && screenEfforts.get(paneId)?.effort !== effort) screenEfforts.set(paneId, { effort, ms: Date.now() })
    return
  }
  if (agent !== 'codex') return
  const info = codexFooterModel(text)
  if (info) footers.set(paneId, { info, ms: Date.now() })
}

export function forgetModel(paneId: string) {
  footers.delete(paneId)
  overrides.delete(paneId)
  observedEfforts.delete(paneId)
  screenEfforts.delete(paneId)
  screenModels.delete(paneId)
}

export async function currentModel(p: Pane): Promise<ModelInfo | null> {
  if (!p.agent || !['claude', 'codex'].includes(p.agent)) return null
  let fromFile = await transcripts.model(p).catch(() => null)
  const f = footers.get(p.id)
  if (f && (!fromFile || !sameModel(fromFile.label, f.info.label) || fromFile.effort !== f.info.effort)) {
    // The status line wins over a lagging rollout (change not yet followed by a turn).
    const fileAt = fromFile && fromFile.at ? Date.parse(fromFile.at) : 0
    if (fileAt < f.ms) fromFile = { ...f.info, id: fromFile && sameModel(fromFile.label, f.info.label) ? fromFile.id : null, at: new Date(f.ms).toISOString() }
  }
  const o = overrides.get(p.id)
  if (o) {
    const fileAt = fromFile && fromFile.at ? Date.parse(fromFile.at) : 0
    if (!fromFile || fileAt < o.ms) {
      const { ms: _ms, ...info } = o
      // Same model as the transcript: we keep its raw identifier.
      return fromFile && sameModel(fromFile.label, info.label) ? { ...info, id: fromFile.id } : info
    }
    overrides.delete(p.id)
  }
  const seen = p.agent === 'claude' ? screenEfforts.get(p.id) : null
  if (fromFile && seen) return { ...fromFile, effort: seen.effort }
  const observed = observedEfforts.get(p.id)
  if (fromFile && !fromFile.effort && observed && sameModel(fromFile.label, observed.label)) {
    return { ...fromFile, effort: observed.effort }
  }
  if (!fromFile && p.agent === 'claude') {
    // New agent: Claude Code's header already gives model and effort.
    const sm = screenModels.get(p.id)
    if (sm) return { ...sm, effort: seen ? seen.effort : sm.effort }
  }
  return fromFile || fallbackModel(p)
}

// ---------------------------------------------------------------- menu /model
const LIST_TTL_MS = 12 * 3600 * 1000
// Per machine and agent kind (Claude / Codex versions may differ).
const listCache = new Map<string, ModelList>()
const listKey = (paneId: string, agent: string) => `${machineOfPane(paneId)?.key || ''}|${agent}`
const busy = new Set<string>()

async function withPane<T>(paneId: string, fn: (p: Pane) => Promise<T>): Promise<T> {
  const p = findPane(paneId)
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (!p.agent || !['claude', 'codex'].includes(p.agent)) throw new HerdrError('unsupported', 'Not a Claude or Codex agent')
  if (!READY.has(p.status || '')) {
    throw new HerdrError('busy', p.status === 'blocked' ? 'The agent is waiting for an answer — reply first.' : 'The agent is working — change the model once it’s done.')
  }
  if (busy.has(paneId)) throw new HerdrError('busy', 'Model change already in progress')
  busy.add(paneId)
  try { return await fn(p) }
  finally { busy.delete(paneId) }
}

const screen = async (paneId: string) => {
  const r = await herdr('pane.read', { pane_id: paneId, source: 'detection' }, 4000)
  return String((r.read && r.read.text) || '')
}

async function waitMenu(paneId: string, ok: (m: ModelMenu) => boolean, timeoutMs = 6000): Promise<ModelMenu | null> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const m = parseModelMenu(await screen(paneId))
    if (m && ok(m)) return m
    if (Date.now() > until) return null
    await sleep(250)
  }
}

// Closes the menu (Escape) while it is on screen. Never Escape without a menu:
// in Codex, Escape Escape when idle opens editing of the previous message.
async function closeMenu(paneId: string) {
  for (let i = 0; i < 3; i++) {
    if (!parseModelMenu(await screen(paneId))) return
    await herdr('pane.send_input', { pane_id: paneId, keys: ['esc'] })
    await sleep(400)
  }
}

async function openMenu(p: Pane): Promise<ModelMenu> {
  await closeMenu(p.id)
  await closePanel(p.id).catch(() => false)
  await agentPrompt(p.id, '/model')
  const m = await waitMenu(p.id, x => x.kind === 'model')
  if (!m) {
    await closeMenu(p.id)
    throw new HerdrError('no_menu', 'The /model menu did not show up')
  }
  return m
}

const moveKeys = (from: number, to: number) => Array.from({ length: Math.abs(to - from) }, () => (to > from ? 'down' : 'up'))

// All options: Claude only shows 10 (↑/↓ before the number), we
// go back to the top then down page by page (the list wraps to the top
// after the last one).
async function readAllOptions(paneId: string, first: ModelMenu) {
  const all = new Map(first.options.map(o => [o.n, o]))
  let m = first
  // Page opened further down (current model at the end of the list): go back up to no. 1 first.
  if (m.options[0]!.n > 1) {
    await herdr('pane.send_input', { pane_id: paneId, keys: moveKeys(m.cursor, 1) })
    const top = await waitMenu(paneId, x => x.kind === 'model' && x.cursor === 1, 3000)
    if (!top) throw new HerdrError('stale', 'The /model menu changed — try again.')
    for (const o of top.options) if (!all.has(o.n)) all.set(o.n, o)
    m = top
  }
  for (let i = 0; i < 8 && m.scrollDown; i++) {
    const last = m.options[m.options.length - 1]!.n
    await herdr('pane.send_input', { pane_id: paneId, keys: moveKeys(m.cursor, last + 1) })
    await sleep(350)
    const next = await waitMenu(paneId, x => x.kind === 'model', 2000)
    if (!next || next.cursor <= last) break // wrapped: end of list
    const before = all.size
    for (const o of next.options) if (!all.has(o.n)) all.set(o.n, o)
    if (all.size === before) break
    m = next
  }
  return [...all.values()].sort((a, b) => a.n - b.n)
}

// "current" is not kept: the list is shared by all agents of the same kind.
const toOption = ({ label, hint, isDefault }: ModelOption): ModelOption => ({ label, hint, isDefault: Boolean(isDefault) })

export async function listModels(paneId: string, refresh = false): Promise<ModelList> {
  const p0 = findPane(paneId)
  if (!p0 || !p0.agent) throw new HerdrError('bad_pane', 'Pane not found')
  const hit = listCache.get(listKey(p0.id, p0.agent))
  if (hit && !refresh && Date.now() - hit.at < LIST_TTL_MS) return hit
  return withPane(paneId, async (p) => {
    const m = await openMenu(p)
    let options: ModelOption[]
    try { options = (await readAllOptions(p.id, m)).map(toOption) }
    finally { await closeMenu(p.id) }
    const list: ModelList = { agent: p.agent!, options, at: Date.now() }
    listCache.set(listKey(p.id, p.agent!), list)
    log(`models ${p.agent}: ${options.map(o => o.label).join(', ')}`)
    return list
  })
}

// Moves the cursor to option `n` and checks that it is really there.
async function pick(paneId: string, m: ModelMenu, n: number, label: string, kind: ModelMenu['kind']) {
  const keys = moveKeys(m.cursor, n)
  if (keys.length) await herdr('pane.send_input', { pane_id: paneId, keys })
  const at = await waitMenu(paneId, x => x.kind === kind && x.cursor === n, 3000)
  const o = at && at.options.find(x => x.n === n)
  if (!at || !o || o.label !== label) throw new HerdrError('stale', 'The /model menu changed — try again.')
  return at
}

export async function setModel(paneId: string, wanted: string): Promise<ModelInfo> {
  const label = cleanModelName(wanted)
  if (!label) throw new HerdrError('bad_model', 'modèle manquant')
  return withPane(paneId, async (p) => {
    const before = await currentModel(p)
    const started = Date.now()
    let m = await openMenu(p)
    try {
      // Option number: in the list read (the menu only shows one page).
      let n = m.options.find(o => o.label === label)?.n
      if (!n) {
        n = (await readAllOptions(p.id, m)).find(o => o.label === label)?.n
        m = (await waitMenu(p.id, x => x.kind === 'model', 2000)) || m // cursor moved
      }
      if (!n) throw new HerdrError('bad_model', `Modèle introuvable dans /model : ${label}`)
      m = await pick(p.id, m, n, label, 'model')
      // "Default (recommended)": Claude will confirm with the default model's name.
      const picked = m.options.find(o => o.n === n)
      const confirmAs = /^default\b/i.test(label) && picked && picked.hint ? cleanModelName(picked.hint.split('·')[0]!) : label

      let effort: string | null = null
      if (p.agent === 'claude') {
        if (!m.sessionKey) throw new HerdrError('unsafe', '“This session only” option not found — nothing was changed.')
        effort = m.effort
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
      } else {
        // Codex : Entrée ne fait que passer au choix de l'effort (« enter select »).
        if (!m.enterSelects) throw new HerdrError('unsafe', 'Unexpected /model menu — nothing was changed.')
        await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
        const e = await waitMenu(p.id, x => x.kind === 'effort', 4000)
        if (!e || !e.sessionKey) throw new HerdrError('unsafe', 'Unexpected effort menu — nothing was changed.')
        // On garde l'effort courant s'il existe pour ce modèle, sinon celui proposé.
        const keep = e.options.find(o => effortMatches(o.label, before && before.effort))
        const at = keep && keep.n !== e.cursor ? await pick(p.id, e, keep.n, keep.label, 'effort') : e
        effort = (at.options.find(o => o.n === at.cursor)?.label || '').toLowerCase().replace(/\s+/g, '') || null
        if (effort === 'extrahigh') effort = 'xhigh'
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
      }
      // Menu closed = choice taken. Claude may first ask for confirmation
      // (conversation cached for the old model): we confirm this model.
      // Done when neither menu nor confirmation is seen twice in a row.
      const until = Date.now() + 5000
      let clear = 0
      while (clear < 2 && Date.now() < until) {
        const text = await screen(p.id)
        const confirm = p.agent === 'claude' ? switchConfirmKeys(text, confirmAs) : null
        if (confirm) await herdr('pane.send_input', { pane_id: p.id, keys: confirm })
        clear = confirm || parseModelMenu(text) ? 0 : clear + 1
        await sleep(confirm ? 400 : 250)
      }
      if (clear < 2) throw new HerdrError('stale', 'The /model menu changed — try again.')
      const info: ModelInfo = { id: null, label: confirmAs, effort, at: new Date(started).toISOString() }
      overrides.set(p.id, { ...info, ms: started })
      if (effort) observedEfforts.set(p.id, { label: confirmAs, effort })
      log(`model ${p.id} (${p.agent}) -> ${confirmAs}${effort ? ' ' + effort : ''} (this session)`)
      setTimeout(poll, 100)
      return (await currentModel(p)) || info
    } catch (e) {
      await closeMenu(p.id).catch(() => {})
      throw e
    }
  })
}

async function codexEffortMenu(p: Pane, model: ModelInfo): Promise<ModelMenu> {
  const m = await openMenu(p)
  if (!m.enterSelects) throw new HerdrError('unsafe', 'Unexpected /model menu — nothing was changed.')
  const current = m.options.find(o => o.current || sameModel(o.label, model.label))
  if (!current) throw new HerdrError('stale', 'The /model menu changed — try again.')
  await pick(p.id, m, current.n, current.label, 'model')
  await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
  const e = await waitMenu(p.id, x => x.kind === 'effort', 4000)
  if (!e || !e.sessionKey) throw new HerdrError('unsafe', 'Unexpected effort menu — nothing was changed.')
  return e
}

// ---------------------------------------------------------------- curseur /effort (Claude)
async function waitSlider(paneId: string, ok: (s: ClaudeEffortSlider) => boolean, timeoutMs: number): Promise<ClaudeEffortSlider | null> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const s = parseClaudeEffortScreen(await screen(paneId).catch(() => ''))
    if (s && ok(s)) return s
    if (Date.now() > until) return null
    await sleep(250)
  }
}

async function sliderGone(paneId: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  let clear = 0
  while (clear < 2 && Date.now() < until) {
    clear = parseClaudeEffortScreen(await screen(paneId).catch(() => '')) ? 0 : clear + 1
    if (clear < 2) await sleep(250)
  }
  return clear >= 2
}

// Escape while the slider is on screen: it must never stay open.
async function closeEffortSlider(paneId: string) {
  for (let i = 0; i < 3; i++) {
    if (!parseClaudeEffortScreen(await screen(paneId).catch(() => ''))) return
    await herdr('pane.send_input', { pane_id: paneId, keys: ['esc'] }).catch(() => {})
    await sleep(400)
  }
}

async function openEffortSlider(p: Pane): Promise<ClaudeEffortSlider> {
  await closeEffortSlider(p.id)
  await closePanel(p.id).catch(() => false)
  await agentPrompt(p.id, '/effort')
  const s = await waitSlider(p.id, () => true, 4000)
  if (!s) {
    // Unknown screen: close anyway (single Escape, the slider may no longer be readable).
    await herdr('pane.send_input', { pane_id: p.id, keys: ['esc'] }).catch(() => {})
    throw new HerdrError('no_menu', 'Curseur d’effort de Claude illisible — refermé, rien n’a été changé.')
  }
  return s
}

export async function listEfforts(paneId: string): Promise<EffortList> {
  return withPane(paneId, async p => {
    const model = await currentModel(p)
    if (!model) return { levels: [], current: null }
    if (p.agent === 'claude') {
      const fallback = claudeEffortLevels(model.label)
      // Reading the list must not send /effort: Claude records even a
      // cancelled opening in the transcript. The choice checks the levels
      // actually offered by the slider before changing anything.
      return { levels: fallback, current: model.effort || null }
    }
    const machine = machineOfPane(p.id)
    if (machine?.home) {
      try {
        const levels = codexCachedEfforts(await machine.fs.readFile(path.posix.join(machine.home, '.codex/models_cache.json')), model.id || model.label)
        if (levels.length) return { levels, current: model.effort || null }
      } catch { /* menu live en repli */ }
    }
    try {
      const menu = await codexEffortMenu(p, model)
      const levels = menu.options.map(o => effortValue(o.label)).filter((e): e is string => Boolean(e))
      return { levels, current: model.effort || null }
    } finally { await closeMenu(p.id).catch(() => {}) }
  })
}

export async function setEffort(paneId: string, level: string): Promise<ModelInfo> {
  return withPane(paneId, async p => {
    const before = await currentModel(p)
    if (!before) throw new HerdrError('bad_model', 'modèle inconnu')
    const started = Date.now()
    if (p.agent === 'claude') {
      if (!claudeEffortCommand(level, before.label)) throw new HerdrError('bad_effort', 'Effort level unavailable for this model')
      const slider = await openEffortSlider(p)
      try {
        const levels = slider.levels.length ? slider.levels : claudeEffortLevels(before.label)
        if (!levels.includes(slider.current)) throw new HerdrError('unsafe', 'Curseur d’effort inattendu — rien n’a été changé.')
        if (!levels.includes(level)) throw new HerdrError('bad_effort', 'Effort level unavailable for this model')
        const delta = levels.indexOf(level) - levels.indexOf(slider.current)
        if (delta) await herdr('pane.send_input', { pane_id: p.id, keys: Array.from({ length: Math.abs(delta) }, () => delta > 0 ? 'right' : 'left') })
        const at = await waitSlider(p.id, x => x.current === level, 3000)
        if (!at) throw new HerdrError('stale', 'Le curseur d’effort n’a pas suivi — rien n’a été changé.')
        // "s" = this session only. Never Enter: it saves the default.
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
        if (!await sliderGone(p.id)) throw new HerdrError('stale', 'Le curseur d’effort est resté ouvert — rien n’a été changé.')
      } catch (e) {
        await closeEffortSlider(p.id)
        throw e
      }
      screenEfforts.set(p.id, { effort: level, ms: Date.now() })
    } else {
      try {
        let menu = await codexEffortMenu(p, before)
        let option = menu.options.find(o => effortMatches(o.label, level))
        if (!option) {
          const more = menu.options.find(o => /more reasoning/i.test(o.label))
          if (!more) throw new HerdrError('bad_effort', 'Effort level unavailable for this model')
          await pick(p.id, menu, more.n, more.label, 'effort')
          await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
          const next = await waitMenu(p.id, x => x.kind === 'effort' && x.options.some(o => effortMatches(o.label, level)), 4000)
          if (!next || !next.sessionKey) throw new HerdrError('bad_effort', 'Effort level unavailable for this model')
          menu = next
          option = menu.options.find(o => effortMatches(o.label, level))
        }
        if (!option) throw new HerdrError('bad_effort', 'Effort level unavailable for this model')
        await pick(p.id, menu, option.n, option.label, 'effort')
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
        const until = Date.now() + 5000
        let clear = 0
        while (clear < 2 && Date.now() < until) {
          clear = parseModelMenu(await screen(p.id)) ? 0 : clear + 1
          await sleep(250)
        }
        if (clear < 2) throw new HerdrError('stale', 'The /model menu changed — try again.')
      } catch (e) {
        await closeMenu(p.id).catch(() => {})
        throw e
      }
    }
    const info: ModelInfo = { ...before, effort: level, at: new Date(started).toISOString() }
    overrides.set(p.id, { ...info, ms: started })
    observedEfforts.set(p.id, { label: info.label, effort: level })
    setTimeout(poll, 100)
    return info
  })
}
