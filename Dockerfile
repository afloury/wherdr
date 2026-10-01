# wherdr (Nuxt 4): built in node:22-alpine, final image = .output only.
# Generic image (published on ghcr.io, see .github/workflows/release.yml; source and
# revision added by the workflow):
# the user, their UID/GID and home directory are set at startup
# (scripts/docker-entrypoint.sh, PUID, PGID and HOME variables of docker-compose.yml).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts skipped: `nuxt prepare` (postinstall) needs the
# sources, copied right after; `nuxt build` runs it again anyway.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
# The Pi has 4 GB of RAM: cap the Node heap during the build.
RUN NODE_OPTIONS=--max-old-space-size=1800 npm run build

FROM node:22-alpine
WORKDIR /app
ARG VERSION=dev
LABEL org.opencontainers.image.title="wherdr" \
      org.opencontainers.image.description="Mobile web client (PWA) to drive the coding agents running in Herdr" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
# openssh-client: remote machines (Herdr SSH profiles); git: "Changes" view
# (read-only); su-exec: switch to the host user at startup.
RUN apk add --no-cache openssh-client git su-exec \
 && deluser node
# Fast shutdown (docker stop, restart): open WebSockets do not hold the
# server for 30 s; clients reconnect on their own. WHERDR_INSTALL: update
# command offered in the app (docker-compose.build.yml replaces it).
ENV NODE_ENV=production PORT=7683 NITRO_SHUTDOWN_TIMEOUT=1500 WHERDR_INSTALL=docker
COPY --from=build /app/.output ./.output
COPY scripts/docker-entrypoint.sh /usr/local/bin/wherdr-entrypoint
EXPOSE 7683
ENTRYPOINT ["wherdr-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
