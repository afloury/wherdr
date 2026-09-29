#!/bin/sh
# Image générique : l'utilisateur du conteneur est créé au démarrage avec l'UID/GID
# (PUID/PGID) et le dossier personnel (HOME) de l'utilisateur de l'hôte. ssh lit
# ~/.ssh dans /etc/passwd (pas dans $HOME), d'où cette entrée plutôt qu'un simple `user:`.
set -e
if [ "$(id -u)" = 0 ]; then
  PUID=${PUID:-1000}
  PGID=${PGID:-1000}
  HOME=${HOME:-/home/wherdr}
  [ "$HOME" = /root ] && HOME=/home/wherdr
  deluser wherdr 2>/dev/null || true
  delgroup wherdr 2>/dev/null || true
  group=$(getent group "$PGID" | cut -d: -f1)
  if [ -z "$group" ]; then addgroup -g "$PGID" wherdr; group=wherdr; fi
  # Un compte de l'image qui aurait déjà cet UID (ex. 1000) : retiré.
  other=$(getent passwd "$PUID" | cut -d: -f1)
  [ -n "$other" ] && deluser "$other" 2>/dev/null || true
  # -H : le dossier personnel est celui de l'hôte, monté (en lecture seule).
  adduser -D -H -u "$PUID" -G "$group" -h "$HOME" -s /bin/sh wherdr
  export HOME
  exec su-exec wherdr "$@"
fi
# Déjà lancé sous un autre utilisateur (`user:` dans compose) : tel quel.
exec "$@"
