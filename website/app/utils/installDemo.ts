import { REPO } from './site'

// What `curl -fsSL https://wherdr.dev/install | sh` prints on a fresh Linux
// server (public/install, same wording and order: say / step / ok), replayed by
// InstallTerminal. Versions and the home folder are examples. `wait` is the
// pause before the line shows, in ms (pulling the image takes a while).
export type InstallLine = { kind: 'blank' | 'title' | 'step' | 'ok' | 'say' | 'strong' | 'dim', text: string, wait: number }

export const INSTALL_COMMAND = 'curl -fsSL https://wherdr.dev/install | sh'

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
