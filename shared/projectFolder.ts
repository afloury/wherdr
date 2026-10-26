// A folder picked for a project coordinator, as the machine sees it.
// herdr-projects keys a project coordinator by the repo's name on the board
// (data/repos.json: name -> folder), never by a path: a folder the board does
// not know yet is added first (server/utils/projectsTasks.ts registerProject).

// `$1` the folder ("~" or "~/…" is the home folder). Prints `missing`,
// `notgit`, or `git<TAB><root>`, the root being the repo's main checkout (a
// linked worktree's repo), as herdr-projects names it (store/repos.rs primary_root).
export const PROJECT_FOLDER_SCRIPT = 'd=$1; case "$d" in "~") d=$HOME ;; "~/"*) d=$HOME/${d#"~/"} ;; esac; '
  + '[ -d "$d" ] || { echo missing; exit 0; }; cd "$d" 2>/dev/null || { echo missing; exit 0; }; '
  + 't=$(git rev-parse --show-toplevel 2>/dev/null) || { echo notgit; exit 0; }; [ -n "$t" ] || { echo notgit; exit 0; }; '
  + 'c=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); '
  + 'case "$c" in */.git) [ "$c" = "$t/.git" ] || t=${c%/.git} ;; esac; printf \'git\\t%s\\n\' "$t"'

export type FolderLook = { state: 'missing' } | { state: 'notgit' } | { state: 'git', root: string }

export function parseFolderLook(out: string): FolderLook {
  const line = out.split('\n').map(l => l.trim()).find(Boolean) || ''
  if (line === 'notgit') return { state: 'notgit' }
  const m = /^git\t(\/.*)$/.exec(line)
  return m ? { state: 'git', root: m[1]!.replace(/\/+$/, '') || '/' } : { state: 'missing' }
}

// A folder the coordinator is asked by, rather than a repo's name.
export const isFolderRef = (repo: string) => repo === '~' || repo.startsWith('/') || repo.startsWith('~/')

// The board's name for a repo root, from data/repos.json; null when it has none.
export function repoNameOf(repos: unknown, root: string): string | null {
  if (!repos || typeof repos !== 'object' || Array.isArray(repos)) return null
  const want = root.replace(/\/+$/, '')
  for (const [name, dir] of Object.entries(repos as Record<string, unknown>)) {
    if (typeof dir === 'string' && dir.replace(/\/+$/, '') === want) return name
  }
  return null
}

// What the New sheet says of a folder: on the board already (its name), to be
// added, or why it cannot have a project coordinator.
export type ProjectFolder =
  | { state: 'known', repo: string, root: string }
  | { state: 'new', root: string, repo: string }
  | { state: 'missing' }
  | { state: 'notgit' }

export function projectFolderOf(look: FolderLook, repos: unknown): ProjectFolder {
  if (look.state !== 'git') return look
  const repo = repoNameOf(repos, look.root)
  return repo ? { state: 'known', repo, root: look.root } : { state: 'new', root: look.root, repo: newRepoName(repos, look.root) }
}

// The name herdr-projects gives a repo on first sight (store/repos.rs repo_of):
// its folder's name, other characters as "-", 28 at most, "-2", "-3"… when taken.
export function newRepoName(repos: unknown, root: string): string {
  const taken = repos && typeof repos === 'object' && !Array.isArray(repos) ? repos as Record<string, unknown> : {}
  const base = [...(root.replace(/\/+$/, '').split('/').pop() || '')].map(c => (/[A-Za-z0-9_.+-]/.test(c) ? c : '-')).slice(0, 28).join('') || 'home'
  let name = base
  for (let n = 2; Object.hasOwn(taken, name) || name === 'dispatch'; n++) name = `${base}-${n}`
  return name
}

export const FOLDER_MISSING = 'This folder does not exist on this machine.'
export const FOLDER_NOT_GIT = 'This folder is not a Git repository: a project coordinator needs one.'

// The task `add` makes so the board learns the repo; cleared at once.
export const SEED_TITLE = 'wherdr: add this repository to the board'
