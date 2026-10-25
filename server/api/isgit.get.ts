export default defineApi(async (event) => {
  const q = getQuery(event)
  const m = machineFor(q.machine)
  const dir = underHome(String(q.path || '') || m.home, m.home)
  if (!dir) return { git: false }
  return { git: await isGitRepo(dir, m) }
})
