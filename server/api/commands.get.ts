// "/" commands of a pane's agent (built-in + the machine's skills and
// commands), for the input field suggestions.
export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  const m = machineOfPane(p.id)
  if (!p.agent || !m || !m.home) return { commands: [] }
  // Remote machine unreachable: built-in commands only (no cache).
  if (!m.local && m.status !== 'online') return { commands: builtinCommands(p.agent), partial: true }
  try {
    return { commands: await slashCommands({ key: m.key, fs: m.fs, exec: m.exec, home: m.home, kind: p.agent, cwd: p.cwd }) }
  } catch (e) {
    // Skills and commands unreadable this time: the built-in ones still show,
    // the next "/" asks again.
    log(`commands ${p.id}: ${(e as Error).message}`)
    return { commands: builtinCommands(p.agent), partial: true }
  }
})
