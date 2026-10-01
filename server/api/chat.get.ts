export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  // Machine distante injoignable : ses transcriptions aussi (lues par SSH).
  const m = machineOfPane(p.id)
  if (m && !m.local && m.status !== 'online') throw new HerdrError('unreachable', `${m.label} injoignable`)
  const num = (k: string) => (q[k] !== undefined ? Math.max(0, Number(q[k]) || 0) : null)
  const r = await transcripts.chat(p, {
    since: String(q.since || ''),
    from: num('from'), // re-read from this byte (bottom of the conversation already shown)
    before: num('before'), // older slice, ending at this byte
  })
  // Current model ("Opus 5.5", "GPT-6-Sol"): cached by file size.
  return r.available ? { ...r, model: await currentModel(p).catch(() => null) } : r
})
