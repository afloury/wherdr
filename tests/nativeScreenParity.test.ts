import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import * as choices from '../server/utils/choices'
import * as wait from '../server/utils/waitScreen'
import * as menu from '../shared/menuScreen'
import * as settings from '../shared/settingsScreen'
import { classifyScreen } from '../shared/interactiveScreen'
import { keepReading } from '../server/utils/screenCache'
import { isPermissionQuestion, mergeDetail } from '../server/utils/promptDetail'
import { bindFunction } from './stateFunction'

// Actual recognizers from the fetched origin/main, not a second implementation
// of our new policy. Pin the reviewed base so concurrent fetches cannot move it.
export const BASELINE = 'a430192d380ab1afb2819ad5378c2ce38baeb154'
const tmp = mkdtempSync(path.join(os.tmpdir(), 'wherdr-native-parity-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const emitted = new Set<string>()
function baselineModule(file: string): string {
  const output = path.join(tmp, file.replace(/\.ts$/, '.mjs'))
  if (emitted.has(file)) return output
  emitted.add(file)
  const source = execFileSync('git', ['show', `${BASELINE}:${file}`], { encoding: 'utf8' })
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText
  const linked = js.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, prefix, relative, suffix) => {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative)) + '.ts'
    return prefix + pathToFileURL(baselineModule(dependency)).href + suffix
  })
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, linked)
  return output
}
const load = async (file: string) => import(/* @vite-ignore */ pathToFileURL(baselineModule(file)).href)
const before = { choices: await load('server/utils/choices.ts'), wait: await load('server/utils/waitScreen.ts'), menu: await load('shared/menuScreen.ts'), settings: await load('shared/settingsScreen.ts') }
const after = { choices, wait, menu, settings }
const beforeSource = execFileSync('git', ['show', `${BASELINE}:server/utils/state.ts`], { encoding: 'utf8' })
const afterSource = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
// Herdr emits plain detection text and preserves styling only for ANSI reads.
// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\r/g, '')
function pipeline(source: string, modules: typeof after, text: string) {
  return bindFunction(source, 'choicesFor', {
    ...modules.choices, ...modules.wait, ...modules.menu, ...modules.settings,
    classifyScreen, keepReading, isPermissionQuestion, mergeDetail,
    choicesCache: new Map(), screenWatch: new Map(), askChecks: new Map(),
    modelControlBusy: () => false, noteScreen: () => {},
    herdr: async (_method: string, params: { format?: string }) => ({ read: { text: params.format === 'ansi' ? text : plain(text) } }),
    readMenu: async () => modules.menu.parseMenu(text),
    withOmpTab: async (_id: string, c: import('../shared/types').Choices) => {
      if (!c.tabs || c.tab !== undefined) return c
      const tab = modules.choices.ompActiveTab(text, c.tabs)
      if (tab !== null) return { ...c, tab }
      const { tabs: _, ...rest } = c
      return rest
    },
    transcripts: { pendingAsk: async () => [], pendingClaudeQuestions: async () => [], pendingTool: async () => null },
  })
}


// The recognizer sequence in origin/main's choicesFor, with the same screen
// used for its ANSI read. Transcript completion is unchanged and covered by
// choices.test.ts; compare all extracted objects, not only their truthiness.
function recognize(modules: typeof after, raw: string, agent: string, strict: boolean) {
  const text = plain(raw)
  const framed = text.split('\n').some(l => modules.menu.TOP.test(l))
  let prompt = agent === 'omp' ? modules.choices.parseOmpPrompt(text) : modules.choices.parseChoices(text, { strict })
  const panel = agent !== 'omp' && framed && (strict || !prompt || !modules.choices.parseChoices(text, { strict: true })) ? modules.menu.parseMenu(raw) : null
  if (panel) prompt = null
  const tabs = agent === 'claude' && modules.settings.settingsTabs(text) !== null
  const screen = panel || tabs ? null : modules.wait.parseWaitScreen(text, { choices: Boolean(prompt) })
  return { choices: prompt, menu: panel, screen, settings: tabs }
}
const fixtures = readdirSync(new URL('./fixtures/', import.meta.url)).sort()
const results: { file: string, agent: string, strict: boolean, nativeBefore: boolean, nativeAfter: boolean, exception: boolean }[] = []
afterAll(() => {
  if (process.env.NATIVE_PARITY_REPORT) writeFileSync(process.env.NATIVE_PARITY_REPORT, JSON.stringify({ baseline: BASELINE, fixtures: fixtures.length, comparisons: results.length, results }, null, 2) + '\n')
})
const exceptions = new Set(['codex-usage-menu.txt', 'codex-command-center.txt'])

describe('all fixtures retain origin/main native recognition', () => {
  for (const file of fixtures) for (const agent of ['claude', 'codex', 'omp']) for (const strict of [false, true]) {
    it(`${file} / ${agent} / ${strict ? 'idle' : 'blocked'}`, async () => {
      const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
      const original = recognize(before, text, agent, strict)
      const current = recognize(after, text, agent, strict)
      expect(current).toEqual(original)
      const pane = { id: 'neutral', agent, status: strict ? 'idle' : 'blocked' }
      const oldOutput = await pipeline(beforeSource, before, text)(pane, 1, strict)
      const { interaction: serverInteraction, ...newOutput } = await pipeline(afterSource, after, text)(pane, 1, strict)
      if (exceptions.has(file)) expect(newOutput).toEqual({ choices: null, menu: null, screen: null })
      else expect(newOutput).toEqual(oldOutput)
      const nativeBefore = Boolean(original.choices || original.menu || original.screen || original.settings)
      const interaction = classifyScreen({ text: plain(text), agent, ...current })
      expect(serverInteraction).toBe(interaction)
      results.push({ file, agent, strict, nativeBefore, nativeAfter: interaction === 'native', exception: exceptions.has(file) })
      if (exceptions.has(file)) expect(interaction).toBe('terminal')
      else expect(interaction === 'native').toBe(nativeBefore)
    })
  }
})

// A push must contain the original question/options, not a fallback label.
// Execute the unchanged notification function with both production pipelines.
describe('question push parity', () => {
  for (const agent of ['claude', 'omp']) it(`${agent} retains the exact notification body`, async () => {
    const text = readFileSync(new URL(`./fixtures/${agent === 'claude' ? 'claude-ask-long' : 'omp-ask-single'}.txt`, import.meta.url), 'utf8')
    const sent: unknown[] = []
    for (const [source, modules] of [[beforeSource, before], [afterSource, after]] as const) {
      const pane = { id: 'neutral', agent, status: 'blocked', workspace: 'neutral-workspace', title: 'Neutral' }
      const output = await pipeline(source, modules, text)(pane, 1, false)
      expect(output.choices?.question).toBeTruthy()
      const notify = bindFunction(source, 'notifyPane', {
        isViewed: () => false, state: { workspaces: [], panes: [pane] },
        isProjectThread: () => false, notificationTitle: (t: string) => t,
        multiMachine: () => false, machineOfPane: () => null, getMachine: () => null,
        agentLabel: (a: string) => a, agentNotificationTitle: () => ({ title: 'Question', titleFr: 'Question' }),
        pushSend: async (payload: unknown) => { sent.push(payload); return 1 }, log: () => {},
      })
      await notify({ ...pane, prompt: output.choices })
    }
    expect(sent[1]).toEqual(sent[0])
    expect((sent[1] as { body: string }).body).toContain('\n')
  })
})

// Reconstructed neutral counterparts of review-only captures. These are not
// claimed as new captures from authenticated agents.
describe('review approval rows', () => {
  for (const file of fixtures.filter(f => /^(?:claude|codex)-approve-/.test(f))) it(file, async () => {
    const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
    const pane = { id: 'neutral', agent: file.startsWith('claude') ? 'claude' : 'codex', status: 'blocked' }
    const original = await pipeline(beforeSource, before, text)(pane, 1, false)
    const current = await pipeline(afterSource, after, text)(pane, 1, false)
    expect(original.choices).toBeTruthy()
    expect(current.interaction).toBe('native')
    expect(current.choices).toEqual(original.choices)
  })
})
