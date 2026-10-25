# The wherdr command

[Documentation](README.md) · [Project](../README.md)

### The `wherdr` command

An alternative to [the one command](installation.md#the-one-command), from npm or Homebrew: the same app, without
the Herdr plugin. npm can hold a new release for up to two days (moderation), so these get updates
later than the installer, which downloads the GitHub release package. The npm package holds the
built app: nothing is compiled on your machine. Try it with `npx wherdr` (or `bunx wherdr`,
`pnpm dlx wherdr`); to keep it, install it once:

```sh
npm install -g wherdr       # or: pnpm add -g wherdr, bun add -g wherdr
wherdr service install      # configures automatic startup; prints the address
wherdr phone                # phone state, the app's phone setup page, QR code once it answers
```

| Command | What it does |
| --- | --- |
| `wherdr` (or `wherdr run`) | Runs in the foreground; Ctrl+C stops it. |
| `wherdr start` · `stop` · `restart` | Background server, pid and log in `~/wherdr`. `start` says *started* only once the port answers; otherwise it prints the end of the log. With a login service installed, they drive the service. |
| `wherdr status` | Address, process, service, data folder and log. |
| `wherdr logs` (`-f` to follow, `-n 100`) | The log, `~/wherdr/wherdr.log`. |
| `wherdr open` | Opens wherdr in the browser: its tailnet address when published and answering, else `localhost`. |
| `wherdr phone` | Whether your phone can reach wherdr (Tailscale, `tailscale serve`, the address answering), the `tailscale serve` command to publish it when it is not (wherdr then enables the address by itself), the link to **Settings › Phone**, and the QR code once the address answers. |
| `wherdr service install` · `uninstall` | Configure automatic startup: a LaunchAgent on macOS (`~/Library/LaunchAgents/dev.wherdr.plist`) starts at login; a `systemd --user` unit on Linux starts at boot with lingering enabled, otherwise at login. The command tries to enable lingering (`loginctl enable-linger`, without sudo; when your system refuses it, the command to run is printed) so it keeps running while you are logged out; without lingering it stops after logout. The service gets your [PATH](installation.md#agent-path). The one command and key **A** of the plugin's panel run it too. |
| `wherdr doctor` | Checks Node/Bun, Herdr and its socket, the port, the service, the data folder and `APP_URL`. |

Options: `--port` (default `7683`), `--host` (default `127.0.0.1`; loopback or this machine's
tailnet address, anything else is [refused](security.md#network-access) unless `WHERDR_TRUSTED_NETWORKS` names it),
`--data-dir` (passkeys, push keys and settings; default `~/wherdr/data`, the folder the Herdr
plugin and the install script use), `--session` (a named Herdr session). Every
[environment variable](configuration.md#configuration) works too, and so do `KEY=VALUE` lines in
`~/wherdr/wherdr.env` (for example `APP_URL=…`, read at each start); options win, then the
environment, then that file. `start` and `service install` remember the port and folders for
the other commands.

**Homebrew:** `brew install afloury/tap/wherdr` installs the same package; the first install also
brings Homebrew's Node.js (heavier than the Herdr plugin when Node.js 22 is already there). Then:

1. `brew services start wherdr`: runs `wherdr run` now and at every login, log in
   `$(brew --prefix)/var/log/wherdr.log` (`wherdr logs` reads it).
2. `wherdr open`: the setup guide in your browser.
3. Its Phone step (or `wherdr phone`).

On a Homebrew install, `wherdr start`, `stop`, `restart` and `service install` point to
`brew services` (the installed path changes at each upgrade); `wherdr status` and `wherdr doctor`
show the Homebrew service. Update: `brew upgrade wherdr && brew services restart wherdr`.

The login service records the **absolute path** of the runtime (n, nvm, fnm, Volta or Homebrew
node) and your [PATH](installation.md#agent-path), since launchd and systemd do not see your shell's. It refuses to point at a
temporary `npx` / `pnpm dlx` / `bunx` folder: install the package globally first. To update:
`npm install -g wherdr@latest && wherdr restart` (with `npx`: stop it, then `npx wherdr@latest`).

Bun runs wherdr too (WebSockets, push, passkeys and Herdr's socket work); when Node.js 22 is
also installed, `bunx wherdr` hands the server to Node, the reference runtime. Set
`WHERDR_RUNTIME=bun` to keep Bun.
