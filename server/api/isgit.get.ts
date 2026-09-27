export default defineApi(async (event) => {
  const q = getQuery(event)
  const m = machineFor(q.machine)
  const dir = underHome(String(q.path || '') || m.home, m.home)
  return { git: Boolean(dir && (await isGitRepo(dir, m))) }
})
