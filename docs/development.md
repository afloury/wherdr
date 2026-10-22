# Development and tests

[Documentation](README.md) · [Project](../README.md)

### From source

For development, or to run a checkout of your own. With Herdr running, Git and Node.js 22 on the same machine:

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
npm ci
npm run build
npm start                  # listens on 127.0.0.1:7683
```

Open `http://localhost:7683` in a browser on that computer: the desktop layout, passkeys and the
installable app work there, since browsers treat `localhost` as secure. There is no phone access
and no push notification in this setup; for that, use the [recommended setup](networks.md#recommended-always-on-server--tailscale) (or publish this
instance with `tailscale serve` as described there and start it with
`APP_URL=https://server.example.ts.net:7683/ npm start`).

Run it as the user who runs Herdr. It uses `$HOME` and `$HOME/.local/bin/herdr`, or `herdr` from
the `PATH` (Homebrew); set `HERDR_BIN` otherwise. `DATA_DIR` holds passkeys, push data and recent
folders (default `./data`). `npm start` listens on `127.0.0.1` (`HOST`) and port `7683` (`PORT`).
The first-passkey bootstrap token is printed in its output. Keep the process running with your
usual service manager (systemd user unit, launchd, tmux…).

With `APP_URL` empty or `http://localhost:7683/`, wherdr starts normally but disables Web Push
and logs a warning.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md), including the [agent test rule](../CONTRIBUTING.md#agent-test-rule)
and `npm run test:affected -- --base origin/v2 --dry-run`. Changes are listed in [CHANGELOG.md](../CHANGELOG.md).

Every commit is public: a leak check (gitleaks plus your own forbidden patterns) covers the files
and the commits about to be pushed; see [Leak check](../CONTRIBUTING.md#leak-check).
