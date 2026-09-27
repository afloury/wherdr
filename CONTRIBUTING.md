# Contributing to wherdr

Thanks for your interest! Issues and pull requests are welcome.

## Development setup

Requirements: Node.js 22 and a Herdr ≥ 0.9.1 server on the same machine.

```sh
npm ci
npm run dev          # http://localhost:3000, hot reload
npx vitest run       # unit tests
npx nuxt typecheck   # type check (TypeScript stays on 5.x: TS 7 breaks vue-tsc)
npm run build        # production build in .output/
```

Before opening a pull request, make sure `npx vitest run` and `npx nuxt typecheck` pass, and add
tests for new logic (`tests/`, fixtures in `tests/fixtures/`, **never real conversations or
personal paths**: use neutral names such as `host-a`, `laptop`, `alice`, `/home/user`).

## Testing without touching your real agents

wherdr can start, stop and type into agents. Work against an **isolated Herdr session** and a
separate data folder, never your everyday session:

```sh
# Start an isolated Herdr session (from a plain terminal: when launched from inside a Herdr
# pane, unset the inherited HERDR_* and CLAUDE_* variables first).
herdr --session wherdr-dev server &

# Point a dev instance at it, with its own data folder (no passkeys, no push subscriptions).
mkdir -p dev-data && echo '{ "subs": [] }' > dev-data/push.json
HERDR_WEB_SESSION=wherdr-dev HERDR_WEB_MACHINES=off DATA_DIR=dev-data npm run dev

# Clean up afterwards.
herdr --session wherdr-dev server stop
rm -rf ~/.config/herdr/sessions/wherdr-dev dev-data
```

`docker-compose.test.yml` does the same with Docker (port 7684, data in `test-data/`, Herdr
session `hwtest`, also used on remote machines through `HERDR_WEB_REMOTE_SESSION`).

Do not test model changes with `/model <name>` or Enter in the `/model` menu of a real agent:
both change the account's default model. wherdr itself only uses "this session" choices.

## Conventions

- **Interface text** goes through `t()` / `tl()` (`app/utils/i18n.ts`): French is the key,
  English the default language. Every new string needs both.
- **Design**: square corners, 1 px lines, Archivo / Inter / JetBrains Mono, uppercase mono
  labels; colors come from the theme variables (`app/assets/css/main.css`,
  `app/utils/themes.ts`). Check the phone layout (iPhone size) and the desktop layout.
- **iOS**: keep `apple-mobile-web-app-status-bar-style` on `black` (with `black-translucent`,
  iOS 26 shortens the installed app from the bottom), and mind the keyboard and safe areas.
- Server code lives in `server/` (Nitro), shared types and pure helpers in `shared/`, the
  client in `app/`.

## Reporting security issues

Please do not open public issues for vulnerabilities: see [SECURITY.md](SECURITY.md).
