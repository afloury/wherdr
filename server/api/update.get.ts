// Is a new wherdr version available? (see utils/updates.ts)
export default defineApi(async () => {
  const info = await checkUpdate()
  return process.env.WHERDR_BACKEND === 'core' ? { ...info, oneTap: false } : info
})
