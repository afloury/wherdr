// ?task=&phase=before|after, the image as the body: a screenshot the agent
// gives as its current step's evidence.
import { SHOT_MAX_BYTES } from '../../../shared/pm/shots'
import { uploadShot } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (event, b) => {
  const q = getQuery(event)
  return { shot: await uploadShot(pmStore(), q.task, q.phase, b.data, b.ctype) }
}, { raw: /^image\/(png|jpeg|webp)$/, max: SHOT_MAX_BYTES, tooLarge: 'Image too large (10 MB max)' })
