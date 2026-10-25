# Troubleshooting

[Documentation](README.md) · [Project](../README.md)

## Troubleshooting

- **"The Herdr server is not responding"**: start Herdr on the server (`herdr` or
  `herdr server`).
- **wherdr stops when you log out** (Linux): lingering is off. `wherdr doctor` says so; run
  `sudo loginctl enable-linger $USER` once.
- **The Board says `claude is not installed here`**: the agent is in a folder your login shell
  does not add to its `PATH`. Add it there, then run `wherdr service install` again
  ([Agent PATH](installation.md#agent-path)).
- **No conversation, only the terminal**: the agent was started before the Herdr integration
  was installed, or it is not Claude Code / Codex / omp. Install the integration
  (`herdr integration install claude|codex|omp`) and start a new agent. When the integration
  is missing on the agent's machine, the conversation says so with the exact command.
- **Passkeys or notifications unavailable**: the page must be served over HTTPS (or
  `localhost`). On iPhone, notifications need the app installed on the home screen.
- **HTTP 403 "wherdr only answers this computer and your tailnet"**: the device is on another
  network (Wi-Fi, LAN). Open wherdr through Tailscale, or name that private network in
  `WHERDR_TRUSTED_NETWORKS` ([Network access](security.md#network-access)).
- **HTTP 403 "Tailscale Funnel opens wherdr to the Internet"**: turn Funnel off for wherdr’s port (`tailscale funnel status`).
- **wherdr stops at startup with "Refusing to listen on …"**: `HOST` is not loopback nor this
  machine's tailnet address. Set `HOST=127.0.0.1` and use `tailscale serve`, or see
  [Network access](security.md#network-access).
- **HTTP 403 "This address isn't enabled yet"**: for a tailnet address, run the command the
  page gives on the machine: it tells whether `tailscale serve` publishes wherdr's port there.
  For another private name, add the hostname or IP address to `HERDR_WEB_ALLOWED_HOSTS`, or use
  the hostname in `APP_URL`, then restart wherdr.
- **Remote machine offline**: `grep machine ~/wherdr/wherdr.log` shows its state. Test SSH:
  `ssh -o BatchMode=yes laptop '~/.local/bin/herdr status server'`.
  - `Could not resolve hostname`: check the full name in `HostName`;
  - `Permission denied (publickey)` / `Host key verification failed`: key or `known_hosts`
    (run `ssh laptop true` once on the server);
  - `Bad owner or permissions`: `~/.ssh/config` must belong to you and not be group-writable.
- **Claude says "Not logged in" on a Mac** whose Herdr server was started over SSH: the macOS
  keychain is locked in SSH sessions. Start the Herdr server from a terminal on the Mac.
- **`Session open refused by peer` / `Connection closed by UNKNOWN port 65535`** in the logs: the
  shared SSH connection to a remote machine reached sshd's session limit (`MaxSessions`, 10 by
  default). wherdr stays under it and retries, so this is rare; if it persists (many terminals
  open at once), raise `MaxSessions` in the remote machine's `sshd_config`.
- **Quotas missing**: see [Claude and Codex quotas](quotas.md#claude-and-codex-quotas).
- **iPhone layout cut at the bottom** after changing the status bar style: reinstall the home
  screen icon (iOS reads this setting at install time).
