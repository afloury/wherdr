// Scripts of the live demos next to the Features stories, each
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
   The Board of herdr-projects 1.x: a task's agent finishes, its pull request
   passes review and the card moves to Ready to approve; the user opens the
   card, approves it, and the task moves to Done. Then the Coordinator, opened
   from the Board, turns a message into a new task, which starts. */
export const COORD_ASK = 'Add gift cards to the checkout.'

export const BOARD: DemoScript = {
  id: 'board',
  // 1 progress 90 % · 2 ready to approve · 3 card opened (its sheet) · 4 Approve
  // pressed, confirmation · 5 Approve and merge pressed · 6 merged, in Done
  // · 7 Coordinator opened · 8 message typed · 9 sent · 10 the coordinator
  // answers, new task in To do · 11 its agent starts, in Working
  timeline: [[1000, 1], [2200, 2], [3300, 3], [4300, 4], [5300, 5], [5900, 6], [7300, 7], [7900, 8], [9400, 9], [10500, 10], [12000, 11]],
  loop: 15000,
  final: 6,
  typing: { step: 8, text: COORD_ASK, ms: 1200 },
}

/** The Board's five groups, with the app's keys (shared/projectsTasks.ts TaskGroup). */
export type BoardGroup = 'needs' | 'ready' | 'working' | 'todo' | 'done'
export const BOARD_GROUPS: readonly { id: BoardGroup, label: string }[] = [
  { id: 'needs', label: 'Needs you' },
  { id: 'ready', label: 'Ready to approve' },
  { id: 'working', label: 'Working' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Done' },
]
/** A card (app/components/TaskCard.vue): key, title, the line its agent reports, chips. */
export type BoardCard = {
  key: string
  title: string
  msg?: string
  app?: string
  progress?: number
  pr?: string
  review?: 'pass' | 'fail'
  /** Just moved here: drawn with the app's highlight. */
  fresh?: boolean
}
export type Board = Record<BoardGroup, BoardCard[]>

/** The task approved in the demo. */
export const COUPONS = { key: 'SHOP-12', title: 'Coupon codes at checkout', branch: 'shop-12-coupon-codes', pr: '#42' } as const

/** The Board at a step of BOARD. */
export function boardAt(step: number): Board {
  const coupons: BoardCard = { key: COUPONS.key, title: COUPONS.title, app: 'codex' }
  const gift: BoardCard = { key: 'SHOP-16', title: 'Gift cards at checkout', app: 'claude' }
  return {
    needs: [{ key: 'SHOP-14', title: 'Guest checkout', msg: 'Asks: keep the cart after sign-in?', app: 'claude', progress: 40 }],
    ready: step >= 2 && step < 6 ? [{ ...coupons, msg: 'Ready for review', pr: COUPONS.pr, review: 'pass', fresh: step === 2 }] : [],
    working: [
      ...(step >= 11 ? [{ ...gift, msg: 'Reading the checkout code', progress: 5, fresh: true }] : []),
      ...(step < 2 ? [{ ...coupons, msg: step >= 1 ? 'Opening the pull request' : 'Running the tests', progress: step >= 1 ? 90 : 75 }] : []),
      { key: 'SHOP-15', title: 'Save the cart between visits', msg: 'Writing the storage layer', app: 'omp', progress: 30 },
    ],
    todo: [
      ...(step === 10 ? [{ ...gift, fresh: true }] : []),
      { key: 'SHOP-17', title: 'Order history page' },
    ],
    done: [
      ...(step >= 6 ? [{ ...coupons, msg: 'Merged', pr: COUPONS.pr, fresh: step === 6 }] : []),
      { key: 'SHOP-9', title: 'Free shipping banner', msg: 'Merged', pr: '#38' },
    ],
  }
}
