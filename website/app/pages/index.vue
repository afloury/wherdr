<script setup lang="ts">
import { REPO } from '~/utils/site'

const agents = [
  { name: 'Claude Code', color: 'var(--claude)' },
  { name: 'Codex', color: 'var(--codex)' },
  { name: 'omp', color: 'var(--omp)' },
  { name: 'and every agent Herdr recognizes', color: 'var(--dim)' },
]

const stories = [
  {
    id: 'conversation',
    label: 'Conversation · terminal',
    title: 'The real transcript. The real terminal.',
    text: 'wherdr reads each agent\'s own transcript — Claude Code, Codex, omp — and renders it as clean Markdown with grouped tool calls, images and search. Switch to the live terminal (xterm.js) to take over. Reading never resizes a pane.',
    points: ['Composer with queue, attachments and slash commands', 'Model and effort pickers, for the current session only', 'Copy or run the commands the agent proposes'],
    shot: { kind: 'desktop', src: '/shots/desktop-chat.webp', alt: 'wherdr on a computer: agent sidebar with states and quotas, a Claude Code conversation and the message field with its gliding blue ring' },
  },
  {
    id: 'phone',
    label: 'Phone · notifications',
    title: 'Your turn? Answer in one tap.',
    text: 'Install wherdr on your phone as a PWA. A push tells you when an agent finishes or needs you, with its question and options. Answer right from the agent list, without opening the conversation.',
    points: ['Web Push when an agent is done or blocked, and for herdr notification show', 'Do not disturb, per device or for all', 'Offline reading of recent conversations'],
    shot: { kind: 'phones', src: '/shots/phone-question.webp', src2: '/shots/phone-home.webp', alt: 'An agent asks which cache lifetime to use, with numbered options', alt2: 'Agent list on a phone: counters, Claude and Codex quotas, a project with its threads' },
  },
  {
    id: 'projects',
    label: 'herdr-projects',
    title: 'A coordinator, its threads, one board.',
    text: 'With the herdr-projects plugin, a coordinator conversation runs parallel threads, each in its own Git worktree. wherdr groups them under their project and shows the project\'s TASKS.md as a live board: to test, to decide, in progress, blocked, backlog — with one-click replies.',
    points: ['Threads live: state, progress, report', 'Thread slots per machine, across projects', 'wherdr never writes TASKS.md: buttons message the coordinator'],
    shot: { kind: 'desktop', src: '/shots/desktop-project.webp', alt: 'A coordinator conversation with the project panel: to test, to decide, in progress, blocked and backlog lists' },
  },
] as const

const features = [
  { icon: 'i-lucide-columns-2', title: 'Split panes, live', text: 'Herdr\'s real layout on a computer: every pane live, drag to move, drag a divider to resize.' },
  { icon: 'i-lucide-server', title: 'Several machines', text: 'Agents of the SSH machines registered in Herdr appear in their own section. Same features, remote.' },
  { icon: 'i-lucide-gauge', title: 'Claude & Codex quotas', text: '5-hour window and week, with reset times, for every online machine.' },
  { icon: 'i-lucide-git-branch', title: 'New agent, new worktree', text: 'Pick an agent, a folder, optionally a Git worktree and branch, and queue the first message.' },
  { icon: 'i-lucide-file-diff', title: 'Changes view', text: 'Git status and diff of an agent\'s working folder, worktree management.' },
  { icon: 'i-lucide-keyboard', title: 'Keyboard first', text: 'Global search, next agent, new tab, pane swaps, 1–9 to answer. Everything without the mouse.' },
  { icon: 'i-lucide-fingerprint', title: 'Passkey lock', text: 'Face ID, Touch ID, Windows Hello, Android. Sessions slide, devices can be locked remotely.' },
  { icon: 'i-lucide-palette', title: 'Themes, compact list', text: 'wherdr Titanium, herdr.dev, Herdr\'s own themes or follow Herdr. English and French.' },
  { icon: 'i-lucide-puzzle', title: 'Herdr plugins', text: 'Actions declared by your installed Herdr plugins show up in the menus.' },
]

const security = [
  { k: 'NET', title: 'Private network only', text: 'wherdr listens on 127.0.0.1. Reach it from your devices through Tailscale Serve — never a public route, port forward or tunnel.' },
  { k: 'KEY', title: 'Passkey lock', text: 'Once a passkey exists, the API, images and WebSockets need an unlocked session. Lock every device in one tap.' },
  { k: 'LOCAL', title: 'Nothing in the cloud', text: 'No account, no telemetry, no hosted service. wherdr talks to the Herdr socket on your server and reads transcripts read-only.' },
  { k: 'CSP', title: 'Strict by default', text: 'Host allow-list, Origin checks on every write and WebSocket, strict Content Security Policy, no framing.' },
]

const installTabs = [
  { id: 'one', label: 'Linux · one command' },
  { id: 'docker', label: 'Linux · Docker, by hand' },
  { id: 'mac', label: 'macOS · no Docker' },
] as const
const tab = ref<typeof installTabs[number]['id']>('one')

const faq = [
  { label: 'Is wherdr free?', content: 'Yes. It is open source under the MIT license, with no account, no paid plan and no hosted version. You run it on your own machine.' },
  { label: 'What do I need?', content: 'Herdr 0.9.1 or newer running on a Linux or macOS machine, and either Docker (Compose v2, Linux) or Node.js 22. For your phone: a private HTTPS address, which Tailscale Serve gives you in one command.' },
  { label: 'Can I put it on the Internet?', content: 'No. wherdr is a remote shell on your machine: whoever reaches it can start agents and run commands as your user. Use it on localhost or over a private network such as Tailscale, and enable the passkey lock.' },
  { label: 'Does my code or my conversations leave my machine?', content: 'No. wherdr reads the agents\' transcript files and the Herdr socket locally and serves them to your own devices. Push notifications travel through your browser\'s push service, encrypted as the Web Push standard requires. The only other outgoing request is an optional daily check of the latest GitHub release (WHERDR_UPDATE_CHECK=off disables it).' },
  { label: 'Which agents are supported?', content: 'Every agent Herdr recognizes appears in the list with its terminal. Claude Code, Codex and omp also get the full conversation view, model and effort pickers and one-tap answers.' },
  { label: 'Does it work on macOS?', content: 'Yes, natively: npm ci, npm run build, npm start. Docker Desktop cannot reach Herdr\'s Unix socket on the host, so the Docker setup is for Linux servers (a Raspberry Pi works).' },
  { label: 'Will it change my agents\' settings?', content: 'No. Model and effort changes apply to the current session only; wherdr never changes your default model or your agents\' configuration.' },
  { label: 'Is it an official Herdr project?', content: 'No. wherdr is an independent project built on Herdr\'s public socket API. It is not affiliated with Herdr, Anthropic or OpenAI.' },
]
</script>

<template>
  <div id="top">
    <SiteHeader />

    <main>
      <!-- ============================================================ HERO -->
      <section class="hero">
        <div class="grid-bg" aria-hidden="true" />
        <div class="wrap hero-in">
          <div class="hero-copy">
            <p class="label eyebrow">
              <span class="dot" aria-hidden="true" /> Self-hosted · open source · MIT
            </p>
            <h1 class="display hero-title">
              Your coding agents.<br>
              <span class="acc"><EncryptedText text="Wherever you are." :delay="250" :duration="1300" /></span>
            </h1>
            <p class="lead">
              wherdr is a web app and phone PWA for the agents running in <a href="https://herdr.dev" target="_blank" rel="noopener">Herdr</a>
              on your machines — <b>Claude Code, Codex, omp</b> and more. Read their work, answer their questions,
              take over their terminal. From your laptop or your pocket, over your own private network.
            </p>
            <InstallCommand class="hero-cmd" />
            <div class="hero-ctas">
              <a class="btn primary" href="#install">Install guide <UIcon name="i-lucide-arrow-right" class="size-4" /></a>
              <a class="btn" :href="REPO" target="_blank" rel="noopener"><GithubMark /> Star on GitHub</a>
            </div>
            <p class="hero-note label">Linux + Docker · macOS via Node.js · needs Herdr ≥ 0.9.1</p>
          </div>

          <div class="hero-visual">
            <BrowserFrame class="hv-desk" src="/shots/desktop-chat.webp" alt="wherdr on a computer: agent sidebar with states and quotas, a Claude Code conversation and the message field" :width="2160" :height="1350" eager />
            <div class="hv-phone">
              <PhoneFrame src="/shots/phone-question.webp" alt="wherdr on a phone: an agent asks a question with numbered answers" eager />
            </div>
          </div>
        </div>

        <div class="wrap">
          <ul class="agents" aria-label="Works with">
            <li class="label">Works with</li>
            <li v-for="a in agents" :key="a.name"><span class="sq" :style="{ background: a.color }" />{{ a.name }}</li>
          </ul>
        </div>
      </section>

      <!-- ========================================================= FEATURES -->
      <section id="features" class="section">
        <div class="wrap">
          <div v-reveal class="section-head">
            <p class="label"><span class="k">01</span> Features</p>
            <h2 class="display h2">A full workspace on a computer.<br>A companion in your pocket.</h2>
            <p class="lead">Same Herdr session, same agents, nothing copied. On a computer wherdr can replace the terminal client day to day; on a phone it follows your agents while you are away.</p>
          </div>

          <article v-for="(s, i) in stories" :id="s.id" :key="s.id" v-reveal class="story" :class="{ flip: i % 2 === 1, phones: s.shot.kind === 'phones' }">
            <div class="story-copy">
              <p class="label"><span class="k">1.{{ i + 1 }}</span> {{ s.label }}</p>
              <h3 class="display story-title">{{ s.title }}</h3>
              <p class="story-text">{{ s.text }}</p>
              <ul class="ticks">
                <li v-for="p in s.points" :key="p">{{ p }}</li>
              </ul>
            </div>
            <div class="story-shot">
              <BrowserFrame v-if="s.shot.kind === 'desktop'" :src="s.shot.src" :alt="s.shot.alt" :width="2160" :height="1350" />
              <div v-else class="duo">
                <PhoneFrame :src="s.shot.src" :alt="s.shot.alt" />
                <PhoneFrame :src="s.shot.src2" :alt="s.shot.alt2" />
              </div>
            </div>
          </article>

          <div v-reveal class="cells">
            <div v-for="(f, i) in features" :key="f.title" class="cell">
              <div class="cell-top">
                <UIcon :name="f.icon" class="size-5 cell-icon" />
                <span class="label">1.{{ i + 4 }}</span>
              </div>
              <h3 class="cell-title">{{ f.title }}</h3>
              <p class="cell-text">{{ f.text }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ===================================================== HOW IT WORKS -->
      <section id="how" class="section">
        <div class="wrap">
          <div v-reveal class="section-head">
            <p class="label"><span class="k">02</span> How it works</p>
            <h2 class="display h2">Next to Herdr. Never in between.</h2>
            <p class="lead">wherdr runs on the same machine as the Herdr server. It uses Herdr's local socket API and CLI, reads the agents' transcript files, and serves the app to your devices through your private network. Your other computers join through Herdr's SSH machines.</p>
          </div>
          <FlowDiagram v-reveal />
          <div v-reveal class="how-notes">
            <div><p class="label"><span class="k">→</span> Gateway</p><p>Nitro server: API, WebSockets, Web Push and lock, on 127.0.0.1:7683.</p></div>
            <div><p class="label"><span class="k">→</span> Read-only</p><p>Transcripts of <code>~/.claude</code>, <code>~/.codex</code>, <code>~/.omp</code> are read, never written.</p></div>
            <div><p class="label"><span class="k">→</span> Passive client</p><p>Notifications come from Herdr's client socket without resizing anything.</p></div>
          </div>
        </div>
      </section>

      <!-- ========================================================= SECURITY -->
      <section id="security" class="section">
        <div class="wrap">
          <div v-reveal class="section-head">
            <p class="label"><span class="k">03</span> Security</p>
            <h2 class="display h2">It is a shell on your machine.<br>It is treated like one.</h2>
            <p class="lead">Anyone who reaches wherdr can drive your agents as your user. So it stays on your private network, behind a passkey, with nothing in the cloud.</p>
          </div>
          <div v-reveal class="sec-grid">
            <div v-for="s in security" :key="s.k" class="sec">
              <span class="sec-k">[ {{ s.k }} ]</span>
              <h3 class="cell-title">{{ s.title }}</h3>
              <p class="cell-text">{{ s.text }}</p>
            </div>
          </div>
          <p v-reveal class="warn">
            <span class="label">Never</span>
            port forwarding · public reverse proxy · Cloudflare Tunnel · ngrok · <code>tailscale funnel</code>
          </p>
        </div>
      </section>

      <!-- ========================================================== INSTALL -->
      <section id="install" class="section">
        <div class="wrap">
          <div v-reveal class="section-head">
            <p class="label"><span class="k">04</span> Install</p>
            <h2 class="display h2">One command on your server.</h2>
            <p class="lead">With Herdr running, on the always-on Linux machine that hosts your agents (a Raspberry Pi works). The script checks Docker and Herdr, creates <code>~/wherdr</code>, and starts the container on 127.0.0.1. No sudo, and it asks before replacing anything. <a href="/install" target="_blank">Read it first.</a></p>
          </div>

          <div v-reveal class="install">
            <div class="tabs" role="tablist" aria-label="Installation method">
              <button v-for="t in installTabs" :id="`tab-${t.id}`" :key="t.id" type="button" role="tab" class="tab" :aria-selected="tab === t.id" :aria-controls="`panel-${t.id}`" @click="tab = t.id">
                {{ t.label }}
              </button>
            </div>

            <div v-show="tab === 'one'" id="panel-one" role="tabpanel" aria-labelledby="tab-one" class="panel">
              <InstallCommand :halo="false" />
              <ol class="steps">
                <li><b>Run it</b> as the user who runs Herdr. It writes <code>~/wherdr/docker-compose.yml</code> and <code>.env</code>, then <code>docker compose up -d</code>.</li>
                <li><b>Open</b> <code>http://localhost:7683</code> on that machine.</li>
                <li><b>Phone:</b> <code>tailscale serve --bg --https=7683 http://127.0.0.1:7683</code>, put the address in <code>APP_URL</code>, install the app from the browser and enable notifications.</li>
                <li><b>Lock it:</b> Settings → Security → Enable passkey lock.</li>
              </ol>
            </div>

            <div v-show="tab === 'docker'" id="panel-docker" role="tabpanel" aria-labelledby="tab-docker" class="panel">
              <pre class="code"><code><span class="c"># Linux, Docker Compose v2, Herdr running</span>
git clone {{ REPO }}.git && cd wherdr
cp .env.example .env            <span class="c"># PUID, PGID, APP_URL…</span>
mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" \
  "$HOME/.cache/herdr-web" "$HOME/.herdr-projects"
docker compose up -d
tailscale serve --bg --https=7683 http://127.0.0.1:7683</code></pre>
            </div>

            <div v-show="tab === 'mac'" id="panel-mac" role="tabpanel" aria-labelledby="tab-mac" class="panel">
              <pre class="code"><code><span class="c"># macOS or Linux, Node.js 22, Herdr running</span>
git clone {{ REPO }}.git && cd wherdr
npm ci && npm run build && npm start   <span class="c"># → http://localhost:7683</span></code></pre>
              <p class="cell-text">Docker Desktop cannot reach Herdr's Unix socket on macOS, so wherdr runs natively there. Keep it running with launchd, tmux or your usual service manager.</p>
            </div>

            <p class="install-foot">
              Full guide, configuration and troubleshooting in the <a :href="`${REPO}#installation`" target="_blank" rel="noopener">README</a>.
            </p>
          </div>
        </div>
      </section>

      <!-- ============================================================== FAQ -->
      <section id="faq" class="section">
        <div class="wrap faq-wrap">
          <div v-reveal class="section-head">
            <p class="label"><span class="k">05</span> FAQ</p>
            <h2 class="display h2">Questions.</h2>
          </div>
          <UAccordion v-reveal :items="faq" type="multiple" class="faq" :ui="{ item: 'faq-item', trigger: 'faq-trigger', label: 'faq-label', body: 'faq-body' }" />
        </div>
      </section>

      <!-- ============================================================== CTA -->
      <section class="section cta">
        <div class="grid-bg" aria-hidden="true" />
        <div v-reveal class="wrap cta-in">
          <PixelMark class="cta-logo" />
          <h2 class="display h2">Follow your agents from anywhere.</h2>
          <p class="lead">Free and open source. Watch the repository to hear about new releases.</p>
          <div class="hero-ctas">
            <a class="btn primary" :href="REPO" target="_blank" rel="noopener"><GithubMark /> Star on GitHub</a>
            <a class="btn" :href="`${REPO}/releases`" target="_blank" rel="noopener">Releases</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="foot">
      <div class="wrap foot-in">
        <div class="foot-brand">
          <PixelMark class="foot-logo" :boot="false" :glow="false" />
          <span>wherdr</span>
        </div>
        <nav class="foot-links" aria-label="Links">
          <a :href="REPO" target="_blank" rel="noopener">GitHub</a>
          <a :href="`${REPO}/blob/main/LICENSE`" target="_blank" rel="noopener">MIT license</a>
          <a :href="`${REPO}/blob/main/SECURITY.md`" target="_blank" rel="noopener">Security policy</a>
          <a href="https://herdr.dev" target="_blank" rel="noopener">Herdr</a>
        </nav>
        <p class="foot-note">
          Unofficial project, not affiliated with or endorsed by Herdr, Anthropic or OpenAI. Claude, Claude Code, Codex and other product names are trademarks of their respective owners.
        </p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ---------------------------------------------------------------- hero */
.hero { position: relative; overflow: hidden; padding: clamp(48px, 8vw, 96px) 0 48px; }
.hero-in { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 4vw, 64px); align-items: center; }
.eyebrow { display: inline-flex; align-items: center; gap: 10px; margin: 0 0 24px; padding: 6px 12px; border: 1px solid var(--line-strong); background: var(--bg-2); }
.dot { width: 7px; height: 7px; background: var(--green); box-shadow: 0 0 8px var(--green); }
.hero-title { font-size: clamp(42px, 5.4vw, 80px); margin-bottom: 28px; }
.acc { color: var(--accent); }
.hero-copy .lead { margin: 0 0 32px; }
.lead a { color: var(--text); text-decoration-color: var(--accent); text-underline-offset: 3px; }
.hero-cmd { margin-bottom: 20px; }
.hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; }
.hero-note { margin: 24px 0 0; font-size: 11px; color: var(--dim); }
.hero-visual { position: relative; padding-bottom: 40px; }
.hv-desk { width: 100%; }
.hv-phone { position: absolute; right: -18px; bottom: 0; width: 34%; max-width: 230px; }
.agents { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; margin: 56px 0 0; padding: 20px 0 0; border-top: 1px solid var(--line); list-style: none; font: 13px/1 var(--mono); color: var(--text); }
.agents li { display: flex; align-items: center; gap: 10px; }
.agents .label { margin-right: 4px; }
.sq { width: 9px; height: 9px; flex: none; }

/* ----------------------------------------------------------- stories */
.story { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(32px, 5vw, 72px); align-items: center; padding: clamp(40px, 6vw, 72px) 0; border-top: 1px solid var(--line); }
.story.flip .story-copy { order: 2; }
.story.phones { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.story-title { font-size: clamp(28px, 3.4vw, 42px); margin: 16px 0 18px; }
.story-text { color: var(--muted); margin: 0 0 22px; font-size: 17px; }
.ticks { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.ticks li { position: relative; padding-left: 22px; font: 13px/1.5 var(--mono); color: var(--text); }
.ticks li::before { content: ''; position: absolute; left: 0; top: .5em; width: 8px; height: 8px; border: 1px solid var(--accent); }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(16px, 3vw, 32px); max-width: 560px; margin: 0 auto; }
.duo > :last-child { transform: translateY(48px); }

/* ------------------------------------------------------------- cells */
.cells { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: clamp(40px, 6vw, 72px); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.cell { padding: 28px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transition: background .2s; }
.cell:hover { background: var(--surface); }
.cell-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
.cell-icon { color: var(--accent); }
.cell-title { margin: 0 0 8px; font: 700 18px/1.3 var(--display); color: #fff; letter-spacing: -0.01em; }
.cell-text { margin: 0; color: var(--muted); font-size: 15px; }
.cell-text :deep(code), code { font-size: .88em; color: var(--text); background: var(--surface); border: 1px solid var(--line); padding: 1px 5px; }

/* ------------------------------------------------------------- how */
.how-notes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 40px; }
.how-notes p { margin: 0; }
.how-notes p + p { margin-top: 10px; color: var(--muted); font-size: 15px; }

/* ---------------------------------------------------------- security */
.sec-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-left: 1px solid var(--line); border-top: 1px solid var(--line); }
.sec { padding: 28px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.sec-k { display: block; margin-bottom: 36px; font: 600 12px/1 var(--mono); letter-spacing: .1em; color: var(--green); }
.warn { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin: 28px 0 0; padding: 16px 20px; border: 1px solid color-mix(in srgb, var(--rose) 45%, var(--line)); background: color-mix(in srgb, var(--rose) 6%, transparent); font: 13px/1.5 var(--mono); color: var(--text); }
.warn .label { color: var(--rose); }

/* ----------------------------------------------------------- install */
.install { max-width: 920px; }
.tabs { display: flex; flex-wrap: wrap; border: 1px solid var(--line); border-bottom: 0; }
.tab { flex: 1 1 auto; padding: 14px 18px; border: 0; border-right: 1px solid var(--line); background: var(--bg-2); color: var(--muted); cursor: pointer; font: 600 12px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; text-align: left; }
.tab:last-child { border-right: 0; }
.tab[aria-selected="true"] { background: var(--surface); color: #fff; box-shadow: inset 0 2px 0 var(--accent); }
.panel { padding: 28px; border: 1px solid var(--line); background: var(--surface); display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.steps { margin: 0; padding: 0; list-style: none; counter-reset: s; display: grid; gap: 16px; }
.steps li { counter-increment: s; position: relative; padding-left: 44px; color: var(--muted); }
.steps li::before { content: counter(s, decimal-leading-zero); position: absolute; left: 0; top: 1px; font: 600 12px/1.9 var(--mono); color: var(--accent); }
.steps b { color: var(--text); }
.code { margin: 0; padding: 20px; overflow-x: auto; background: var(--bg-2); border: 1px solid var(--line); font: 13px/1.8 var(--mono); color: var(--text); }
.code code { background: none; border: 0; padding: 0; font-size: inherit; }
.code .c { color: var(--dim); }
.install-foot { margin: 20px 0 0; color: var(--muted); font-size: 15px; }
.install-foot a, .section-head a { color: var(--text); text-decoration-color: var(--accent); text-underline-offset: 3px; }

/* --------------------------------------------------------------- faq */
.faq-wrap { display: grid; grid-template-columns: minmax(0, .7fr) minmax(0, 1.3fr); gap: 48px; align-items: start; }
.faq { border-top: 1px solid var(--line); }
.faq :deep(.faq-item) { border-bottom: 1px solid var(--line); }
.faq :deep(.faq-trigger) { padding: 22px 0; font: 600 17px/1.4 var(--display); color: #fff; }
.faq :deep(.faq-body) { padding: 0 0 22px; color: var(--muted); font-size: 16px; max-width: 64ch; }

/* --------------------------------------------------------------- cta */
.cta { overflow: hidden; text-align: center; }
.cta-in { position: relative; z-index: 1; display: grid; justify-items: center; gap: 20px; }
.cta-in .lead { margin: 0 0 12px; }
.cta-logo { width: 120px; height: auto; color: var(--text); margin-bottom: 12px; }

/* ------------------------------------------------------------ footer */
.foot { border-top: 1px solid var(--line); padding: 40px 0 56px; }
.foot-in { display: grid; grid-template-columns: auto 1fr; gap: 20px 40px; align-items: center; }
.foot-brand { display: flex; align-items: center; gap: 10px; font: 800 18px/1 var(--display); color: #fff; }
.foot-logo { width: 28px; height: auto; color: var(--text); }
.foot-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px 28px; }
.foot-links a { font: 500 12px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); text-decoration: none; }
.foot-links a:hover { color: var(--text); }
.foot-note { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--dim); max-width: 90ch; }

/* -------------------------------------------------------- responsive */
@media (max-width: 1080px) {
  .hero-in { grid-template-columns: minmax(0, 1fr); }
  .hero-visual { max-width: 760px; }
  .hv-phone { right: 0; }
  .sec-grid { grid-template-columns: repeat(2, 1fr); }
  .cells { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 760px) {
  .story, .story.phones { grid-template-columns: minmax(0, 1fr); }
  .story.flip .story-copy { order: 0; }
  .cells, .sec-grid, .how-notes { grid-template-columns: minmax(0, 1fr); }
  .faq-wrap { grid-template-columns: 1fr; gap: 0; }
  .foot-in { grid-template-columns: minmax(0, 1fr); }
  .foot-links { justify-content: flex-start; }
  .hv-phone { width: 38%; right: -6px; }
  .tab { flex: 1 1 100%; border-right: 0; border-bottom: 1px solid var(--line); }
  .panel { padding: 20px; }
}
</style>
