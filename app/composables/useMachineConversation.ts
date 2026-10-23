import { conversationIn, machineConversation, readConversationMemory, type Conversation } from '~/utils/machineConversation'

// Device-local history, deliberately outside synced settings. Drafts stay owned
// by useDraft: switching the route follows the ordinary conversation lifecycle.
export function useMachineConversation() {
  const route = useRoute()
  let memory = readConversationMemory(null)
  try { memory = readConversationMemory(localStorage.getItem('machineConversations')) } catch { /* storage unavailable */ }
  const viewed = (): Conversation | null => route.path.startsWith('/a/') ? { pane: String(route.params.pane) }
    : route.path.startsWith('/t/') ? { tab: String(route.params.tab) } : null
  function remember() {
    const view = viewed()
    const pick = machineBarPick.value
    if (pick === null || !view || !conversationIn(herdrState.value, view, pick, machineGroups.value)) return
    if (Object.hasOwn(memory, pick) && JSON.stringify(memory[pick]) === JSON.stringify(view)) return
    memory = { ...memory, [pick]: view }
    try { localStorage.setItem('machineConversations', JSON.stringify(memory)) } catch { /* storage unavailable */ }
  }
  let reopen = false
  function open(destination: Conversation | null | undefined) {
    if (destination === undefined) return
    const path = destination === null ? '/' : 'pane' in destination ? panePath(destination.pane) : tabTarget(destination.tab)
    void navigateTo(path, { replace: true })
  }
  watch([() => route.fullPath, herdrState], () => {
    if (reopen && viewed() && herdrState.value.ok) {
      reopen = false
      const destination = machineConversation(herdrState.value, machineBarPick.value, machineGroups.value, memory, viewed(), boardLinksNow())
      if (destination !== undefined) { open(destination); return }
    }
    remember()
  }, { immediate: true })
  return () => {
    const destination = machineConversation(herdrState.value, machineBarPick.value, machineGroups.value, memory, viewed(), boardLinksNow())
    // Phones keep the list first; validate the destination when a conversation
    // is reopened (including browser history pointing outside the new filter).
    if (desk.value) open(destination)
    else reopen = true
    remember()
  }
}
