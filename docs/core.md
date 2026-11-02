# herdr-core connection preview

Batch A of v3 provides a connection check, without an agent inventory yet.
Run wherdr with `WHERDR_BACKEND=core` (at build and server startup) and
`HC_SOCKET` pointing to the socket of the desired hc session. Obtain the endpoint
from your hc configuration; wherdr requires an explicit endpoint and never starts
or installs core. This avoids accidentally selecting an inherited agent session.
The browser cannot choose the endpoint or issue arbitrary RPC calls.

The preview replaces the legacy application shell and disables its background
poller, Board warm-up and TUI notifications. Existing network and passkey guards
still protect `/api/core`; a locked app reports its locked state. Unlock controls,
inventory and actions follow in the next batches. Without `WHERDR_BACKEND=core`,
the existing v2 application is unchanged.

Reference: [published 0.1.16 protocol](https://github.com/herdrdev/herdr-core/blob/v0.1.16/schema/README.md).
Generation 1 and both advertised method lists must support the first v3 terminal
milestone; later additive versions are accepted. Plain mode is used here;
terminal streaming will negotiate framed mode separately. Probe connections close
after each reply and have a three-second deadline and a 16 MiB reply limit.
