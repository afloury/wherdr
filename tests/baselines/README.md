# Native screen contract

`native-screens.json` records the complete recognizer and `choicesFor` outputs
captured from main at `a430192`, before removing historical-code execution from
the parity test. `cases` maps `fixture/agent/strict` to an entry in `values`;
identical objects share an entry. The two `push/agent` cases record notification
payloads. The test needs neither Git nor a `.git` directory.

The contract covers every file in `tests/fixtures`, for Claude, Codex and omp,
in both idle and blocked modes. The short exception list in the test applies
only to Codex. Production recognizers and the current production `choicesFor`
run with neutral I/O; transcript completion has separate tests.

When intentionally changing native behaviour, review the affected fixture and
update its expected object. If a shared value must change for only one case,
append the new object to `values` and change only that case's index. New fixtures
need all six cases. Do not replace expectations with the output under test or
weaken assertions just to make a regression pass. No historical SHA needs to
remain reachable after a squash or rebase.

Run `npx vitest run tests/nativeScreenParity.test.ts tests/interactiveReadCost.test.ts`.
The read-cost test replays the current production branch over simulated poll
times and counts actual local Unix-socket calls; it does not load old commits.
