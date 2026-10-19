// A message to a machine's coordinator: `{ machine, text, to?, delegate? }`
// (`herdr-projects coordinator [--machine | --project=REPO] tell [--delegate]`).
// `to`: `{ kind: 'main' | 'machine' }` or `{ kind: 'project', repo }`.
import { tellCoordinator } from '../../utils/projectsTasks'

export default defineApi((_event, b) => tellCoordinator(b.machine ?? '', b.text, { to: b.to, delegate: b.delegate }))
