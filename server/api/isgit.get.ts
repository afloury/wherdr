export default defineApi(async (event) => {
  const q = getQuery(event)
  const m = machineFor(q.machine)
  const dir = underHome(String(q.path || '') || m.home, m.home)
  if (!dir) return { git: false }
  const [git, kinds] = await Promise.all([isGitRepo(dir, m), projectFolderKinds(m, [dir])])
  // herdr-projects folder: marked in the "Folder" field.
  return { git, ...(kinds[dir] ? { project: kinds[dir] } : {}) }
})
