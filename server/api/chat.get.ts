import { fmt } from '../../shared/message'
export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  // Machine distante injoignable : ses transcriptions aussi (lues par SSH).
  const m = machineOfPane(p.id)
  if (m && !m.local && m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  const num = (k: string) => (q[k] !== undefined ? Math.max(0, Number(q[k]) || 0) : null)
  // Messages taken back after a Stop (see interruptRestore.ts): hidden, and
  // part of the token so that the view reloads when one is added.
  const { hidden, seq } = takenBackOf(p.id)
  const mark = hidden.length ? `~${seq}` : ''
  const since = String(q.since || '')
  const r = await transcripts.chat(p, {
    since: mark ? (since.endsWith(mark) ? since.slice(0, -mark.length) : '') : since,
    from: num('from'), // re-read from this byte (bottom of the conversation already shown)
    before: num('before'), // older slice, ending at this byte
  })
  if (r.token) r.token += mark
  if (r.items) r.items = withoutTakenBack(r.items, hidden)
  if (r.queue && r.queue.length) r.queue = withSentText(p.id, r.queue)
  // Current model ("Opus 5.5", "GPT-6-Sol"): cached by file size.
  return r.available ? { ...r, model: await currentModel(p).catch(() => null) } : r
})
