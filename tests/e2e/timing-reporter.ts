import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter'

// Reporter construction precedes webServer startup; onBegin follows server
// readiness and collection. Keep setup separate from test execution/teardown.
export default class TimingReporter implements Reporter {
  private createdAt = performance.now()
  private beganAt = 0
  private tests: { project: string; title: string[]; expectedStatus: string }[] = []

  onBegin(_config: FullConfig, suite: Suite) {
    // Playwright supplies an empty suite when setup fails before collection.
    if (suite.allTests().length) this.beganAt = performance.now()
    this.tests = suite.allTests().map(test => ({
      project: test.parent.project()!.name,
      title: test.titlePath(),
      expectedStatus: test.expectedStatus,
    }))
  }

  onEnd(result: FullResult) {
    const endedAt = performance.now()
    mkdirSync('e2e-metrics', { recursive: true })
    writeFileSync('e2e-metrics/playwright.json', JSON.stringify({
      // An empty suite records setup time without inventing test execution.
      startMs: (this.beganAt || endedAt) - this.createdAt,
      testMs: this.beganAt ? endedAt - this.beganAt : null,
      status: result.status,
      tests: this.tests,
    }, null, 2))
  }
}
