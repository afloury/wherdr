# wherdr (Nuxt 4) : construit dans node:22-alpine, image finale = .output seul.
# Image générique (publiée sur ghcr.io, cf. .github/workflows/release.yml ; source et
# révision ajoutées par le workflow) :
# l'utilisateur, son UID/GID et son dossier personnel sont fixés au démarrage
# (scripts/docker-entrypoint.sh, variables PUID, PGID et HOME de docker-compose.yml).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Scripts d'installation ignorés : `nuxt prepare` (postinstall) a besoin des
# sources, copiées juste après ; `nuxt build` le refait de toute façon.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
# Le Pi a 4 Go de RAM : on borne le tas de Node pendant la construction.
RUN NODE_OPTIONS=--max-old-space-size=1800 npm run build

FROM node:22-alpine
WORKDIR /app
ARG VERSION=dev
LABEL org.opencontainers.image.title="wherdr" \
      org.opencontainers.image.description="Mobile web client (PWA) to drive the coding agents running in Herdr" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
# openssh-client : machines distantes (profils SSH de Herdr) ; git : vue « Changements »
# (lecture seule) ; su-exec : passage à l'utilisateur de l'hôte au démarrage.
RUN apk add --no-cache openssh-client git su-exec \
 && deluser node
# Arrêt rapide (docker stop, redémarrage) : les WebSockets ouvertes ne retiennent pas
# le serveur 30 s ; les clients se reconnectent tout seuls. WHERDR_INSTALL : commande
# de mise à jour proposée dans l'app (docker-compose.build.yml la remplace).
ENV NODE_ENV=production PORT=7683 NITRO_SHUTDOWN_TIMEOUT=1500 WHERDR_INSTALL=docker
COPY --from=build /app/.output ./.output
COPY scripts/docker-entrypoint.sh /usr/local/bin/wherdr-entrypoint
EXPOSE 7683
ENTRYPOINT ["wherdr-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
