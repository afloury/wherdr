// Which tests each Playwright project runs.
//
// The full suite (manual CI run, release tag vX.Y.Z, or no E2E_SCOPE locally) runs
// every test on all four projects. The light set (E2E_SCOPE=light: pull requests and
// pushes on CI) runs every test on chromium-phone, and on each other project only
// the tests tagged with its own name, e.g.
//   test('title', { tag: ['@chromium-desktop', '@webkit-desktop'] }, async ...)
// Tag a test for WebKit when it guards Safari/iOS behaviour, and for chromium-desktop
// when it needs a computer (keyboard, split view): a test skipped on phones must carry
// a tag, or the scope reporter fails the light run.

export const PROJECTS = ['chromium-phone', 'webkit-phone', 'chromium-desktop', 'webkit-desktop'] as const
export type Project = typeof PROJECTS[number]
export type Scope = 'full' | 'light'

/** The project that runs every test, in every scope. */
export const BASE_PROJECT: Project = 'chromium-phone'

export function e2eScope(value = process.env.E2E_SCOPE): Scope {
  if (!value || value === 'full') return 'full'
  if (value === 'light') return 'light'
  throw new Error(`E2E_SCOPE must be "light" or "full", not "${value}"`)
}

/** The tag that selects a test for a project in the light set. */
export const projectTag = (project: Project) => `@${project}`

/** Tags that select a test for a project other than the base one. */
export const lightTags: string[] = PROJECTS.filter(p => p !== BASE_PROJECT).map(projectTag)

/** The project's test filter: none for the full suite or the base project. */
export function projectGrep(project: Project, scope: Scope): RegExp | undefined {
  if (scope === 'full' || project === BASE_PROJECT) return undefined
  // Exact tag: `@webkit-phone` never matches a longer name that starts with it.
  return new RegExp(`${projectTag(project)}(?![\\w-])`)
}

/** Whether a test skipped on the base project still runs elsewhere in the light set. */
export const runsElsewhere = (tags: readonly string[]) => tags.some(tag => lightTags.includes(tag))
