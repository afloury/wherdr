// Save the OpenRouter key on this server (DATA_DIR/openrouter.json, 0600).
export default defineApi((_event, b) => dictation.saveKey(b?.key))
