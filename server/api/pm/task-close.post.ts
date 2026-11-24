// { id }: the user marks the task done where it stands (the task sheet's and the session pill's Mark done): no step's action runs.
import { userClose } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'
import { publicTask } from '../../../shared/pm/run'

export default defineApi(async (_event, body) => ({ task: publicTask(await userClose(pmStore(), body.id)) }))
