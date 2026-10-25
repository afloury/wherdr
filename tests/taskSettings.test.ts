import { describe, expect, it } from 'vitest'
import { parseTaskSettings, settingGroup, settingValue } from '../shared/taskSettings'

describe('task settings from show', () => {
  it('preserves typed values, inheritance, task overrides and provenance details', () => {
    const settings = [
      { name: 'worker.agent', kind: 'work', value: 'codex', place: 'repo', from: 'your entry for demo', own: false, note: '' },
      { name: 'merge.pr', kind: 'work', value: false, place: 'task', from: 'this task', own: true, note: 'Applies next time', later: 'The current run keeps its settings' },
      { name: 'review.rounds', value: 0, place: 'you' },
      { name: 'worker.fallback', value: ['codex', 'claude'], place: 'file', from: '.herdr-projects.toml' },
    ]
    const parsed = parseTaskSettings(JSON.stringify({ settings, problems: ['Invalid model'] }))
    expect(parsed.settings[0]).toEqual(settings[0])
    expect(parsed.settings[1]).toEqual(settings[1])
    expect(parsed.settings[2]?.value).toBe(0)
    expect(parsed.settings[3]?.value).toEqual(['codex', 'claude'])
    expect(parsed.problems).toEqual(['Invalid model'])
  })
  it('distinguishes absent values from false, zero, empty text and CLI defaults', () => {
    const parsed = parseTaskSettings('{"settings":[{"name":"worker.agent"}]}')
    expect(parsed.settings[0]).toMatchObject({ value: null, place: '', from: '', own: null })
    expect([null, false, 0, '', 'none'].map(settingValue)).toEqual([null, 'false', '0', '', 'none'])
    expect(settingValue(['one', 'two'])).toContain('"two"')
    expect(parseTaskSettings('{"settings":[]}')).toEqual({ settings: [], problems: [] })
  })
  it.each(['{}', '{"settings":{}}', '{"settings":[null]}', '{"settings":[],"problems":{}}', 'bad json'])('rejects malformed CLI output %s', raw => {
    expect(() => parseTaskSettings(raw)).toThrow()
  })
  it('groups all task themes and retains new settings', () => {
    expect(['worker.agent', 'reviewer.agent', 'review.when', 'plan.agent', 'attempts.by', 'check.command', 'limit.time', 'merge.by', 'workspace.from', 'future.option'].map(settingGroup)).toEqual(['agent', 'review', 'review', 'plan', 'plan', 'plan', 'limits', 'merge', 'workspace', 'other'])
  })
})

it('reads the recorded CLI format without losing source notes or problems', async () => {
  const { readFileSync } = await import('node:fs')
  const raw = readFileSync(new URL('./recordings/herdr-projects-1.2.21/show-task.json', import.meta.url), 'utf8')
  const parsed = parseTaskSettings(raw)
  expect(parsed.settings.find(row => row.name === 'worker.fast')?.value).toBe(false)
  expect(parsed.settings.find(row => row.name === 'worker.agent')?.place).toBe('builtin')
  const { taskSettingSource, taskSettingLabel } = await import('../app/utils/taskSettings')
  expect(['task', 'repo', 'you', 'file', 'builtin', 'future', ''].map(taskSettingSource)).toEqual(['Task', 'Repository', 'You', 'Repository file', 'Default', 'future', 'Source not provided'])
  expect(taskSettingLabel('workspace.from')).toBe('Starting branch')
  expect(taskSettingLabel('future.option')).toBe('future.option')
})
