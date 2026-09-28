// Modèle des agents, côté pilotage : modèle courant (transcription, choix fait
// depuis le téléphone, défaut), liste des modèles lue dans le menu /model, et
// changement de modèle en pilotant ce menu.
//
// ⚠ On valide toujours avec « s » (cette session seulement), jamais avec
// Entrée ni `/model <nom>` : ceux-là enregistrent le modèle comme défaut
// global de l'utilisateur (~/.claude/settings.json, ~/.codex/config.toml).
// Chez Codex, Entrée sur le premier menu ne fait que passer au choix de
// l'effort (« enter select »), qu'on valide ensuite avec « s ».
import path from 'node:path'
import type { EffortList, ModelInfo, ModelList, ModelOption, Pane } from '../../shared/types'
import { log } from './env'
import { HerdrError, herdr, sleep } from './herdr'
import { closePanel } from './actions'
import { READY, findPane, poll, transcripts } from './state'
import { machineOfPane } from './machines'
import { type ClaudeEffortSlider, type ModelMenu, claudeEffortCommand, claudeEffortLevels, cleanModelName, codexCachedEfforts, codexConfigModel, claudeScreenEffort, codexFooterModel, effortMatches, effortValue, parseClaudeEffortScreen, parseModelMenu, sameModel, switchConfirmKeys } from './models'

// ---------------------------------------------------------------- modèle courant
// Choix fait depuis le téléphone : affiché tout de suite, jusqu'à ce que la
// transcription dise plus récent (Codex n'écrit le modèle qu'au tour suivant).
const overrides = new Map<string, ModelInfo & { ms: number }>()
const observedEfforts = new Map<string, { label: string, effort: string }>()

async function fallbackModel(p: Pane): Promise<ModelInfo | null> {
  const m = machineOfPane(p.id)
  if (p.agent === 'codex') {
    // Config de Codex sur la machine de l'agent.
    if (!m || !m.home) return null
    try { return codexConfigModel(await m.fs.readFile(path.posix.join(m.home, '.codex/config.toml'))) }
    catch { return null }
  }
  // Claude sans réponse encore : le modèle par défaut, tel que l'annonce le menu
  // (« Default (recommended)  Sonnet 5 · … »), s'il a déjà été lu.
  const def = listCache.get(listKey(p.id, 'claude'))?.options[0]
  if (def && /^default\b/i.test(def.label) && def.hint) {
    const label = cleanModelName(def.hint.split('·')[0]!)
    if (label) return { id: null, label, at: null }
  }
  return null
}

// Codex : modèle lu sur sa ligne d'état (écran relu par state.ts hors travail).
const footers = new Map<string, { info: ModelInfo, ms: number }>()
// Claude : effort annoncé à l'écran (bannière, retour de /effort), plus fiable
// que la transcription qui garde l'effort par défaut.
const screenEfforts = new Map<string, { effort: string, ms: number }>()
export function noteScreen(paneId: string, agent: string | null, text: string | null | undefined) {
  if (agent === 'claude') {
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
}

export async function currentModel(p: Pane): Promise<ModelInfo | null> {
  if (!p.agent || !['claude', 'codex'].includes(p.agent)) return null
  let fromFile = await transcripts.model(p).catch(() => null)
  const f = footers.get(p.id)
  if (f && (!fromFile || !sameModel(fromFile.label, f.info.label) || fromFile.effort !== f.info.effort)) {
    // La ligne d'état fait foi sur une rollout en retard (changement pas encore suivi d'un tour).
    const fileAt = fromFile && fromFile.at ? Date.parse(fromFile.at) : 0
    if (fileAt < f.ms) fromFile = { ...f.info, id: fromFile && sameModel(fromFile.label, f.info.label) ? fromFile.id : null, at: new Date(f.ms).toISOString() }
  }
  const o = overrides.get(p.id)
  if (o) {
    const fileAt = fromFile && fromFile.at ? Date.parse(fromFile.at) : 0
    if (!fromFile || fileAt < o.ms) {
      const { ms: _ms, ...info } = o
      // Même modèle que la transcription : on garde son identifiant brut.
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
  return fromFile || fallbackModel(p)
}

// ---------------------------------------------------------------- menu /model
const LIST_TTL_MS = 12 * 3600 * 1000
// Par machine et type d'agent (les versions de Claude / Codex peuvent différer).
const listCache = new Map<string, ModelList>()
const listKey = (paneId: string, agent: string) => `${machineOfPane(paneId)?.key || ''}|${agent}`
const busy = new Set<string>()

async function withPane<T>(paneId: string, fn: (p: Pane) => Promise<T>): Promise<T> {
  const p = findPane(paneId)
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  if (!p.agent || !['claude', 'codex'].includes(p.agent)) throw new HerdrError('unsupported', 'pas un agent Claude ou Codex')
  if (!READY.has(p.status || '')) {
    throw new HerdrError('busy', p.status === 'blocked' ? 'L’agent attend une réponse — réponds-lui d’abord.' : 'L’agent travaille — change de modèle quand il a fini.')
  }
  if (busy.has(paneId)) throw new HerdrError('busy', 'Changement de modèle déjà en cours')
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

// Referme le menu (Échap) tant qu'il est à l'écran. Jamais d'Échap sans menu :
// chez Codex, Échap Échap au repos ouvre l'édition du message précédent.
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
  await herdr('agent.prompt', { target: p.id, text: '/model' })
  const m = await waitMenu(p.id, x => x.kind === 'model')
  if (!m) {
    await closeMenu(p.id)
    throw new HerdrError('no_menu', 'Le menu /model ne s’est pas affiché')
  }
  return m
}

const moveKeys = (from: number, to: number) => Array.from({ length: Math.abs(to - from) }, () => (to > from ? 'down' : 'up'))

// Toutes les options : Claude n'en montre que 10 (↑/↓ devant le numéro), on
// remonte au début puis on descend page par page (la liste reboucle en haut
// après la dernière).
async function readAllOptions(paneId: string, first: ModelMenu) {
  const all = new Map(first.options.map(o => [o.n, o]))
  let m = first
  // Page ouverte plus bas (modèle courant en fin de liste) : on remonte d'abord au n° 1.
  if (m.options[0]!.n > 1) {
    await herdr('pane.send_input', { pane_id: paneId, keys: moveKeys(m.cursor, 1) })
    const top = await waitMenu(paneId, x => x.kind === 'model' && x.cursor === 1, 3000)
    if (!top) throw new HerdrError('stale', 'Le menu /model a changé — réessaie.')
    for (const o of top.options) if (!all.has(o.n)) all.set(o.n, o)
    m = top
  }
  for (let i = 0; i < 8 && m.scrollDown; i++) {
    const last = m.options[m.options.length - 1]!.n
    await herdr('pane.send_input', { pane_id: paneId, keys: moveKeys(m.cursor, last + 1) })
    await sleep(350)
    const next = await waitMenu(paneId, x => x.kind === 'model', 2000)
    if (!next || next.cursor <= last) break // rebouclé : fin de liste
    const before = all.size
    for (const o of next.options) if (!all.has(o.n)) all.set(o.n, o)
    if (all.size === before) break
    m = next
  }
  return [...all.values()].sort((a, b) => a.n - b.n)
}

// « current » n'est pas gardé : la liste est partagée par tous les agents du même type.
const toOption = ({ label, hint, isDefault }: ModelOption): ModelOption => ({ label, hint, isDefault: Boolean(isDefault) })

export async function listModels(paneId: string, refresh = false): Promise<ModelList> {
  const p0 = findPane(paneId)
  if (!p0 || !p0.agent) throw new HerdrError('bad_pane', 'pane introuvable')
  const hit = listCache.get(listKey(p0.id, p0.agent))
  if (hit && !refresh && Date.now() - hit.at < LIST_TTL_MS) return hit
  return withPane(paneId, async (p) => {
    const m = await openMenu(p)
    let options: ModelOption[]
    try { options = (await readAllOptions(p.id, m)).map(toOption) }
    finally { await closeMenu(p.id) }
    const list: ModelList = { agent: p.agent!, options, at: Date.now() }
    listCache.set(listKey(p.id, p.agent!), list)
    log(`modèles ${p.agent} : ${options.map(o => o.label).join(', ')}`)
    return list
  })
}

// Déplace le curseur sur l'option `n` et vérifie qu'il y est bien.
async function pick(paneId: string, m: ModelMenu, n: number, label: string, kind: ModelMenu['kind']) {
  const keys = moveKeys(m.cursor, n)
  if (keys.length) await herdr('pane.send_input', { pane_id: paneId, keys })
  const at = await waitMenu(paneId, x => x.kind === kind && x.cursor === n, 3000)
  const o = at && at.options.find(x => x.n === n)
  if (!at || !o || o.label !== label) throw new HerdrError('stale', 'Le menu /model a changé — réessaie.')
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
      // Numéro de l'option : dans la liste lue (le menu ne montre qu'une page).
      let n = m.options.find(o => o.label === label)?.n
      if (!n) {
        n = (await readAllOptions(p.id, m)).find(o => o.label === label)?.n
        m = (await waitMenu(p.id, x => x.kind === 'model', 2000)) || m // curseur déplacé
      }
      if (!n) throw new HerdrError('bad_model', `Modèle introuvable dans /model : ${label}`)
      m = await pick(p.id, m, n, label, 'model')
      // « Default (recommended) » : Claude confirmera avec le nom du modèle par défaut.
      const picked = m.options.find(o => o.n === n)
      const confirmAs = /^default\b/i.test(label) && picked && picked.hint ? cleanModelName(picked.hint.split('·')[0]!) : label

      let effort: string | null = null
      if (p.agent === 'claude') {
        if (!m.sessionKey) throw new HerdrError('unsafe', 'Validation « cette session seulement » introuvable — rien n’a été changé.')
        effort = m.effort
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
      } else {
        // Codex : Entrée ne fait que passer au choix de l'effort (« enter select »).
        if (!m.enterSelects) throw new HerdrError('unsafe', 'Menu /model inattendu — rien n’a été changé.')
        await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
        const e = await waitMenu(p.id, x => x.kind === 'effort', 4000)
        if (!e || !e.sessionKey) throw new HerdrError('unsafe', 'Choix de l’effort inattendu — rien n’a été changé.')
        // On garde l'effort courant s'il existe pour ce modèle, sinon celui proposé.
        const keep = e.options.find(o => effortMatches(o.label, before && before.effort))
        const at = keep && keep.n !== e.cursor ? await pick(p.id, e, keep.n, keep.label, 'effort') : e
        effort = (at.options.find(o => o.n === at.cursor)?.label || '').toLowerCase().replace(/\s+/g, '') || null
        if (effort === 'extrahigh') effort = 'xhigh'
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
      }
      // Menu refermé = choix pris. Claude peut d'abord demander confirmation
      // (conversation en cache pour l'ancien modèle) : on confirme ce modèle-là.
      // Fini quand ni menu ni confirmation n'est vu deux fois de suite.
      const until = Date.now() + 5000
      let clear = 0
      while (clear < 2 && Date.now() < until) {
        const text = await screen(p.id)
        const confirm = p.agent === 'claude' ? switchConfirmKeys(text, confirmAs) : null
        if (confirm) await herdr('pane.send_input', { pane_id: p.id, keys: confirm })
        clear = confirm || parseModelMenu(text) ? 0 : clear + 1
        await sleep(confirm ? 400 : 250)
      }
      if (clear < 2) throw new HerdrError('stale', 'Le menu /model a changé — réessaie.')
      const info: ModelInfo = { id: null, label: confirmAs, effort, at: new Date(started).toISOString() }
      overrides.set(p.id, { ...info, ms: started })
      if (effort) observedEfforts.set(p.id, { label: confirmAs, effort })
      log(`modèle ${p.id} (${p.agent}) -> ${confirmAs}${effort ? ' ' + effort : ''} (cette session)`)
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
  if (!m.enterSelects) throw new HerdrError('unsafe', 'Menu /model inattendu — rien n’a été changé.')
  const current = m.options.find(o => o.current || sameModel(o.label, model.label))
  if (!current) throw new HerdrError('stale', 'Le menu /model a changé — réessaie.')
  await pick(p.id, m, current.n, current.label, 'model')
  await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
  const e = await waitMenu(p.id, x => x.kind === 'effort', 4000)
  if (!e || !e.sessionKey) throw new HerdrError('unsafe', 'Choix de l’effort inattendu — rien n’a été changé.')
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

// Échap tant que le curseur est à l'écran : il ne doit jamais rester ouvert.
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
  await herdr('agent.prompt', { target: p.id, text: '/effort' })
  const s = await waitSlider(p.id, () => true, 4000)
  if (!s) {
    // Écran inconnu : on referme quand même (Échap unique, le curseur ne se lit peut-être plus).
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
      // Lire la liste ne doit pas envoyer /effort : Claude inscrit même une
      // ouverture annulée dans la transcription. Le choix vérifie les niveaux
      // réellement proposés dans le curseur avant de modifier quoi que ce soit.
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
      if (!claudeEffortCommand(level, before.label)) throw new HerdrError('bad_effort', 'Niveau d’effort indisponible pour ce modèle')
      const slider = await openEffortSlider(p)
      try {
        const levels = slider.levels.length ? slider.levels : claudeEffortLevels(before.label)
        if (!levels.includes(slider.current)) throw new HerdrError('unsafe', 'Curseur d’effort inattendu — rien n’a été changé.')
        if (!levels.includes(level)) throw new HerdrError('bad_effort', 'Niveau d’effort indisponible pour ce modèle')
        const delta = levels.indexOf(level) - levels.indexOf(slider.current)
        if (delta) await herdr('pane.send_input', { pane_id: p.id, keys: Array.from({ length: Math.abs(delta) }, () => delta > 0 ? 'right' : 'left') })
        const at = await waitSlider(p.id, x => x.current === level, 3000)
        if (!at) throw new HerdrError('stale', 'Le curseur d’effort n’a pas suivi — rien n’a été changé.')
        // « s » = cette session seulement. Jamais Entrée : elle enregistre le défaut.
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
          if (!more) throw new HerdrError('bad_effort', 'Niveau d’effort indisponible pour ce modèle')
          await pick(p.id, menu, more.n, more.label, 'effort')
          await herdr('pane.send_input', { pane_id: p.id, keys: ['enter'] })
          const next = await waitMenu(p.id, x => x.kind === 'effort' && x.options.some(o => effortMatches(o.label, level)), 4000)
          if (!next || !next.sessionKey) throw new HerdrError('bad_effort', 'Niveau d’effort indisponible pour ce modèle')
          menu = next
          option = menu.options.find(o => effortMatches(o.label, level))
        }
        if (!option) throw new HerdrError('bad_effort', 'Niveau d’effort indisponible pour ce modèle')
        await pick(p.id, menu, option.n, option.label, 'effort')
        await herdr('pane.send_input', { pane_id: p.id, keys: ['s'] })
        const until = Date.now() + 5000
        let clear = 0
        while (clear < 2 && Date.now() < until) {
          clear = parseModelMenu(await screen(p.id)) ? 0 : clear + 1
          await sleep(250)
        }
        if (clear < 2) throw new HerdrError('stale', 'Le menu /model a changé — réessaie.')
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
