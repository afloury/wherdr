# wherdr.dev

The public website of wherdr: a static Nuxt 4 + Nuxt UI 4 site in the app's "wherdr Titanium"
look, and the one-line installer served at `/install`. Fonts and icons are bundled: the page
makes no request to another site.

- **Develop**: `npm ci && npm run dev` (http://localhost:3000).
- **Build**: `npm run generate` → static files in `.output/public/` (`npm run typecheck` checks the types).
- **Deploy (public)**: Cloudflare Workers static assets, on the custom domain `wherdr.dev`
  (`wrangler.jsonc`, no Worker script). `.github/workflows/site.yml` generates and deploys on every
  push to `main` that touches `website/`, or by hand (Actions → site → Run workflow). It needs the
  repository secrets `CLOUDFLARE_API_TOKEN` (permissions: Account › Workers Scripts › Edit,
  Zone › Workers Routes › Edit, Zone › DNS › Edit and Zone › Zone › Read on `wherdr.dev`) and
  `CLOUDFLARE_ACCOUNT_ID`; without them the deploy job is skipped. By hand:
  `npm run generate && npm run deploy` (`npx wrangler deploy --dry-run` checks the config
  without an account).
- **Headers**: `public/_headers` (Workers) and `nginx.conf` (Docker) set the same security headers,
  `text/plain` for `/install` and long caching for `/_nuxt/`. Change both together.
- **Deploy (private preview)**: `SITE_BIND=<tailscale-ip> docker compose up -d --build` — nginx on
  `${SITE_BIND:-127.0.0.1}:${SITE_PORT:-8120}`, serving the same `nuxt generate` output.
- **Background**: `components/GridBackground.vue` draws the hero and closing grid: dots at the
  line crossings and short glowing packets along the lines.
- **Live demos**: the hero phone and desktop and the three feature stories play made-up sessions
  in the app's look. Each is a script of timed steps (`app/utils/heroDemo.ts`,
  `app/utils/storyDemos.ts`) played by `useDemoClock`; views of the same script share one
  clock (the hero phone and window stay in sync). The pieces in `components/demo/` copy the app's
  own components and CSS (class names, sizes, Titanium tokens, the `.app-ui` block of
  `assets/css/main.css`) in its default settings: Halo focus ring, medium typing speed with
  encrypted text (`app/utils/typing.ts`, a copy of the app's `app/utils/typewriter.ts` timing; a
  root test checks they agree). When the app's look changes, update them to match. A demo plays
  only on screen in a visible tab; `prefers-reduced-motion` shows its final step, still. A root
  test checks every script's timing. Data is invented: never use real data.
- **Installer**: [`public/install`](public/install) (`curl -fsSL https://wherdr.dev/install | sh`);
  `sh tests/install.test.sh` runs shellcheck and its tests in a throwaway container with stub
  `docker` and `herdr` binaries. The install section replays its output: if the installer's
  output changes, update `app/utils/installDemo.ts` (a root test checks its lines against
  `public/install`).
