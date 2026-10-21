import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { BASE_PROJECT, e2eScope, runsElsewhere } from './scope'

// In a pull request only chromium-phone runs every test. A test it skips (a computer
// layout, an iPad context) must be tagged for another project, or no browser would
// run it before the merge: fail the run and name the test.
export default class ScopeReporter implements Reporter {
  private scope = e2eScope()
  private missing: string[] = []

  onTestEnd(test: TestCase, result: TestResult) {
    if (this.scope !== 'pr' || result.status !== 'skipped') return
    if (test.parent.project()?.name !== BASE_PROJECT) return
    if (runsElsewhere(test.tags)) return
    this.missing.push(test.titlePath().filter(Boolean).slice(1).join(' › '))
  }

  onEnd(result: FullResult) {
    if (!this.missing.length) return
    console.error(`\nSkipped on ${BASE_PROJECT} and tagged for no other project, so no pull request runs them.`
      + `\nAdd { tag: '@chromium-desktop' } (or '@webkit-phone', '@webkit-desktop'), see tests/e2e/scope.ts:\n`
      + this.missing.map(title => `  - ${title}`).join('\n'))
    return { status: result.status === 'passed' ? 'failed' as const : result.status }
  }
}
