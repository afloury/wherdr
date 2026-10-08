import { REPO } from './site'

// What `curl -fsSL https://wherdr.dev/install | sh` prints on a fresh Linux
// server (public/install, same wording and order: say / step / ok), replayed by
// InstallTerminal. Versions and the home folder are examples. `wait` is the
// pause before the line shows, in ms (pulling the image takes a while).
export type InstallLine = { kind: 'blank' | 'title' | 'step' | 'ok' | 'say' | 'strong' | 'dim', text: string, wait: number }
// A command typed at `prompt`; `fast` types it quicker (ssh, short commands).
export type CommandLine = { kind: 'cmd', prompt: string, text: string, wait: number, fast?: boolean }
export type TermLine = InstallLine | CommandLine
export type TermDemo = { title: string, lines: TermLine[] }

export const INSTALL_COMMAND = 'curl -fsSL https://wherdr.dev/install | sh'
// `herdr plugin install owner/repo` (herdr-plugin.toml at the root of the repository).
export const PLUGIN_COMMAND = `herdr plugin install ${REPO.replace('https://github.com/', '')}`
// Homebrew formula (<owner>/homebrew-tap): the npm package, with a `brew services` entry.
export const BREW_COMMANDS = [`brew install ${REPO.replace('https://github.com/', '').split('/')[0]}/tap/wherdr`, 'brew services start wherdr', 'wherdr open']
// The npm package `wherdr` (prebuilt): try it with a package runner, keep it with a global install.
export const RUNNERS = {
  npx: { run: 'npx wherdr', keep: 'npm install -g wherdr' },
  bunx: { run: 'bunx wherdr', keep: 'bun add -g wherdr' },
  pnpm: { run: 'pnpm dlx wherdr', keep: 'pnpm add -g wherdr' },
} as const

// Commands to copy for the by-hand tabs, run as shown in their terminals.
export const DOCKER_COMMANDS = [
  `git clone ${REPO}.git && cd wherdr`,
  'cp .env.example .env',
  'mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" \\\n  "$HOME/.cache/herdr-web" "$HOME/.herdr-projects"',
  'docker compose up -d',
  'tailscale serve --bg --https=7683 http://127.0.0.1:7683',
]
export const MAC_COMMANDS = [
  `git clone ${REPO}.git && cd wherdr`,
  'npm ci && npm run build && npm start',
]

const HOME = '/home/you'
const PORT = 7683

export const INSTALL_OUTPUT: InstallLine[] = [
  { kind: 'blank', text: '', wait: 350 },
  { kind: 'title', text: 'wherdr installer — your Herdr agents, from your phone and your browser', wait: 120 },
  { kind: 'blank', text: '', wait: 60 },
  { kind: 'step', text: 'Checking the system', wait: 200 },
  { kind: 'ok', text: 'Linux aarch64', wait: 260 },
  { kind: 'ok', text: 'Docker 28.4.0, 2.39.4', wait: 420 },
  { kind: 'ok', text: `Herdr 0.9.1 (${HOME}/.local/bin/herdr)`, wait: 300 },
  { kind: 'step', text: `Preparing ${HOME}/wherdr`, wait: 260 },
  { kind: 'ok', text: 'docker-compose.yml (main)', wait: 520 },
  { kind: 'ok', text: '.env created', wait: 180 },
  { kind: 'ok', text: 'Data folders ready', wait: 160 },
  { kind: 'step', text: 'Starting wherdr', wait: 260 },
  { kind: 'ok', text: 'Image pulled', wait: 1900 },
  { kind: 'ok', text: 'Container started', wait: 700 },
  { kind: 'ok', text: `wherdr answers on http://localhost:${PORT}`, wait: 1100 },
  { kind: 'blank', text: '', wait: 120 },
  { kind: 'strong', text: `wherdr is running. Open http://localhost:${PORT} on this machine.`, wait: 60 },
  { kind: 'blank', text: '', wait: 60 },
  { kind: 'say', text: 'Next, for your phone (private network only, never the public Internet):', wait: 60 },
  { kind: 'say', text: '  1. Install Tailscale on this server and your phone, with HTTPS certificates enabled.', wait: 60 },
  { kind: 'say', text: `  2. tailscale serve --bg --https=${PORT} http://127.0.0.1:${PORT}`, wait: 60 },
  { kind: 'say', text: `  3. Put the https://<machine>.<tailnet>.ts.net:${PORT}/ address in APP_URL in ${HOME}/wherdr/.env,`, wait: 60 },
  { kind: 'say', text: `     then cd ${HOME}/wherdr && docker compose up -d`, wait: 60 },
  { kind: 'say', text: '  4. Open that address on the phone, add it to the home screen, enable notifications.', wait: 60 },
  { kind: 'say', text: '  5. Settings → Security → Enable passkey lock (first token: docker compose logs).', wait: 60 },
  { kind: 'blank', text: '', wait: 60 },
  { kind: 'dim', text: `Update: cd ${HOME}/wherdr && docker compose pull && docker compose up -d`, wait: 60 },
  { kind: 'dim', text: `Docs:   ${REPO}#readme`, wait: 60 },
]

// Linux tabs start from your laptop: a quick ssh, the server's greeting, then
// the commands. Kept short so the ssh does not lengthen the demo.
const SERVER = 'you@server:~$'
const sshIn = (): TermLine[] => [
  { kind: 'cmd', prompt: '$', text: 'ssh you@server', wait: 300, fast: true },
  { kind: 'dim', text: 'Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0 aarch64)', wait: 250 },
  { kind: 'blank', text: '', wait: 40 },
]

export const ONE_COMMAND_DEMO: TermDemo = {
  title: 'you@server — ssh',
  lines: [...sshIn(), { kind: 'cmd', prompt: SERVER, text: INSTALL_COMMAND, wait: 200 }, ...INSTALL_OUTPUT],
}

export const DOCKER_DEMO: TermDemo = {
  title: 'you@server — ssh',
  lines: [
    ...sshIn(),
    { kind: 'cmd', prompt: SERVER, text: DOCKER_COMMANDS[0]!, wait: 200 },
    { kind: 'say', text: 'Cloning into \'wherdr\'...', wait: 300 },
    { kind: 'cmd', prompt: 'you@server:~/wherdr$', text: DOCKER_COMMANDS[1]!, wait: 900, fast: true },
    { kind: 'cmd', prompt: 'you@server:~/wherdr$', text: DOCKER_COMMANDS[2]!, wait: 300, fast: true },
    { kind: 'cmd', prompt: 'you@server:~/wherdr$', text: DOCKER_COMMANDS[3]!, wait: 300, fast: true },
    { kind: 'say', text: '[+] Running 2/2', wait: 1600 },
    { kind: 'ok', text: 'Network wherdr_default  Created', wait: 200 },
    { kind: 'ok', text: 'Container wherdr        Started', wait: 600 },
    { kind: 'cmd', prompt: 'you@server:~/wherdr$', text: DOCKER_COMMANDS[4]!, wait: 300, fast: true },
    { kind: 'say', text: 'Available within your tailnet:', wait: 700 },
    { kind: 'blank', text: '', wait: 40 },
    { kind: 'strong', text: `https://server.<tailnet>.ts.net:${PORT}/`, wait: 40 },
    { kind: 'dim', text: `|-- proxy http://127.0.0.1:${PORT}`, wait: 40 },
  ],
}

// macOS runs wherdr natively, on the Mac itself: no ssh.
const MAC = 'you@mac ~ %'
export const MAC_DEMO: TermDemo = {
  title: 'you@mac — zsh',
  lines: [
    { kind: 'cmd', prompt: MAC, text: MAC_COMMANDS[0]!, wait: 300 },
    { kind: 'say', text: 'Cloning into \'wherdr\'...', wait: 300 },
    { kind: 'cmd', prompt: 'you@mac wherdr %', text: MAC_COMMANDS[1]!, wait: 900 },
    { kind: 'say', text: 'added 812 packages in 41s', wait: 1800 },
    { kind: 'say', text: '✔ Nuxt build complete', wait: 2000 },
    { kind: 'blank', text: '', wait: 60 },
    { kind: 'strong', text: `Listening on http://127.0.0.1:${PORT}`, wait: 500 },
  ],
}
