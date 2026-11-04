// { template }: saves a workflow template (shared/pm/workflow.ts), checked first.
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (_event, body) => ({ template: await pmStore().saveTemplate(body.template) }))
