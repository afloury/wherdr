# Contributing to wherdr

Thanks for your interest! Issues and pull requests are welcome.

## Development setup

Requirements: Node.js 22 and a Herdr ≥ 0.9.1 server on the same machine.

```sh
npm ci
npm run dev          # http://localhost:3000, hot reload
npx vitest run       # unit and component tests
npx nuxt typecheck   # type check (TypeScript stays on 5.x: TS 7 breaks vue-tsc)
npm run build        # production build in .output/
npm run build:demo   # browser demo (wherdr.dev/demo/) in .output-demo/public/
```

Before opening a pull request, make sure `npx vitest run` and `npx nuxt typecheck` pass, and add
tests for new logic (see [Tests](#tests) below; fixtures in `tests/fixtures/`, **never real
conversations or personal paths**: use neutral names such as `host-a`, `laptop`, `alice`,
`/home/user`).

### The browser demo

`npm run build:demo` builds the same app with `VITE_WHERDR_DEMO=1`: static files for the `/demo/`
path, with no `server/` code and no service worker. `app/demo/plugin.client.ts` (added only to
that build) replaces `fetch` and `WebSocket` before the app starts: `app/demo/server.ts` answers
`/api/*` and the live state from the invented session of `app/demo/scenario.ts`, scripted turns
included; files under `/demo/` load normally; every other request is refused. Serve the folder
under `/demo/` to try it (for example `.output-demo/public` copied to `<root>/demo`). The site
workflow (`.github/workflows/site.yml`) builds it and deploys it with the site. Demo content stays
invented and in English, like the test fixtures.

## Tests

**A fixed bug comes with a test that fails before the fix and passes after it.** Write the test
first, watch it fail on the buggy code, then fix. Test what the user sees (a rendered element, a
sent request, a stored value), not the wiring.

| Kind | Where | Run | What it covers |
| --- | --- | --- | --- |
| Unit | `tests/*.test.ts` | `npx vitest run --project unit` | Pure modules of `server/`, `shared/`, `app/utils/`, in Node. |
| Component | `tests/components/*.test.ts` | `npx vitest run --project components` | Vue components mounted in a Nuxt environment (auto-imports, Nuxt UI) on happy-dom, with `mountSuspended` and `registerEndpoint` from `@nuxt/test-utils/runtime`. |
| End to end | `tests/e2e/*.spec.ts` | `npm run build && npm run test:e2e` | The built app in Chromium and WebKit (Safari's engine, for iOS bugs), at iPhone and desktop sizes, against a fake Herdr server with neutral data. |

`npx vitest run` runs the unit and component projects together. For the end-to-end tests,
install the browsers once with `npx playwright install --with-deps chromium webkit`; a single
project runs with `npm run test:e2e -- --project=webkit-phone` (names in `playwright.config.ts`),
and `npx playwright show-report` opens the last report. They never touch a real Herdr session.

GitHub Actions (`.github/workflows/ci.yml`) runs all of them, the type check and the leak check
(gitleaks only: your `.leak-patterns` stays local) on every push and pull request to `main`.

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

## Language

- **English everywhere developers look**: code, identifiers, comments, test names, server
  logs, commit messages, pull requests, issues and docs (README, CHANGELOG, CONTRIBUTING).
- **The interface is bilingual (English / French)**: keys are written in English and the
  French text lives in the `FR` dictionary of `app/utils/i18n.ts` (see Conventions below).
- French only appears as data: translations, regular expressions matching French screens,
  and test fixtures reproducing real French text.

## Conventions

- **Interface text** goes through `t()` / `tl()` (`app/utils/i18n.ts`). Write the English
  text as the key, `t('Rename pane')`, and add its French translation to the `FR` dictionary
  in the same file: it is required, `tests/i18n.test.ts` fails on a `t()` key without a French
  entry and on an entry nothing uses. Text with variable parts uses `tl(en, fr)`, both written
  in full: ``tl(`${n} agents`, `${n} agents`)``. A missing translation shows English, never
  another language. Error messages the server sends to the UI are English keys too.
- **Design**: square corners, 1 px lines, Archivo / Inter / JetBrains Mono, uppercase mono
  labels; colors come from the theme variables (`app/assets/css/main.css`,
  `app/utils/themes.ts`). Check the phone layout (iPhone size) and the desktop layout.
- **iOS**: keep `apple-mobile-web-app-status-bar-style` on `black` (with `black-translucent`,
  iOS 26 shortens the installed app from the bottom), and mind the keyboard and safe areas.
- Server code lives in `server/` (Nitro), shared types and pure helpers in `shared/`, the
  client in `app/`.

## Leak check

The repository is public, and so is every commit in its history: a private value committed and
then removed is still published. `scripts/check-leaks.mjs` combines two checks:

- **gitleaks** for tokens and keys: the `gitleaks` binary when installed, otherwise the
  `zricethezav/gitleaks` Docker image when it has been pulled (`docker pull zricethezav/gitleaks`),
  run with read-only mounts and no network; otherwise it is skipped with a message.
- **Your forbidden patterns** for what no generic tool knows: your user name, host names,
  e-mail addresses, tailnet, private IPs, project and client names. They live in `.leak-patterns`,
  which git ignores (format in `.leak-patterns.example`: one case-insensitive regex per line,
  `regex !! glob, glob` to allow it in some files, `! glob` to never scan a file). In a linked
  worktree, the main checkout's file is used when the worktree has none.

```sh
cp .leak-patterns.example .leak-patterns          # then list your own private values
npm run check:leaks                               # every file of the git index
npm run check:leaks -- --staged                   # staged files only
npm run check:leaks -- --range origin/main..HEAD  # every commit you are about to push
npm run hooks:install                             # run --staged before each commit
```

What each mode covers:

| Mode | Patterns scan | gitleaks scans |
| --- | --- | --- |
| default | the content of every file in the git index | the same files |
| `--staged` | the content of staged files | the same files |
| `--range <revs>` | for each commit of the range, the lines it adds (per-file exceptions apply) and its message (every pattern applies) | the same commits (`gitleaks git --log-opts`) |

In `--range` mode, merge commits only contribute the lines that differ from all their parents
(conflict resolutions); the merged commits are scanned on their own when they are in the range.
Run it before every push: the pre-commit hook only sees the final state of the files, so a
value added in one commit and removed in the next would pass it.

Matches are printed as commit (in `--range` mode), `file:line` or `message:line`, and the pattern;
the value itself is truncated, never shown in full. Any match makes the command exit with a
non-zero code. `--no-gitleaks` runs the patterns only.

Test fixtures are often captured from real terminals: replace project, folder, branch and host
names, session titles, addresses and IDs with neutral ones (`acme-shop`, `demo`, `feature/x`,
`host-a`) before committing them.

## Reporting security issues

Please do not open public issues for vulnerabilities: see [SECURITY.md](SECURITY.md).
