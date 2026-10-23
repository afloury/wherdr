import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { bindFunction } from './stateFunction'

const source = readFileSync('server/utils/state.ts', 'utf8')
function delivery(allowed: (event: string) => Promise<boolean>) {
  const pane = { id: 'w1:p1', workspace: 'w1', agent: 'claude', status: 'done', title: 'Example' }
  const pushSend = vi.fn(async () => 1)
  const preview = vi.fn(async () => 'Example reply')
  const notify = bindFunction(source, 'notifyPane', {
    notificationAllowed: allowed, state: { workspaces: [], panes: [pane] }, notificationTitle: (s: string) => s,
    multiMachine: () => false, machineOfPane: () => null, getMachine: () => null, agentLabel: () => 'Claude',
    agentNotificationTitle: (event: string) => ({ title: event }), transcripts: { preview }, pushSend, log: () => {},
  })
  return { pane, notify, pushSend, preview }
}
it('checks visibility again after reading the final answer, before delivery', async () => {
  const allowed = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  const d = delivery(allowed)
  await d.notify(d.pane)
  expect(d.preview).toHaveBeenCalled()
  expect(d.pushSend).not.toHaveBeenCalled()
})
it('does not send disabled state events', async () => {
  const d = delivery(async () => false)
  await d.notify(d.pane)
  expect(d.pushSend).not.toHaveBeenCalled()
})
it('coalesces a final message into the enabled finished notification', async () => {
  const d = delivery(async () => true)
  await d.notify(d.pane, 'message')
  expect(d.pushSend).not.toHaveBeenCalled()
  await d.notify(d.pane)
  expect(d.pushSend).toHaveBeenCalledTimes(1)
})
it('delivers a new message independently when finished is disabled', async () => {
  const d = delivery(async event => event === 'message')
  await d.notify(d.pane, 'message')
  expect(d.pushSend).toHaveBeenCalledWith(expect.objectContaining({ title: 'Claude · New message', body: expect.stringContaining('Example reply') }), expect.any(Function))
})
it('notifies a new first reply after an empty baseline, without replaying initial history', async () => {
  const pane = { id: 'w1:p1', agentSession: 'example', status: 'working' }
  const previews = new Map()
  const notifyPane = vi.fn(async () => {})
  let reply: { key: string, text: string } | null = null
  const refresh = bindFunction(source, 'refreshPreview', {
    previews, previewBusy: new Set(), trFor: () => ({ latestReply: async () => reply }), findPane: () => pane, notifyPane, log: () => {},
  })
  refresh(pane)
  await vi.waitFor(() => expect(previews.has(pane.id)).toBe(true))
  reply = { key: 'new-reply', text: 'Example answer' }
  refresh(pane)
  await vi.waitFor(() => expect(notifyPane).toHaveBeenCalledTimes(1))
  refresh(pane)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(notifyPane).toHaveBeenCalledTimes(1)
})
