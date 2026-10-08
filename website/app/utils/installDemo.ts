import { REPO } from './site'

// What `curl -fsSL https://wherdr.dev/install | sh` prints on a Mac with Herdr
// and Node.js (public/install, same wording and order: say / step / ok, plus
// the lines the Herdr plugin writes to the terminal), replayed by
// InstallTerminal. Versions and the home folder are examples. `wait` is the
// pause before the line shows, in ms (installing the plugin takes a while).
export type InstallLine = { kind: 'blank' | 'title' | 'step' | 'ok' | 'say' | 'strong' | 'dim', text: string, wait: number }
// A command typed at `prompt`; `fast` types it quicker (ssh, short commands).
export type CommandLine = { kind: 'cmd', prompt: string, text: string, wait: number, fast?: boolean }
export type TermLine = InstallLine | CommandLine
export type TermDemo = { title: string, lines: TermLine[] }

export const INSTALL_COMMAND = 'curl -fsSL https://wherdr.dev/install | sh'
// The same script without the plugin: Docker Compose by hand in ~/wherdr (Linux).
export const DOCKER_INSTALL_COMMAND = 'curl -fsSL https://wherdr.dev/install | WHERDR_MODE=docker sh'
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

// Commands to copy for the Docker-by-hand tab, run as shown in its terminal.
export const DOCKER_COMMANDS = [
  `git clone ${REPO}.git && cd wherdr`,
  'cp .env.example .env',
  'mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" \\\n  "$HOME/.cache/herdr-web" "$HOME/.herdr-projects"',
  'docker compose up -d',
  'tailscale serve --bg --https=7683 http://127.0.0.1:7683',
]

const HOME = '/Users/you'
const PORT = 7683

export const INSTALL_OUTPUT: InstallLine[] = [
  { kind: 'blank', text: '', wait: 350 },
  { kind: 'title', text: 'wherdr installer — your Herdr agents, from your phone and your browser', wait: 120 },
  { kind: 'step', text: 'Checking the system', wait: 200 },
  { kind: 'ok', text: 'macOS 15.6', wait: 260 },
  { kind: 'ok', text: `Herdr 0.9.3 (${HOME}/.local/bin/herdr)`, wait: 300 },
  { kind: 'ok', text: 'Runtime: /opt/homebrew/bin/node (v22.20.0)', wait: 300 },
  { kind: 'step', text: 'Installing the wherdr Herdr plugin', wait: 260 },
  { kind: 'say', text: `wherdr: installing in ${HOME}/wherdr`, wait: 900 },
  { kind: 'say', text: 'Press prefix+i in Herdr to open the wherdr panel.', wait: 1600 },
  { kind: 'dim', text: '  Herdr reloaded its config: no restart needed.', wait: 200 },
  { kind: 'ok', text: `Herdr plugin ${REPO.split('/').at(-2)}.wherdr installed`, wait: 900 },
  { kind: 'ok', text: `wherdr answers on http://localhost:${PORT}`, wait: 500 },
  { kind: 'blank', text: '', wait: 120 },
  { kind: 'strong', text: `wherdr is running → http://localhost:${PORT}`, wait: 60 },
  { kind: 'say', text: '  The setup guide is open in your browser; its Phone step makes wherdr', wait: 60 },
  { kind: 'say', text: '  reachable from your phone over Tailscale (private, never the Internet).', wait: 60 },
  { kind: 'say', text: '  In Herdr, prefix+i opens the wherdr panel: state, open, phone, start/stop, update.', wait: 60 },
  { kind: 'blank', text: '', wait: 60 },
  { kind: 'dim', text: 'Update: run this command again, or U in the wherdr panel.', wait: 60 },
  { kind: 'dim', text: `Docs:   ${REPO}#readme`, wait: 60 },
]

// The one command, on the Mac that runs Herdr.
export const ONE_COMMAND_DEMO: TermDemo = {
  title: 'you@mac — zsh',
  lines: [{ kind: 'cmd', prompt: 'you@mac ~ %', text: INSTALL_COMMAND, wait: 300 }, ...INSTALL_OUTPUT],
}

// The Docker tab starts from your laptop: a quick ssh, the server's greeting,
// then the commands. Kept short so the ssh does not lengthen the demo.
const SERVER = 'you@server:~$'
const sshIn = (): TermLine[] => [
  { kind: 'cmd', prompt: '$', text: 'ssh you@server', wait: 300, fast: true },
  { kind: 'dim', text: 'Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0 aarch64)', wait: 250 },
  { kind: 'blank', text: '', wait: 40 },
]

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
