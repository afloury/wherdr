// "Reveal in Finder" / "Open" for a path written in a conversation, on the
// agent's machine (see server/utils/reveal.ts).
import { revealPath } from '../utils/reveal'

export default defineApi((event, b) => revealPath(b))
