// { project, id, accept }: the user's answer to an automation the coordinator or Alfred proposed.
import { answerAutomationProposal } from '../../utils/pmAutomations'
import { pmStore } from '../../utils/pmStore'

export default defineApi((_event, body) =>
  answerAutomationProposal({ store: pmStore() }, String(body.project ?? ''), String(body.id ?? ''), body.accept === true))
