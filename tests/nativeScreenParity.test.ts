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

// Actual recognizers from the fetched origin/main, not a second implementation
// of our new policy. Pin the reviewed base so concurrent fetches cannot move it.
export const BASELINE = '5bed72b7f1f5d3c3cc7e5a543675a0feda0f7b7e'
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

// The recognizer sequence in origin/main's choicesFor, with the same screen
// used for its ANSI read. Transcript completion is unchanged and covered by
// choices.test.ts; compare all extracted objects, not only their truthiness.
function recognize(modules: typeof after, text: string, agent: string, strict: boolean) {
  const framed = text.split('\n').some(l => modules.menu.TOP.test(l))
  let prompt = agent === 'omp' ? modules.choices.parseOmpPrompt(text) : modules.choices.parseChoices(text, { strict })
  const panel = agent !== 'omp' && framed && (strict || !prompt || !modules.choices.parseChoices(text, { strict: true })) ? modules.menu.parseMenu(text) : null
  if (panel) prompt = null
  const tabs = agent === 'claude' && modules.settings.settingsTabs(text) !== null
  const screen = panel || tabs ? null : modules.wait.parseWaitScreen(text, { choices: Boolean(prompt) })
  return { choices: prompt, menu: panel, screen, settings: tabs }
}
const fixtures = readdirSync(new URL('./fixtures/', import.meta.url)).sort()
const exceptions = new Set(['codex-usage-menu.txt', 'codex-command-center.txt'])

describe('all fixtures retain origin/main native recognition', () => {
  for (const file of fixtures) for (const agent of ['claude', 'codex', 'omp']) for (const strict of [false, true]) {
    it(`${file} / ${agent} / ${strict ? 'idle' : 'blocked'}`, () => {
      const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
      const original = recognize(before, text, agent, strict)
      const current = recognize(after, text, agent, strict)
      expect(current).toEqual(original)
      const nativeBefore = Boolean(original.choices || original.menu || original.screen || original.settings)
      const interaction = classifyScreen({ text, agent, ...current })
      if (exceptions.has(file)) expect(interaction).toBe('terminal')
      else expect(interaction === 'native').toBe(nativeBefore)
    })
  }
})
