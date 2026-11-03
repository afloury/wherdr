// Agent models: the current model of a pane, from its transcript, its status
// line or header on screen, or its config file.
import path from 'node:path'
import type { ModelInfo, Pane } from '../../shared/types'
import { transcripts } from './state'
import { machineOfPane } from './machines'
import { claudeScreenEffort, claudeScreenModel, codexConfigModel, codexFooterModel, ompScreenEffort, ompScreenModel, sameModel } from './models'

// Codex without a reply yet: the model from its config on the agent's machine.
async function fallbackModel(p: Pane): Promise<ModelInfo | null> {
  const m = machineOfPane(p.id)
  if (p.agent !== 'codex' || !m || !m.home) return null
  try { return codexConfigModel(await m.fs.readFile(path.posix.join(m.home, '.codex/config.toml'))) }
  catch { return null }
}

// Codex: model read from its status line (screen re-read by state.ts when not working).
const footers = new Map<string, { info: ModelInfo, ms: number }>()
// Claude: effort announced on screen (banner, /effort output), more reliable
// than the transcript, which keeps the default effort.
const screenEfforts = new Map<string, { effort: string, ms: number }>()
// Claude: model from the header (or from a typed /model), fallback while there is no transcript.
const screenModels = new Map<string, ModelInfo>()
// omp: last screen seen (bottom), for the thinking level on its status line —
// fallback while the transcript has none, read next to the model's name.
const ompScreens = new Map<string, string>()
export function noteScreen(paneId: string, agent: string | null, text: string | null | undefined) {
  if (agent === 'claude') {
    const model = claudeScreenModel(text)
    if (model) screenModels.set(paneId, model)
    const effort = claudeScreenEffort(text)
    if (effort && screenEfforts.get(paneId)?.effort !== effort) screenEfforts.set(paneId, { effort, ms: Date.now() })
    return
  }
  if (agent === 'omp') {
    if (text) ompScreens.set(paneId, text.replace(/\s+$/, '').split('\n').slice(-12).join('\n'))
    return
  }
  if (agent !== 'codex') return
  const info = codexFooterModel(text)
  if (info) footers.set(paneId, { info, ms: Date.now() })
}

export function forgetModel(paneId: string) {
  footers.delete(paneId)
  screenEfforts.delete(paneId)
  screenModels.delete(paneId)
  ompScreens.delete(paneId)
}

export async function currentModel(p: Pane): Promise<ModelInfo | null> {
  if (!p.agent || !['claude', 'codex', 'omp'].includes(p.agent)) return null
  // A failed read throws: the state keeps the model it showed (refreshModel).
  let fromFile = await transcripts.model(p)
  const f = footers.get(p.id)
  if (f && (!fromFile || !sameModel(fromFile.label, f.info.label) || fromFile.effort !== f.info.effort)) {
    // The status line wins over a lagging rollout (change not yet followed by a turn).
    const fileAt = fromFile && fromFile.at ? Date.parse(fromFile.at) : 0
    if (fileAt < f.ms) fromFile = { ...f.info, id: fromFile && sameModel(fromFile.label, f.info.label) ? fromFile.id : null, at: new Date(f.ms).toISOString() }
  }
  const seen = p.agent === 'claude' ? screenEfforts.get(p.id) : null
  if (fromFile && seen) return { ...fromFile, effort: seen.effort }
  if (p.agent === 'omp') {
    const text = ompScreens.get(p.id)
    if (fromFile) {
      const shown = ompScreenEffort(text, fromFile.label)
      if (!fromFile.effort && shown) return { ...fromFile, effort: shown }
      // "auto" shows the glyph of the level it resolved to for this turn.
      if (fromFile.effort === 'auto') return { ...fromFile, effortResolved: shown && shown !== 'auto' && shown !== 'off' ? shown : fromFile.effortResolved ?? null }
      return fromFile
    }
    // No transcript before the first message: the status line alone.
    return ompScreenModel(text)
  }
  if (!fromFile && p.agent === 'claude') {
    // New agent: Claude Code's header already gives model and effort.
    const sm = screenModels.get(p.id)
    if (sm) return { ...sm, effort: seen ? seen.effort : sm.effort }
  }
  return fromFile || fallbackModel(p)
}
