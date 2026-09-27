// Lance une action de plugin Herdr : { plugin, action, pane_id } (menu d'un
// agent) ou { plugin, action, machine } (menu de la machine).
export default defineApi((_event, b) => invokePluginAction(b))
