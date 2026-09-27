# herdr-web (Nuxt 4) : construit dans node:22-alpine, image finale = .output seul.
FROM node:22-alpine AS build
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
# Machines distantes (profils SSH de Herdr) : client OpenSSH. ssh prend le
# dossier personnel dans /etc/passwd (pas dans $HOME) pour ~/.ssh/config, la clé
# et known_hosts : l'utilisateur wherdr reçoit l'UID/GID et le home de l'hôte,
# monté en lecture seule au même chemin (cf. docker-compose.yml, build.args).
ARG HOST_HOME=/home/node
ARG PUID=1000
ARG PGID=1000
# git : vue « Changements » des agents locaux (lecture seule).
RUN apk add --no-cache openssh-client git \
 && deluser node \
 && addgroup -g "$PGID" wherdr \
 && adduser -D -u "$PUID" -G wherdr -h "$HOST_HOME" wherdr
# Arrêt rapide (docker stop, redémarrage) : les WebSockets ouvertes ne retiennent pas
# le serveur 30 s ; les clients se reconnectent tout seuls.
ENV NODE_ENV=production PORT=7683 NITRO_SHUTDOWN_TIMEOUT=1500
COPY --from=build /app/.output ./.output
USER wherdr
EXPOSE 7683
CMD ["node", ".output/server/index.mjs"]
