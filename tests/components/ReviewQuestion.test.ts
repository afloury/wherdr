// WHR-306: an agent's question in Tasks to review: its summary, its whole
// message folded and drawn as in the chat (never cut), its choices as buttons
// and another answer; each sends the text.
import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ReviewQuestion from '~/components/ReviewQuestion.vue'
import type { Card } from '#shared/pm/board'

const full = `${'Some context. '.repeat(60)}\n\nShould I go on with \`npm test\`?\n\n\`\`\`wherdr\nchoices "Docker started, go on" | "Write it without testing" | "Stop here"\n\`\`\`\n`
const card = { id: 'HO-1', asks: { kind: 'question', text: '…go on with npm test?', full, tldr: 'The agent needs Docker running to test.' } } as Card

it('sends a choice or another answer; the whole question renders as Markdown, folded under the summary', async () => {
  const w = await mountSuspended(ReviewQuestion, { props: { card, busy: false } })
  expect(w.find('[data-testid="review-question-tldr"]').text()).toBe('The agent needs Docker running to test.')
  const folded = w.find('[data-testid="review-question-full"]')
  expect(folded.attributes('open')).toBeUndefined()
  expect(folded.text().startsWith('Full questionSome context.')).toBe(true) // its start kept
  expect(folded.find('code').text()).toBe('npm test')
  expect(folded.text()).not.toContain('choices "')
  const buttons = w.findAll('[data-testid="review-choice"]')
  expect(buttons.map(b => b.text())).toEqual(['Docker started, go on', 'Write it without testing', 'Stop here'])
  await buttons[2]!.trigger('click')
  await w.find('[data-testid="review-other"] textarea').setValue('  Use the CI instead  ')
  await w.find('[data-testid="review-other"]').trigger('submit')
  expect(w.emitted('send')).toEqual([['Stop here'], ['Use the CI instead']])
  // No summary (held by the pace): the whole question shows open, alone.
  await w.setProps({ card: { ...card, asks: { ...card.asks!, tldr: undefined } } })
  expect([w.find('[data-testid="review-question-tldr"]').exists(), w.find('[data-testid="review-question-full"]').attributes('open')]).toEqual([false, ''])
})
