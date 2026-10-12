// Report of a herdr-projects thread (Markdown sheet, ThreadReportSheet.vue) and
// opening a thread from the Project panel or the Board. Module level: one sheet
// for the whole app.
import type { Pane } from '#shared/types'
import type { ProjectThread } from '#shared/projectBoard'
import { threadPanesOf } from '#shared/globalBoard'
import { md } from '~/utils/markdown'

// `coordinator`: the pane the report was read from; its thread's live pane is
// looked up while the sheet is open (it may start or close meanwhile).
export interface OpenReport { thread: ProjectThread, html: string, truncated: boolean, coordinator: string }

export const threadReport = ref<OpenReport | null>(null)
export const threadReportOpen = ref(false)
// Thread id being read.
export const threadReportLoading = ref<string | null>(null)

// The coordinator's machine decides between same-named panes of several machines.
export function threadLivePane(coordinator: Pane, slug: string, thread: ProjectThread): Pane | undefined {
  return threadPanesOf(thread, slug, herdrState.value.panes, coordinator.machine || '')[0]
}

let reading = 0
export async function openThreadReport(coordinatorPaneId: string, thread: ProjectThread) {
  if (!thread.report) return toast(t('No report for this thread'), true)
  const id = ++reading
  threadReportLoading.value = thread.id
  try {
    const r = await fetchThreadReport(coordinatorPaneId, thread.id)
    // Another report asked for meanwhile: that one wins.
    if (id !== reading) return
    threadReport.value = { thread, html: md(r.text), truncated: r.truncated, coordinator: coordinatorPaneId }
    threadReportOpen.value = true
    haptic()
  } catch (e) { if (id === reading) toast((e as Error).message, true) }
  finally { if (id === reading) threadReportLoading.value = null }
}

// Its live agent, otherwise its report, otherwise a message.
export function openThread(coordinator: Pane, slug: string, thread: ProjectThread) {
  const pane = threadLivePane(coordinator, slug, thread)
  if (pane) {
    haptic()
    navigateTo(panePath(pane.id))
  } else if (thread.report) void openThreadReport(coordinator.id, thread)
  else toast(t('This thread’s agent was not found'), true)
}
