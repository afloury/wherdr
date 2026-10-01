// Runs a Herdr plugin action: { plugin, action, pane_id } (an agent's
// menu) or { plugin, action, machine } (the machine's menu).
export default defineApi((_event, b) => invokePluginAction(b))
