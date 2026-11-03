// Conversations of the core-* question specs: the same texts as the omp panes of the v2
// scenario (scenario.mjs), here as Claude Code turns for tests/e2e/fake-core.ts.
import type { Turn } from './fake-core'

export const QUESTIONS: Turn[] = [
  ['user', 'Plan the release.'],
  ['assistant', [
    '## What is left? A summary',
    'I added the task to the queue, to be confirmed. Shall I start step 1 now? A slot is free on the server.',
    'Shall I tag the release today? The build is green. Or do you want a review first? Both are fine with me.',
    'You asked "can it be faster?" earlier. The page is at https://example.com/search?x=1 and `ready ? 1 : 0` stays as it is.',
  ].join('\n\n')],
  ['user', 'Et en français ?'],
  ['assistant', [
    'J’ai noté la tâche dans « En file », à valider. Je lance l’étape 1 maintenant ? Une place est libre sur le serveur.',
    'Tu as demandé « on peut aller plus vite ? » hier. C’est fait.',
    'Dernier point : je publie les notes de version ?',
  ].join('\n\n')],
  ['user', 'Anything to note?'],
  ['assistant', [
    'Three things to note:',
    '- The cache is cleared on every deploy.\n- The export keeps its old column order.\n- The limits come from `req.plan.limits`.',
    'All 48 tests pass. Shall I merge the branch now?',
  ].join('\n\n')],
]

// A decision table to answer row by row; the table of threads above it and the
// numbered table of files below it are not ones.
export const DECISIONS: Turn[] = [
  ['user', 'What do you need from me?'],
  ['assistant', [
    'Two threads are done:',
    '| Thread | State |\n| --- | --- |\n| t-0001 | merged |\n| t-0002 | in review |',
    'Four decisions are waiting for you:',
    '| # | Question | My advice |\n| --- | --- | --- |\n| 1 | Tag the release **today**? | Yes |\n| 2 | Keep the old export format for one more version? | No |\n| 3 | Publish the release notes on the site? | Yes |\n| 4 | Which name for the new theme? | Titanium |',
    'The build output, for reference:',
    '| # | File | Size |\n| --- | --- | --- |\n| 1 | main.css | 120 kB |\n| 2 | app.js | 300 kB |',
    'Shall I start the next thread meanwhile?',
  ].join('\n\n')],
]

export const FOLLOWUP_REPLY = 'Noted. Shall I go on with the next step?'
export const FOLLOWUP: Turn[] = [
  ['user', 'Review the plan.'],
  ['assistant', 'An earlier point. Was the first draft fine?'],
  ['user', 'Go on.'],
  ['assistant', 'The plan has two open points. Shall I rename the module? It is a small change.\n\nWhich name do you prefer?'],
]
