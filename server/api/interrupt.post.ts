// Stop button of the input field: interrupt the agent (see coreInput.ts).
export default defineApi(async (_event, b) => coreInterrupt(coreInputDeps(), b))
