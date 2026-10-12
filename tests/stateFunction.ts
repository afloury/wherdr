// Execute a selected production function with explicit I/O bindings. This lets
// parity tests compare the actual historical server pipeline without starting
// a second poller or importing machine/user configuration.
import ts from 'typescript'

export function sourceFunction(source: string, name: string): string {
  const file = ts.createSourceFile('state.ts', source, ts.ScriptTarget.Latest, true)
  const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  if (!fn) throw new Error(`Missing production function ${name}`)
  return fn.getText(file)
}

export function bindFunction(source: string, name: string, bindings: Record<string, unknown>) {
  const js = ts.transpileModule(sourceFunction(source, name), { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
  return new Function(...Object.keys(bindings), `${js}\nreturn ${name}`)(...Object.values(bindings))
}

// Bind both layers of the production display-read coalescer; historical sources
// without it remain usable for before/after probes.
export function bindChoices(source: string, bindings: Record<string, unknown>) {
  if (!source.includes('async function readChoices(')) return bindFunction(source, 'choicesFor', bindings)
  return bindFunction(source, 'choicesFor', { ...bindings, choicesPending: new Map(), readChoices: bindFunction(source, 'readChoices', bindings) })
}
