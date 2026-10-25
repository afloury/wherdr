import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter'
import { e2eScope, lightTags, projectGrep, runsElsewhere } from './e2e/scope'
import ScopeReporter from './e2e/scope-reporter'

afterEach(() => vi.unstubAllEnvs())

it('reads the scope, full by default, and refuses an unknown one', () => {
  expect(e2eScope(undefined)).toBe('full')
  expect(e2eScope('')).toBe('full')
  expect(e2eScope('full')).toBe('full')
  expect(e2eScope('light')).toBe('light')
  expect(() => e2eScope('pr')).toThrow(/E2E_SCOPE/)
})

it('filters nothing in the full suite, and only the other projects in the light set', () => {
  for (const project of ['chromium-phone', 'webkit-phone', 'chromium-desktop', 'webkit-desktop'] as const)
    expect(projectGrep(project, 'full')).toBeUndefined()
  expect(projectGrep('chromium-phone', 'light')).toBeUndefined()
  const webkitPhone = projectGrep('webkit-phone', 'light')!
  expect(webkitPhone.test('send a message @webkit-phone')).toBe(true)
  expect(webkitPhone.test('split @chromium-desktop @webkit-phone @webkit-desktop')).toBe(true)
  expect(webkitPhone.test('split @webkit-desktop')).toBe(false)
  expect(webkitPhone.test('later @webkit-phones')).toBe(false)
  expect(webkitPhone.test('later @webkit-phone-x')).toBe(false)
})

it('counts only the tags of another project as running elsewhere', () => {
  expect(runsElsewhere(['@chromium-desktop'])).toBe(true)
  expect(runsElsewhere(['@webkit-desktop'])).toBe(true)
  expect(runsElsewhere(['@chromium-phone'])).toBe(false)
  expect(runsElsewhere([])).toBe(false)
})

const testCase = (project: string, title: string, tags: string[]) => ({
  tags,
  parent: { project: () => ({ name: project }) },
  titlePath: () => ['', project, 'file.spec.ts', title],
}) as unknown as TestCase
const result = (status: TestResult['status']) => ({ status }) as TestResult

it('fails a light run when chromium-phone skips a test no other project runs', () => {
  vi.stubEnv('E2E_SCOPE', 'light')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const reporter = new ScopeReporter()
  reporter.onTestEnd(testCase('chromium-phone', 'tagged desktop case', ['@chromium-desktop']), result('skipped'))
  reporter.onTestEnd(testCase('chromium-phone', 'passing case', []), result('passed'))
  reporter.onTestEnd(testCase('chromium-desktop', 'desktop skip', []), result('skipped'))
  reporter.onTestEnd(testCase('chromium-phone', 'forgotten desktop case', []), result('skipped'))
  expect(reporter.onEnd({ status: 'passed' } as FullResult)).toEqual({ status: 'failed' })
  expect(error.mock.calls[0]![0]).toContain('file.spec.ts › forgotten desktop case')
  expect(error.mock.calls[0]![0]).not.toContain('tagged desktop case')
  error.mockRestore()
})

it('leaves the full suite and a covered light run alone', () => {
  vi.stubEnv('E2E_SCOPE', 'light')
  const covered = new ScopeReporter()
  covered.onTestEnd(testCase('chromium-phone', 'iPad', ['@webkit-desktop']), result('skipped'))
  expect(covered.onEnd({ status: 'passed' } as FullResult)).toBeUndefined()
  vi.stubEnv('E2E_SCOPE', '')
  const full = new ScopeReporter()
  full.onTestEnd(testCase('chromium-phone', 'desktop case', []), result('skipped'))
  expect(full.onEnd({ status: 'passed' } as FullResult)).toBeUndefined()
})

it('tags e2e tests only with the name of a project the light set filters', () => {
  const dir = join(import.meta.dirname, 'e2e')
  const used = new Set<string>()
  for (const file of readdirSync(dir).filter(name => name.endsWith('.spec.ts'))) {
    for (const [, list] of readFileSync(join(dir, file), 'utf8').matchAll(/\{\s*tag:\s*(\[[^\]]*\]|'[^']*')\s*\}/g))
      for (const [, tag] of list!.matchAll(/'([^']*)'/g)) used.add(tag!)
  }
  expect([...used].filter(tag => !lightTags.includes(tag))).toEqual([])
  // Each project the light set filters still gets tests.
  expect([...used].sort()).toEqual([...lightTags].sort())
})
