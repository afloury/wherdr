// Dépôt proposé pour « New project » : racine Git du dossier du space, sous le
// HOME de la machine (jamais le HOME lui-même), sinon null.
import { gitToplevel } from '../utils/changes'
import { proposedRepo } from '../../shared/projectsActions'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const m = machineFor(q.machine)
  const dir = underHome(String(q.path || ''), m.home)
  return { root: (dir && proposedRepo(await gitToplevel(m, dir), m.home)) || null }
})
