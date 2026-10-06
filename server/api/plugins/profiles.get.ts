// herdr-projects agent profiles of a machine (`?machine=<key>`, empty = local),
// for the coordinator and threads choices of "New project".
import type { ProfileChoices } from '../../../shared/projectsActions'

export default defineApi(async (event): Promise<{ choices: ProfileChoices | null }> => {
  return { choices: await projectProfiles(getQuery(event).machine) }
})
