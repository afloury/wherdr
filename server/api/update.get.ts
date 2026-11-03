// Is a new wherdr version available? (see utils/updates.ts) The Update
// button shows whenever this installation can update itself (update.post.ts).
// With herdr-core the route is read-only (shared/coreRoutes/a.ts): no button.
export default defineApi(async () => {
  const info = await checkUpdate()
  return process.env.WHERDR_BACKEND === 'core' ? { ...info, oneTap: false } : info
})
