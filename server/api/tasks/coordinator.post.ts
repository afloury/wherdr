// A message to a machine's coordinator: `{ machine, text, to?, delegate? }`
// (`herdr-projects coordinator [--machine | --project=REPO] tell [--delegate]`).
// `to`: `{ kind: 'main' | 'machine' }` or `{ kind: 'project', repo }`.
// `{ machine, to, restart: true }`: Try again after a failed start
// (`coordinator … restart`), with nothing said.
import { restartCoordinator, tellCoordinator } from '../../utils/projectsTasks'

export default defineApi((_event, b) => (b.restart === true
  ? restartCoordinator(b.machine ?? '', b.to)
  : tellCoordinator(b.machine ?? '', b.text, { to: b.to, delegate: b.delegate, start: b.start })))
