# wherdr.dev

The public website of wherdr: a static Nuxt 4 + Nuxt UI 4 site in the app's "wherdr Titanium"
look, and the one-line installer served at `/install`. Fonts, icons and screenshots are bundled:
the page makes no request to another site.

- **Develop**: `npm ci && npm run dev` (http://localhost:3000).
- **Build**: `npm run generate` → static files in `.output/public/` (`npm run typecheck` checks the types).
- **Deploy (private)**: `SITE_BIND=<tailscale-ip> docker compose up -d --build` — nginx on
  `${SITE_BIND:-127.0.0.1}:${SITE_PORT:-8120}`, `/install` served as `text/plain`.
- **Comparison pages** (not indexed): `/grid/1`…`/grid/4` show the landing page with a variant of
  the background grid (cursor glow, travelling packets, hero perspective, dotted intersections;
  `components/GridBackground.vue`); `/preview` adds the live demos, the running install and
  the agents band. `/` stays the reference. If the installer's output changes, update
  `app/utils/installDemo.ts` (a root test checks its lines against `public/install`).
- **Live demos** (`/preview`): the hero phone and desktop and the three feature stories play
  made-up sessions in the app's look. Each is a script of timed steps (`app/utils/heroDemo.ts`,
  `app/utils/storyDemos.ts`) played by `useDemoClock`; views of the same script share one
  clock (the hero phone and window stay in sync). Pieces of the app (console, "Your turn" card,
  agent card, message field, desktop shell) live in `components/demo/`. A demo plays only on
  screen in a visible tab; `prefers-reduced-motion` shows its final step, still. A root test
  checks every script's timing.
- **Installer**: [`public/install`](public/install) (`curl -fsSL https://wherdr.dev/install | sh`);
  `sh tests/install.test.sh` runs shellcheck and its tests in a throwaway container with stub
  `docker` and `herdr` binaries.
- **Screenshots** (`public/shots/`): taken from the fictional demo set (Herdr session `hwtest` in
  a container, invented projects and conversations) in the wherdr Titanium theme. Never use real
  data.
