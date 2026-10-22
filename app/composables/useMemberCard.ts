import { type BoardCard, type Member, type MemberStage, memberStage, memberTag } from '#shared/boardLinks'
import { memberGroup } from '~/utils/projectSummary'

function stageLabel(s: MemberStage): string {
  if (s.what === 'attempts') return tl(`${s.n} attempts`, `${s.n} essais`)
  const what = {
    'review': tl('Under review', 'En relecture'),
    'plan-review': tl('Plan review', 'Revue du plan'),
    'pick': tl('Comparing attempts', 'Comparaison des essais'),
    'planning': tl('Planning', 'Plan en cours'),
  }[s.what]
  return s.by ? `${what} · ${s.by}` : what
}
export function memberCard(m: Member): BoardCard | null {
  if (!m.task) return null
  const task = m.task
  const stage = memberStage(m)
  return {
    group: memberGroup(m) || undefined,
    tag: memberTag(m, t('review')),
    stage: stage && ['review', 'plan-review', 'pick'].includes(stage.what) ? stageLabel(stage) : undefined,
    // While a helper works, its tab (the row's pane's) opens, not the one opened last.
    tab: m.focus && m.row.kind === 'space' ? m.row.leadTab.tab.id : undefined,
    name: task.title || undefined,
    progress: task.progress,
    since: task.since,
    msg: task.msg,
    onBoard: () => navigateTo({ path: '/board', query: { machine: m.board || '', task: task.id } }),
  }
}
