// What an inline code span in a reply holds, so the markdown can tint it like
// a terminal would: a file path, a command, an ID (thread, commit, issue), a
// number or duration, a key, or a failure (`exit 1`, `FAIL`). Plain code
// (identifiers, snippets) has no kind.
import { pathCandidate } from '../../shared/filePaths'

export type CodeKind = 'path' | 'cmd' | 'id' | 'num' | 'key' | 'err' | 'ok'

// Programs an agent usually names at the start of a command.
const PROGRAMS = new Set([
  'git', 'gh', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'python', 'python3', 'pip', 'uv', 'cargo',
  'go', 'make', 'docker', 'kubectl', 'cd', 'ls', 'cat', 'grep', 'rg', 'find', 'sed', 'awk', 'curl', 'wget',
  'ssh', 'scp', 'rsync', 'tar', 'chmod', 'chown', 'mkdir', 'rm', 'mv', 'cp', 'echo', 'export', 'sudo', 'brew',
  'apt', 'apk', 'systemctl', 'journalctl', 'flock', 'tmux', 'herdr', 'claude', 'codex', 'omp', 'vitest', 'jest',
  'tsc', 'eslint', 'prettier', 'nuxt', 'vite', 'swift', 'xcodebuild', 'open', 'kill', 'ps', 'top', 'du', 'df',
  'free', 'uptime', 'touch', 'head', 'tail', 'jq', 'env', 'source', 'bash', 'sh', 'zsh',
])
// A key: a combination (`Ctrl+C`, `⌘K`, `shift-tab`), a capitalized key name
// (`Esc`, `Enter`; lowercase `delete` or `tab` is more likely code) or a symbol.
const MODS = 'ctrl|control|cmd|command|alt|option|opt|shift|meta|super|fn'
const KEYS = 'esc|escape|enter|return|tab|space|backspace|delete|del|home|end|pgup|pgdn|up|down|left|right|f\\d{1,2}'
const KEY_COMBO = new RegExp(`^(?:${MODS})(?:[+-](?:${MODS}|${KEYS}|.))+$|^[⌘⌃⌥⇧]+\\S{0,2}$|^[↵⏎⇥⌫⎋↑↓←→]$`, 'i')
const KEY_NAME = /^(?:Esc|Escape|Enter|Return|Tab|Space|Backspace|Delete|Home|End|PgUp|PgDn|F\d{1,2}|ESC|ENTER|TAB)$/
const UNITS = 'ms|µs|ns|s|sec|min|h|d|%|x|×|k|m|kb|ko|mb|mo|gb|go|tb|b|px|em|rem|lines|tests|files'
const NUM = new RegExp(`^[~≈<>+−-]?\\d[\\d_.,]*\\s?(?:${UNITS})?(?:\\s\\d[\\d.,]*\\s?(?:${UNITS}))*$`, 'i')

export function codeKind(code: string): CodeKind | null {
  const s = String(code || '').trim()
  if (!s || s.length > 400) return null
  if (/^(?:exit|code|status)\s+0$|^(?:ok|pass(?:ed)?|✓)$/i.test(s)) return 'ok'
  if (/^(?:exit|code|status)\s+[1-9]\d*$|^(?:fail(?:ed)?|error|✗)$/i.test(s) || /^(?:E[A-Z]{3,}|SIG[A-Z]+)$/.test(s)) return 'err'
  if (KEY_COMBO.test(s) || KEY_NAME.test(s)) return 'key'
  if (/^t-\d{3,}$|^[A-Z][A-Z0-9]+-\d+$|^(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}$/.test(s)) return 'id'
  if (NUM.test(s)) return 'num'
  if (pathCandidate(s)) return 'path'
  if (/^\$\s|^\/[a-z][\w-]*(?:\s|$)/.test(s)) return 'cmd'
  const first = s.split(/\s+/)[0]!
  if (PROGRAMS.has(first) && /\s/.test(s)) return 'cmd'
  if (/\s--?[a-z]/.test(s) && /^[a-z][\w.-]*\s/.test(s)) return 'cmd'
  return null
}
