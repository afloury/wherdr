import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import * as choices from '../server/utils/choices'
import * as wait from '../server/utils/waitScreen'
import * as menu from '../shared/menuScreen'
import * as settings from '../shared/settingsScreen'
import { classifyScreen } from '../shared/interactiveScreen'
import { keepReading } from '../server/utils/screenCache'
import { isPermissionQuestion, mergeDetail } from '../server/utils/promptDetail'
import { bindFunction } from './stateFunction'

// Versioned fixture expectations, captured once from the reviewed main. These
// are ordinary regression expectations: deliberate native improvements update
// the affected cases, rather than requiring old commits or executing old code.
const baseline = JSON.parse(readFileSync(new URL('./baselines/native-screens.json', import.meta.url), 'utf8'))
const expected = (key: string) => baseline.values[baseline.cases[key]]
const after = { choices, wait, menu, settings }
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
  if (process.env.NATIVE_PARITY_REPORT) writeFileSync(process.env.NATIVE_PARITY_REPORT, JSON.stringify({ baseline: baseline.provenance, fixtures: fixtures.length, comparisons: results.length, results }, null, 2) + '\n')
})
const exceptions = new Set(['codex-usage-menu.txt', 'codex-command-center.txt'])

describe('all fixtures retain origin/main native recognition', () => {
  for (const file of fixtures) for (const agent of ['claude', 'codex', 'omp']) for (const strict of [false, true]) {
    it(`${file} / ${agent} / ${strict ? 'idle' : 'blocked'}`, async () => {
      const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
      const reference = expected(`${file}/${agent}/${strict}`)
      expect(reference).toBeDefined()
      const original = reference.recognized
      const current = recognize(after, text, agent, strict)
      expect(current).toEqual(original)
      const pane = { id: 'neutral', agent, status: strict ? 'idle' : 'blocked' }
      const oldOutput = reference.output
      const { interaction: serverInteraction, ...newOutput } = await pipeline(afterSource, after, text)(pane, 1, strict)
      if (exceptions.has(file) && agent === 'codex') expect(newOutput).toEqual({ choices: null, menu: null, screen: null })
      else expect(newOutput).toEqual(oldOutput)
      const nativeBefore = Boolean(original.choices || original.menu || original.screen || original.settings)
      const interaction = classifyScreen({ text: plain(text), agent, ...current })
      expect(serverInteraction).toBe(interaction)
      results.push({ file, agent, strict, nativeBefore, nativeAfter: interaction === 'native', exception: exceptions.has(file) && agent === 'codex' })
      if (exceptions.has(file) && agent === 'codex') expect(interaction).toBe('terminal')
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
    for (const [source, modules] of [[afterSource, after]] as const) {
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
    expect(sent[0]).toEqual(expected(`push/${agent}`))
    expect((sent[0] as { body: string }).body).toContain('\n')
  })
})

// Reconstructed neutral counterparts of review-only captures. These are not
// claimed as new captures from authenticated agents.
describe('review approval rows', () => {
  for (const file of fixtures.filter(f => /^(?:claude|codex)-approve-/.test(f))) it(file, async () => {
    const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
    const pane = { id: 'neutral', agent: file.startsWith('claude') ? 'claude' : 'codex', status: 'blocked' }
    const original = expected(`${file}/${pane.agent}/false`).output
    const current = await pipeline(afterSource, after, text)(pane, 1, false)
    expect(original.choices).toBeTruthy()
    expect(current.interaction).toBe('native')
    expect(current.choices).toEqual(original.choices)
  })
})

it('covers exactly the current fixture corpus', () => {
  expect(Object.keys(baseline.cases).filter(k => !k.startsWith('push/')).sort()).toEqual(fixtures.flatMap(f => ['claude', 'codex', 'omp'].flatMap(a => [false, true].map(strict => `${f}/${a}/${strict}`))).sort())
})
