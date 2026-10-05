// Scripts of the live demos next to the Features stories on /preview, each
// showing what its text says. Data is made up and neutral.
import type { DemoScript } from './demoScript'

/* -------------------------------------------------- 1.1 Conversation · terminal
   The grouped tool calls unfold, the effort picker switches medium → high,
   the proposed command is copied then run: the view flips to the live
   terminal, the tests run, and it comes back to the conversation. */
export const CONVERSATION: DemoScript = {
  id: 'conversation',
  // 1 group open · 2 effort menu · 3 high · 4 menu closed · 5 copied · 6 run
  // · 7 terminal + typing · 8 test lines · 9 summary · 10 back to the conversation
  timeline: [[1100, 1], [2500, 2], [3300, 3], [4000, 4], [5000, 5], [6300, 6], [6900, 7], [8000, 8], [9000, 9], [11200, 10]],
  loop: 13500,
  final: 5,
  typing: { step: 7, text: 'npm test', ms: 600 },
}
/** Claude's calls, with the app's labels and icons (ChatView.vue TOOL_LABEL / TOOL_ICON); more than three are grouped. */
export const CONVERSATION_TOOLS = [
  { icon: 'i-lucide-file-text', tool: 'Read', arg: 'package.json' },
  { icon: 'i-lucide-file-plus', tool: 'Write', arg: '~/projects/web-shop/src/cart.js' },
  { icon: 'i-lucide-file-plus', tool: 'Write', arg: '~/projects/web-shop/src/cart.test.js' },
  { icon: 'i-lucide-terminal', tool: 'Command', arg: 'Run the cart tests' },
] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export const TEST_OUTPUT = [
  'ok 1 - addToCart adds an item to the cart',
  'ok 2 - removeFromCart removes an item by id',
  'ok 3 - cartTotal sums price times quantity',
] as const

/* ------------------------------------------------------- 1.2 Phone · notifications
   An agent needs you: a push lands on the lock screen with the question and
   its options; on the agent list, the answer is one tap on the card, and the
   agent goes back to work, then is done (second push). */
export const PHONE: DemoScript = {
  id: 'phone',
  // 1 your turn + push · 2 option tapped · 3 sent, working · 4 action · 5 done + push
  timeline: [[1200, 1], [3800, 2], [4400, 3], [5600, 4], [7600, 5]],
  loop: 10500,
  final: 3,
}

/* -------------------------------------------------------------- 1.3 herdr-projects
   A thread reports progress, becomes ready for review; the coordinator merges
   it and the task moves to "To test"; the user answers a "To decide" question
   from the board: its Reply button fills the field with the decision prefix
   (the app's decisionPrefix), the user types the answer and sends it. */
export const DECISION = 'Should coupons stack with sale prices?'
/** What the board's Reply button puts in the field (shared/projectBoard.ts decisionPrefix). */
export const DECISION_PREFIX = `↳ Decision: ${DECISION} — `
export const DECISION_ANSWER = 'No, the best price wins.'

export const PROJECT: DemoScript = {
  id: 'project',
  // 1 progress 80 % · 2 ready for review · 3 coordinator merges · 4 moved to To test
  // · 5 Reply pressed (prefix in the field) · 6 answer typed · 7 sent · 8 coordinator answers
  timeline: [[1000, 1], [2200, 2], [3300, 3], [4700, 4], [6000, 5], [6500, 6], [8300, 7], [9700, 8]],
  loop: 13000,
  final: 8,
  typing: { step: 6, text: DECISION_ANSWER, ms: 1000 },
}

export type BoardItem = { title: string, note?: string, state?: 'ready' | 'work', fresh?: boolean }
export type Board = { test: BoardItem[], decide: BoardItem[], progress: BoardItem[], backlog: BoardItem[] }

/** The project's TASKS.md board at a step of PROJECT. */
export function boardAt(step: number): Board {
  const coupon: BoardItem = step >= 2
    ? { title: 'Coupon codes', note: 'T-0001 · 100 % · just now', state: 'ready' }
    : { title: 'Coupon codes', note: step >= 1 ? 'T-0001 · 80 % · Running tests · now' : 'T-0001 · 60 % · Testing changes · 1 min ago', state: 'work' }
  return {
    test: [
      { title: 'Free shipping banner on the cart page' },
      ...(step >= 4 ? [{ title: 'Coupon codes', fresh: true }] : []),
    ],
    decide: step >= 7 ? [] : [{ title: DECISION }],
    progress: [
      { title: 'Guest checkout', note: 'T-0002 · 40 % · Writing the form · 2 min ago', state: 'work' },
      ...(step >= 4 ? [] : [coupon]),
    ],
    backlog: [{ title: 'Save the cart between visits' }, { title: 'Gift cards' }],
  }
}
