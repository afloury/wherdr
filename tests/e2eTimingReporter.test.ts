import { afterEach, expect, it, vi } from 'vitest'
import TimingReporter from './e2e/timing-reporter'
import type { FullConfig, FullResult, Suite } from '@playwright/test/reporter'

const { writeFileSync, now } = vi.hoisted(() => ({ writeFileSync: vi.fn(), now: vi.fn() }))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync }))
vi.mock('node:perf_hooks', () => ({ performance: { now } }))
afterEach(() => vi.resetAllMocks())

it('separates server setup and execution, preserving the collected inventory', () => {
  now.mockReturnValueOnce(100).mockReturnValueOnce(450).mockReturnValueOnce(1450)
  const reporter = new TimingReporter()
  reporter.onBegin({} as FullConfig, { allTests: () => [{
    parent: { project: () => ({ name: 'chromium-phone' }) },
    titlePath: () => ['spec', 'skipped case'], expectedStatus: 'skipped',
  }] } as unknown as Suite)
  reporter.onEnd({ status: 'failed' } as FullResult)
  expect(JSON.parse(writeFileSync.mock.calls[0]![1])).toEqual({
    startMs: 350, testMs: 1000, status: 'failed',
    tests: [{ project: 'chromium-phone', title: ['spec', 'skipped case'], expectedStatus: 'skipped' }],
  })
})

it('records startup failures without inventing a test duration', () => {
  now.mockReturnValueOnce(100).mockReturnValueOnce(800)
  const reporter = new TimingReporter()
  reporter.onBegin({} as FullConfig, { allTests: () => [] } as unknown as Suite)
  reporter.onEnd({ status: 'failed' } as FullResult)
  expect(JSON.parse(writeFileSync.mock.calls[0]![1])).toEqual({
    startMs: 700, testMs: null, status: 'failed', tests: [],
  })
})
