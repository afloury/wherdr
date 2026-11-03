// "Keep after restart" of a terminal.
export default defineApi(async event => coreKeepGet(coreInputDeps(), String(getQuery(event).pane || '')))
