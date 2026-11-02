# herdr-core inventory

Run wherdr with `WHERDR_BACKEND=core` (at build and server startup) and
`HC_SOCKET` pointing to the socket of the desired hc session. Obtain the endpoint
from your hc configuration; wherdr requires an explicit endpoint and never starts
or installs core. This avoids accidentally selecting an inherited agent session.
The browser cannot choose the endpoint or issue arbitrary RPC calls.

Core mode uses the existing v2 home, workspace cards, tabs and agent screen.
A core poller reads `terminal.list` and `machine.list` and publishes changes through
the existing state WebSocket. The old Herdr poller, Board discovery and TUI
notifications are disabled. Network and passkey guards remain active; legacy
control routes are unavailable in core mode.

Terminals are grouped by machine and cwd, with one tab and pane per terminal.
Each pane preserves its full core address behind a stable interface identifier.
Agent identity uses core's `agent` field when supplied, otherwise recognised
application/template/command names. Identity does not gate status: OSC 7501
Working and Blocked lift any program's workspace into Working or Your turn.
Idle and Done appear in Ready; absent or unrecognised status appears in Unknown.
For online machines, the three home counters count the same rows as their respective headings.
A mixed workspace follows its most urgent terminal. On connection loss the last
inventory stays visible offline; subsequent polls reconcile it with core.

Conversation association, creation and terminal streaming follow in later batches.
Creation controls are disabled or hidden until supported. Without
`WHERDR_BACKEND=core`, the existing v2 application is unchanged.

Reference: [published 0.1.16 protocol](https://github.com/herdrdev/herdr-core/blob/v0.1.16/schema/README.md).
Generation 1 and both advertised method lists must support the first v3 terminal
milestone; later additive versions are accepted. Plain mode is used here;
terminal streaming will negotiate framed mode separately. Probe connections close
after each reply and have a three-second deadline and a 16 MiB reply limit.
