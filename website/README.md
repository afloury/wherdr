# wherdr.dev

The public website of wherdr: a static Nuxt 4 + Nuxt UI 4 site in the app's "wherdr Titanium"
look, and the one-line installer served at `/install`. Fonts, icons and screenshots are bundled:
the page makes no request to another site.

- **Develop**: `npm ci && npm run dev` (http://localhost:3000).
- **Build**: `npm run generate` → static files in `.output/public/` (`npm run typecheck` checks the types).
- **Deploy (private)**: `SITE_BIND=<tailscale-ip> docker compose up -d --build` — nginx on
  `${SITE_BIND:-127.0.0.1}:${SITE_PORT:-8120}`, `/install` served as `text/plain`.
- **Installer**: [`public/install`](public/install) (`curl -fsSL https://wherdr.dev/install | sh`);
  `sh tests/install.test.sh` runs shellcheck and its tests in a throwaway container with stub
  `docker` and `herdr` binaries.
- **Screenshots** (`public/shots/`): taken from the fictional demo set (Herdr session `hwtest` in
  a container, invented projects and conversations) in the wherdr Titanium theme. Never use real
  data.
