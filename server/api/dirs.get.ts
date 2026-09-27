export default defineApi((event) => {
  const q = getQuery(event)
  return listDirs(String(q.path || '') || null, String(q.machine || ''))
})
