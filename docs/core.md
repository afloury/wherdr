# herdr-core inventory

Batches A–B of v3 provide a connection check and a read-only terminal inventory.
Run wherdr with `WHERDR_BACKEND=core` (at build and server startup) and
`HC_SOCKET` pointing to the socket of the desired hc session. Obtain the endpoint
from your hc configuration; wherdr requires an explicit endpoint and never starts
or installs core. This avoids accidentally selecting an inherited agent session.
The browser cannot choose the endpoint or issue arbitrary RPC calls.

The preview replaces the legacy application shell and disables its background
poller, Board warm-up and TUI notifications. Existing network and passkey guards
still protect `/api/core`; a locked app uses the existing passkey screen and
rechecks core after authentication. The inventory lists live terminals, including those without an agent identity or status.
Refresh reconciles with core; selecting a terminal reads its current facts by full address.
Missing status stays Unknown, independently of whether the process is live or finished.
Conversation association, creation and terminal streaming follow in later batches. Without `WHERDR_BACKEND=core`,
the existing v2 application is unchanged.

Reference: [published 0.1.16 protocol](https://github.com/herdrdev/herdr-core/blob/v0.1.16/schema/README.md).
Generation 1 and both advertised method lists must support the first v3 terminal
milestone; later additive versions are accepted. Plain mode is used here;
terminal streaming will negotiate framed mode separately. Probe connections close
after each reply and have a three-second deadline and a 16 MiB reply limit.
