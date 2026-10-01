// Choose an option of a blocking prompt. The screen is re-read just before:
// if the question changed since it was shown on the phone, we refuse
// rather than confirm the wrong thing.
// Free answer (`free` option: omp's "Other", Claude's "Type something."): always with its text, and the
// question shown (the option's label is the same for every question).
export default defineApi(async (event, b) => {
  if (!PANE_RE.test(b.pane_id || '')) throw new HerdrError('bad_pane', 'Invalid pane')
  const r = await herdr('pane.read', { pane_id: b.pane_id, source: 'detection' }, 4000)
  const text = r.read && r.read.text
  const pane = findPane(b.pane_id)
  const asked = pane && pane.agent === 'claude' ? await transcripts.pendingClaudeQuestions(pane).catch(() => []) : []
  const choices = screenChoices(text, pane?.agent, asked)
  const i = Number(b.index)
  const option = choices && choices.options[i]
  const answer = typeof b.text === 'string' ? b.text.trim() : ''
  if (!choices || !option || option.label !== b.label || (answer && !option.free)
    || (option.free && !sameQuestion(choices.question, typeof b.question === 'string' ? b.question : null))) {
    throw new HerdrError('stale', 'The question has changed — check the current screen.')
  }
  if (option.free && !answer) throw new HerdrError('bad_text', 'Write your answer before sending it.')
  try {
    if (option.free) await answerFree({ call: herdr, sleep, now: Date.now }, b.pane_id, choices, i, answer, pane?.agent)
    else await herdr('pane.send_input', { pane_id: b.pane_id, keys: keysFor(choices, i) })
  } finally {
    choicesCache.delete(b.pane_id)
    setTimeout(poll, 300)
  }
  return { ok: true }
})
