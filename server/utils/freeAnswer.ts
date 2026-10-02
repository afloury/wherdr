// Free answer to omp's "Ask" box ("Other (type your own)" option).
// Observed (omp 18.4, Herdr test session):
// - Enter on the option (Space on checkboxes) replaces the box with a text
//   field (see parseOmpField), prefilled if the option already has a text;
// - in that field, Enter submits: a "\n" typed as text would submit in the
//   middle of the answer, a new line is typed with Shift+Enter;
// - Ctrl+K then Ctrl+U delete the rest then the start of the line, and merge
//   with the neighbouring line at a line end: repeated, they empty the field
//   wherever the cursor is.
// Nothing is typed until the open field is seen empty on screen. One answer at
// a time per pane: a second one would empty the field while the first types.
import type { Choices } from '../../shared/types'
import { keysFor, parseChoices, parseOmpField } from './choices'
import { HerdrError } from './herdr'
import type { RestartDeps } from './restartSeq'

const OPEN_MS = 3000
const answering = new Set<string>()

export async function answerFree(d: RestartDeps, paneId: string, choices: Choices, index: number, answer: string, agent?: string | null): Promise<void> {
  if (answering.has(paneId)) throw new HerdrError('busy', 'An answer is already being sent.')
  answering.add(paneId)
  try {
    if (agent === 'claude') await typeClaudeAnswer(d, paneId, choices, index, answer)
    else await typeAnswer(d, paneId, choices, index, answer)
  } finally {
    answering.delete(paneId)
  }
}

async function typeAnswer(d: RestartDeps, paneId: string, choices: Choices, index: number, answer: string) {
  const keys = (k: string[]) => d.call('pane.send_input', { pane_id: paneId, keys: k })
  const field = async () => parseOmpField((await d.call('pane.read', { pane_id: paneId, source: 'detection' }, 4000))?.read?.text)
  if (!choices.typing) await keys(keysFor(choices, index))
  let f = await field()
  for (const end = d.now() + OPEN_MS; !f && d.now() < end;) {
    await d.sleep(100)
    f = await field()
  }
  for (let round = 0; f && f.value; round++) {
    if (round === 3) throw new HerdrError('stale', 'omp’s answer field could not be cleared — check the current screen.')
    await keys(Array.from({ length: f.rows + 1 }, () => ['ctrl+k', 'ctrl+u']).flat())
    await d.sleep(150)
    f = await field()
  }
  if (!f) throw new HerdrError('stale', 'omp’s answer field did not open — check the current screen.')
  // ANSI sequences (a pasted coloured log) and other control characters would
  // act on the field or the box (Escape closes it); Tab starts completion there.
  const lines = answer.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').split(/\r\n|[\r\n\u2028\u2029]/)
  // Field closed in the meantime (question timeout, Escape in the terminal): the
  // rest would go to omp's main input, and Enter would send it as a message.
  const closed = new HerdrError('stale', 'omp’s answer field closed — answer not submitted, check the current screen.')
  for (let i = 0; i < lines.length; i++) {
    if (i) {
      if (!(await field())) throw closed
      await keys(['shift+enter'])
    }
    if (lines[i]) await d.call('pane.send_input', { pane_id: paneId, text: lines[i] })
  }
  // Enter only once the text shows in the field.
  f = await field()
  for (const end = d.now() + OPEN_MS; f && !f.value && d.now() < end;) {
    await d.sleep(100)
    f = await field()
  }
  if (!f || !f.value) throw closed
  await keys(['enter'])
}

// Claude's AskUserQuestion: "Type something." is typed in place, as soon as
// the cursor is on it (observed with Claude Code 2.1, Herdr test session):
// the text replaces the option's label, Ctrl+U empties it, Enter submits it.
// One line only: the answer's line breaks become spaces.
// Among checkboxes, typing ticks the box and Enter would untick it: the text
// stays there, ticked, until Submit.
const squash = (s: string) => s.replace(/\s+/g, '')
async function typeClaudeAnswer(d: RestartDeps, paneId: string, choices: Choices, index: number, answer: string) {
  const keys = (k: string[]) => d.call('pane.send_input', { pane_id: paneId, keys: k })
  // The free option under the cursor, re-read: its text (null: another option, or the box closed).
  const field = async () => {
    const c = parseChoices((await d.call('pane.read', { pane_id: paneId, source: 'detection' }, 4000))?.read?.text)
    const o = c && c.options[c.cursor]
    return o && o.free ? { value: o.hint || '', checked: o.checked } : null
  }
  const moves = keysFor(choices, index).slice(0, -1)
  if (moves.length) await keys(moves)
  let f = await field()
  for (const end = d.now() + OPEN_MS; !f && d.now() < end;) {
    await d.sleep(100)
    f = await field()
  }
  if (!f) throw new HerdrError('stale', 'Claude’s answer field could not be reached — check the current screen.')
  if (f.value) {
    await keys(['ctrl+u'])
    await d.sleep(150)
    f = await field()
    if (!f || f.value) throw new HerdrError('stale', 'Claude’s answer field could not be cleared — check the current screen.')
  }
  const text = answer.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  await d.call('pane.send_input', { pane_id: paneId, text })
  // Enter only once the text shows in place of the label (its start: a long
  // one wraps).
  const want = squash(text).slice(0, 24)
  f = await field()
  for (const end = d.now() + OPEN_MS; f && !squash(f.value).startsWith(want) && d.now() < end;) {
    await d.sleep(100)
    f = await field()
  }
  if (!f || !squash(f.value).startsWith(want)) throw new HerdrError('stale', 'Claude’s answer field closed — answer not submitted, check the current screen.')
  if (f.checked === undefined || f.checked === false) await keys(['enter'])
}
