# Security policy

## Threat model

wherdr is a **remote control for a shell**: it starts coding agents, types into terminals and
reads files as the user running the Herdr server. It is designed for a single user on a
trusted private network:

- It must **never be exposed on the public Internet**. It listens on `127.0.0.1`; reach it from
  other devices only through a private network such as Tailscale.
- Anyone who can reach it without a passkey registered can control your agents. Enable the
  **passkey lock** (Settings → Security).
- Docker is not a security boundary here: the container drives the Herdr server of the host.

Reports showing that these assumptions can be bypassed are very welcome, for example: access
without an unlocked session while the lock is enabled, cross-site requests or WebSocket
hijacking from another origin, path traversal in file or photo routes, command injection through
agent names, folders, branches or SSH targets.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → *Report a
vulnerability*) instead of a public issue. Include the version or commit, your setup (Docker or
not, how the app is reached) and steps to reproduce. You should get an answer within a week.

## Supported versions

Only the latest release receives fixes.
