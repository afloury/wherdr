// Raw input: text + Enter is a message, named keys go to the terminal. Keys
// with a question identity (a "Your turn" card's keyboard) are refused once
// that question has left the screen (see coreNav).
export default defineApi(async (_event, b) => (typeof b.identity === 'string' && !(typeof b.text === 'string' && b.text)
  ? coreNav(coreChooseDeps(), b)
  : coreInput(coreInputDeps(), b)))
