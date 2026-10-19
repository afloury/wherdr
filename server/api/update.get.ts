// Is a new wherdr version available? (see utils/updates.ts) The Update
// button shows whenever this installation can update itself (update.post.ts).
export default defineApi(async () => checkUpdate())
