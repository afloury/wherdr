// Which tests each Playwright project runs.
//
// The full suite (push to main or v2, nightly) runs every test on all four projects.
// A pull request sets E2E_SCOPE=pr: chromium-phone runs every test, and each other
// project runs only the tests tagged with its own name, e.g.
//   test('title', { tag: ['@chromium-desktop', '@webkit-desktop'] }, async ...)
// Tag a test for WebKit when it guards Safari/iOS behaviour, and for chromium-desktop
// when it needs a computer (keyboard, split view): a test skipped on phones must carry
// a tag, or the scope reporter fails the pull-request run.

export const PROJECTS = ['chromium-phone', 'webkit-phone', 'chromium-desktop', 'webkit-desktop'] as const
export type Project = typeof PROJECTS[number]
export type Scope = 'full' | 'pr'

/** The project that runs every test, in every scope. */
export const BASE_PROJECT: Project = 'chromium-phone'

export function e2eScope(value = process.env.E2E_SCOPE): Scope {
  if (!value || value === 'full') return 'full'
  if (value === 'pr') return 'pr'
  throw new Error(`E2E_SCOPE must be "pr" or "full", not "${value}"`)
}

/** The tag that selects a test for a project in a pull request. */
export const projectTag = (project: Project) => `@${project}`

/** Tags that select a test for a project other than the base one. */
export const prTags: string[] = PROJECTS.filter(p => p !== BASE_PROJECT).map(projectTag)

/** The project's test filter: none for the full suite or the base project. */
export function projectGrep(project: Project, scope: Scope): RegExp | undefined {
  if (scope === 'full' || project === BASE_PROJECT) return undefined
  // Exact tag: `@webkit-phone` never matches a longer name that starts with it.
  return new RegExp(`${projectTag(project)}(?![\\w-])`)
}

/** Whether a test skipped on the base project still runs elsewhere in a pull request. */
export const runsElsewhere = (tags: readonly string[]) => tags.some(tag => prTags.includes(tag))
