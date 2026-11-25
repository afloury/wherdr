// The files of the demo's task WEB-10, made up in English: what its To review block
// asks the demo server for (POST /api/pm/task-files, GET /api/files/read?task=…).
// Two documents in the task's worktree; nothing is read from any disk.
import type { FilePreview } from '../../shared/types'

interface Found { root: 'worktree' | 'task', rel: string }

const CATALOGUE = `# acme-web component catalogue

The components the web app is built from, and where each one is used. A **draft** is not safe to use yet.

| Component | Used on | Status |
| --- | --- | --- |
| \`PriceTable\` | Billing | stable |
| \`EmptyState\` | Dashboard, Projects | stable |
| \`AppearanceRow\` | Settings | stable |
| \`ColorSchemeToggle\` | Settings | draft |

## Rules

- A page uses a component from this list before it writes its own.
- A new component joins the list in the pull request that adds it.
- A draft becomes stable after one release without a change.

See [plan.md](plan.md) for how the catalogue stays up to date.
`

const PLAN = `# Plan: keep the catalogue up to date

1. Add \`catalogue.md\` to the repository and link it from the README.
2. Check in CI that every component in \`src/components\` has an entry.
3. Once a release, promote the drafts and remove what no page uses.

**Out of scope:** generating the catalogue from the code.
`

// task → path under the task's worktree → text.
const FILES: Record<string, Record<string, string>> = {
  'WEB-10': { 'catalogue.md': CATALOGUE, 'plan.md': PLAN },
}

// Each path the app asks about (as written) that is one of the task's files, and where it is.
export function taskFiles(task: unknown, paths: unknown): Record<string, Found> {
  const files = typeof task === 'string' ? FILES[task] : undefined
  const found: Record<string, Found> = {}
  if (!files || !Array.isArray(paths)) return found
  for (const written of paths) {
    const rel = typeof written === 'string' ? written.replace(/^(?:\.\/)+/, '') : ''
    if (Object.hasOwn(files, rel)) found[written] = { root: 'worktree', rel }
  }
  return found
}

// What GET /api/files/read answers for a file of a task, or none when it is not one.
export function readTaskFile(task: string | null, root: string | null, path: string | null): FilePreview | undefined {
  const files = task ? FILES[task] : undefined
  if (!files || root !== 'worktree' || !path || !Object.hasOwn(files, path)) return undefined
  const text = files[path]!
  return { path, size: new TextEncoder().encode(text).length, kind: 'text', text, truncated: false }
}
