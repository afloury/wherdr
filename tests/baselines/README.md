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

The MCP variant added for menu navigation is a neutral reconstruction of a
reported layout. The Codex Usage subtitle variant records
its native recognizer output, with presentation deliberately routed to the live
terminal, just like the original description-free Usage fixture.


## Real Claude Config navigation captures

`claude-config/*.ansi` and the replacement `fixtures/claude-config-list.ansi`
come from Claude Code **2.1.296**, captured on macOS on 2026-10-14 (local time)
using `tmux capture-pane -e -p`, in a private `wherdr-t-config` tmux server and
session, at **80×45** and **120×45**. Claude ran in an empty temporary folder,
with a temporary `CLAUDE_CONFIG_DIR`, `--bare --setting-sources ""`. No prompt
was sent, and no setting was confirmed. Only `/config`, `/usage`, arrows, Tab
and Escape were used after accepting trust for that disposable folder.

The captures preserve panel rows and SGR styling. Output above the panel was
removed; cwd, session name and session UUID were replaced with neutral values.
No credential file was read. Bare mode has no OAuth usage gauges: Usage shows
zero-cost session totals, and Stats has no history. These captures establish
navigation and focus, not authenticated account usage rendering.

`open` is the filter; one Up gives `tabs`, with **the same ❯ row marker**.
Repeated Up on the tabs does not remove it. Down enters the filter, then the
list; `middle`, `bottom` and `bottom-up` record actual list navigation and
scrolling. Tab in the list (`bottom-tab`) leaves it in the list. Up through the
list and filter reaches `bottom-to-tabs`. Disabled rows (`disabled`, captured
in a second disposable session) omit “Enter/Space to change” from the list
legend; they still need Up until the tab-bar legend appears. Horizontal keys on that bar navigate
Status/Config/Usage/Stats; `returned` is Config reached from Status and retains
tab focus. `usage-*-direct` was opened with `/usage` from the idle input.

The fake Herdr serves these ANSI bytes unchanged for
`pane.read { source: 'visible', format: 'ansi' }` and strips SGR for plain reads;
the targeted browser spec asserts this. **This does not establish byte-for-byte
parity with a real Herdr visible ANSI read**: no real Herdr pane was used in this
task. Existing Herdr captures cover its reverse-video and background highlights.


The corrected production `settings-tab` handler was also transpiled and run
against a second live disposable Claude, mapping only its `pane.read` and
`pane.send_input` I/O to tmux capture/send-keys. Fourteen checks passed across
both widths: filter → Usage, Usage → Stats, Stats → Status, Status → Config,
Config → Stats, Stats → Config, and bottom of list → Usage (38 Up keys,
including disabled rows, then one Right). This validates the handler on the
native application while leaving real Herdr transport parity unverified.
