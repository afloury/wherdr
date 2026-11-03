// Is a new wherdr version available? (see utils/updates.ts) No one-tap update with herdr-core.
export default defineApi(async () => ({ ...await checkUpdate(), oneTap: false }))
