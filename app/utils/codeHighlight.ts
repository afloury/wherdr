// Light syntax colours for the code blocks of a Markdown file (file explorer):
// comments, strings, numbers and keywords, by family of languages. One pass
// of one regular expression, no dependency; text in, escaped HTML out, every
// token a <span class="hl-…">. An unknown language is only escaped.

interface Family { comment: string, keywords: string[], caseless?: boolean, tags?: boolean }

const C_LIKE = ['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'function', 'const', 'let', 'var', 'class', 'extends', 'implements', 'interface', 'type', 'enum', 'import', 'export', 'from', 'as', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'throws', 'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'void', 'static', 'public', 'private', 'protected', 'readonly', 'abstract', 'true', 'false', 'null', 'undefined', 'nil', 'fn', 'pub', 'struct', 'impl', 'trait', 'mod', 'use', 'mut', 'match', 'loop', 'where', 'self', 'Self', 'func', 'package', 'go', 'defer', 'chan', 'map', 'range', 'select', 'int', 'long', 'char', 'bool', 'boolean', 'float', 'double', 'string', 'auto', 'union', 'namespace', 'using', 'template', 'override', 'final', 'val', 'when', 'guard', 'some', 'any', 'unknown', 'never', 'declare', 'keyof', 'satisfies']
const HASH = ['if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'return', 'def', 'class', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue', 'lambda', 'yield', 'async', 'await', 'global', 'nonlocal', 'del', 'assert', 'True', 'False', 'None', 'then', 'fi', 'do', 'done', 'case', 'esac', 'function', 'local', 'export', 'readonly', 'source', 'echo', 'exit', 'set', 'unset', 'shift', 'until', 'begin', 'end', 'module', 'require', 'unless', 'nil', 'self', 'true', 'false', 'null', 'yes', 'no', 'on', 'off']
const SQL = ['select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null', 'as', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'view', 'drop', 'alter', 'add', 'primary', 'key', 'foreign', 'references', 'unique', 'default', 'distinct', 'union', 'all', 'case', 'when', 'then', 'else', 'end', 'begin', 'commit', 'rollback', 'with', 'returning', 'integer', 'text', 'varchar', 'boolean', 'true', 'false', 'local', 'function', 'return', 'if', 'for', 'while', 'do', 'nil', 'repeat', 'until']

const FAMILIES: Record<string, Family> = {
  c: { comment: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, keywords: C_LIKE },
  hash: { comment: String.raw`#[^\n]*`, keywords: HASH },
  sql: { comment: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`, keywords: SQL, caseless: true },
  markup: { comment: String.raw`<!--[\s\S]*?-->`, keywords: [], tags: true },
}
const LANGS: Record<string, keyof typeof FAMILIES> = {}
for (const l of ['js', 'javascript', 'mjs', 'cjs', 'jsx', 'ts', 'typescript', 'tsx', 'json', 'jsonc', 'json5', 'java', 'c', 'h', 'cpp', 'c++', 'cc', 'hpp', 'cs', 'csharp', 'go', 'golang', 'rust', 'rs', 'swift', 'kotlin', 'kt', 'scala', 'dart', 'php', 'css', 'scss', 'less', 'groovy', 'zig']) LANGS[l] = 'c'
for (const l of ['sh', 'bash', 'zsh', 'fish', 'shell', 'console', 'shellsession', 'py', 'python', 'python3', 'rb', 'ruby', 'yaml', 'yml', 'toml', 'ini', 'conf', 'dockerfile', 'docker', 'makefile', 'make', 'perl', 'pl', 'r', 'nix', 'elixir', 'ex', 'exs', 'nim', 'powershell', 'ps1', 'cmake', 'gitignore', 'env', 'dotenv']) LANGS[l] = 'hash'
for (const l of ['sql', 'mysql', 'postgres', 'postgresql', 'sqlite', 'plsql', 'lua', 'haskell', 'hs', 'elm']) LANGS[l] = 'sql'
for (const l of ['html', 'xml', 'svg', 'vue', 'svelte', 'xhtml', 'plist']) LANGS[l] = 'markup'

const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\]|\\[\s\S])*\``
const NUMBER = String.raw`\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`
const WORD = String.raw`[A-Za-z_$][\w$]*`
const TAG = String.raw`<\/?[A-Za-z][\w:-]*|\/?>`

const compiled = new Map<string, { re: RegExp, words: Set<string>, caseless: boolean }>()
function familyOf(lang: string) {
  const name = LANGS[lang.toLowerCase()]
  if (!name) return null
  let c = compiled.get(name)
  if (!c) {
    const f = FAMILIES[name]!
    const parts = [`(${f.comment})`, `(${STRING})`, `(${NUMBER})`, `(${f.tags ? TAG : WORD})`]
    c = { re: new RegExp(parts.join('|'), 'g'), words: new Set(f.caseless ? f.keywords.map(k => k.toLowerCase()) : f.keywords), caseless: Boolean(f.caseless) }
    compiled.set(name, c)
  }
  return c
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]!))
const span = (cls: string, s: string) => `<span class="hl-${cls}">${esc(s)}</span>`

// Above this size a block is only escaped: colouring would cost more than it
// helps, and the view must stay responsive (a file shows up to 256 kB).
export const HIGHLIGHT_MAX = 64 * 1024

export function highlightCode(text: string, lang: string): string {
  const f = text.length > HIGHLIGHT_MAX ? null : familyOf(lang)
  if (!f) return esc(text)
  let out = ''
  let last = 0
  f.re.lastIndex = 0
  for (let m = f.re.exec(text); m; m = f.re.exec(text)) {
    if (!m[0]) { f.re.lastIndex++; continue }
    out += esc(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[1]) out += span('c', m[0])
    else if (m[2]) out += span('s', m[0])
    else if (m[3]) out += span('n', m[0])
    else if (m[0].startsWith('<') || m[0].endsWith('>')) out += span('t', m[0])
    else if (f.words.has(f.caseless ? m[0].toLowerCase() : m[0])) out += span('k', m[0])
    else out += esc(m[0])
  }
  return out + esc(text.slice(last))
}
