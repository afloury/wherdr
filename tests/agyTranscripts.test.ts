import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fieldOf } from '../server/utils/agyProtobuf'
import {
  agyToolSummary, agyUserText, agyAnchorOf, conversationPath, hasStep, agyHeadOf,
  parseAgyStep, prefixOf, takeVisible, type AgyDoc, type AgyStep,
} from '../server/utils/agyTranscripts'
import { AGY_SESSION, stepBlobs } from './helpers/agy-fixture.mjs'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'wherdr-agy-'))
  homes.push(home)
  return { home }
}
afterEach(() => { vi.unstubAllEnvs(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

// The wire blobs of one row, decoded back through parseAgyStep.
function step(row: Record<string, unknown>, idx: number): AgyStep | null {
  const { type, metadata, payload } = stepBlobs(row, idx)
  return parseAgyStep(idx, type, Number(row.status ?? 3), metadata, payload, null)
}

const doc = (steps: AgyStep[], results: [string, { out: string, error: boolean }][] = []): AgyDoc =>
  ({ file: 'conv.db', model: null, steps, results: new Map(results), fingerprints: new Map(steps.map(s => [s.idx, `fp${s.idx}`])) })

it('decodes user, agent (thinking and calls), observation and error steps', () => {
  const user = step({ role: 'user', text: 'Review the date parser' }, 0)
  const agent = step({ role: 'agent', text: 'Done', thinking: 'Check edge cases', calls: [{ id: 'call-1', name: 'run_command', args: JSON.stringify({ CommandLine: 'npm test' }) }] }, 1)
  const obs = step({ role: 'obs', resultOf: 'call-1', out: '12 passed' }, 2)
  const error = step({ role: 'error', text: 'The model produced an invalid tool call.' }, 3)
  expect(user).toMatchObject({ role: 'user', text: 'Review the date parser', ts: '2026-02-02T12:00:00.000Z' })
  expect(agent).toMatchObject({ role: 'agent', text: 'Done', thinking: 'Check edge cases', calls: [{ id: 'call-1', name: 'run_command' }] })
  expect(obs).toMatchObject({ role: 'obs', resultOf: 'call-1', out: '12 passed' })
  expect(error).toMatchObject({ role: 'error', text: 'The model produced an invalid tool call.', error: true })
  expect(agent?.ms).toBe(0) // identical start/end Timestamps still give a duration
})

it('unwraps <USER_REQUEST> and drops machine context from a user prompt', () => {
  const f19 = fieldOf(stepBlobs({ role: 'user', text: '<USER_REQUEST>\nFix the webhook retries\n</USER_REQUEST>\n<workspace>\n/home/user/acme-shop\n</workspace>' }, 0).payload, 19)
  expect(agyUserText(f19)).toBe('Fix the webhook retries')
  const direct = fieldOf(stepBlobs({ role: 'user', text: 'Plain prompt' }, 0).payload, 19)
  expect(agyUserText(direct)).toBe('Plain prompt')
})

it('marks failed agent steps and internal steps hidden', () => {
  const failed = step({ role: 'agent', text: 'Stopped', status: 6 }, 0)
  const hidden = step({ role: 'hidden', type: 101 }, 1)
  const system = step({ role: 'hidden', type: 23 }, 2)
  expect(failed).toMatchObject({ role: 'agent', error: true })
  expect(hidden).toMatchObject({ role: 'hidden' })
  expect(system).toMatchObject({ role: 'hidden' })
})

it('survives torn and unknown-wire protobuf fields', () => {
  // Truncated length, then a group wire type: the field list ends, no throw.
  const meta = Buffer.from([0xfa, 0xff, 0x01, 0x0b])
  expect(parseAgyStep(9, 23, 3, meta, meta, null)).toMatchObject({ role: 'hidden' })
  expect(parseAgyStep(9, 15, 3, meta, meta, null)).toBeNull()
  expect(parseAgyStep(9, 14, 3, Buffer.from([0x80]), stepBlobs({ role: 'user', text: 'Intact' }, 0).payload, null))
    .toMatchObject({ role: 'user', text: 'Intact' })
})

it('summarizes a tool call from its best-known argument', () => {
  expect(agyToolSummary('run_command', JSON.stringify({ CommandLine: 'npm test' }))).toBe('npm test')
  expect(agyToolSummary('read_file', JSON.stringify({ Path: '/home/user/a.ts' }))).toBe('/home/user/a.ts')
  expect(agyToolSummary('grep_search', JSON.stringify({ Query: 'retry' }))).toBe('retry')
  expect(agyToolSummary('run_command', 'not json')).toBe('run_command')
  expect(agyToolSummary('read_file', '{}')).toBe('read_file')
})

it('pages backwards over the visible items', () => {
  const steps: AgyStep[] = []
  for (let i = 0; i < 140; i++) {
    steps.push(step({ role: 'user', text: `Request ${i + 1}` }, i * 2)!)
    steps.push(step({ role: 'agent', text: `Reply ${i + 1}` }, i * 2 + 1)!)
  }
  const d = doc(steps)
  const page = takeVisible(steps, d, 120)
  expect(page.items.length).toBe(120)
  expect(page.items.at(-1)?.text).toBe('Reply 140')
  expect(page.start).toBe(steps.find(s => s.text === 'Request 81')!.idx)
  // An earlier page ends just before the kept start.
  const older = takeVisible(steps.slice(0, steps.findIndex(s => s.idx >= page.start)), d, 120)
  expect(older.items.at(-1)?.text).toBe('Reply 80')
})

it('describes page anchors in the token helpers', () => {
  const steps = [step({ role: 'user', text: 'One' }, 0)!, step({ role: 'agent', text: 'Two' }, 1)!]
  const d = doc(steps)
  expect(prefixOf(d, 0)).toMatch(/^[0-9a-f]{12}$/)
  expect(prefixOf(d, 0)).not.toBe(prefixOf(d, 1))
  expect(agyHeadOf(`conv.db:4096:null:abcdef123456/0.${prefixOf(d, 0)}`)).toEqual({ file: 'conv.db', size: 4096, from: null, gen: 'abcdef123456' })
  expect(agyHeadOf('junk')).toBeNull()
  expect(agyAnchorOf(`conv.db:4096:null:abcdef123456/0.${prefixOf(d, 0)}`)).toEqual({ start: 0, hash: prefixOf(d, 0) })
  expect(agyAnchorOf('conv.db:1:null:abcdef123456')).toBeNull()
  expect(hasStep(steps, 0)).toBe(true)
  expect(hasStep(steps, 1)).toBe(true)
  expect(hasStep(steps, 42)).toBe(false)
})

it('resolves the conversation path under the data dir, honoring ANTIGRAVITY_APP_DATA_DIR', () => {
  const { home } = fixture()
  const file = path.join(home, '.gemini', 'antigravity-cli', 'conversations', `${AGY_SESSION}.db`)
  expect(conversationPath(home, AGY_SESSION, false)).toBe(file)
  vi.stubEnv('ANTIGRAVITY_APP_DATA_DIR', path.join(home, 'custom-data'))
  expect(conversationPath(home, AGY_SESSION, true)).toBe(path.join(home, 'custom-data', 'conversations', `${AGY_SESSION}.db`))
  expect(conversationPath(home, 'not-a-uuid', false)).toBeNull()
  expect(conversationPath(home, '', false)).toBeNull()
})
