#!/bin/sh
# Generic image: the container user is created at startup with the UID/GID
# (PUID/PGID) and home directory (HOME) of the host user. ssh reads
# ~/.ssh from /etc/passwd (not from $HOME), hence this entry rather than a plain `user:`.
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
  # An image account that already has this UID (e.g. 1000): removed.
  other=$(getent passwd "$PUID" | cut -d: -f1)
  [ -n "$other" ] && deluser "$other" 2>/dev/null || true
  # -H: the home directory is the host's, mounted (read-only).
  adduser -D -H -u "$PUID" -G "$group" -h "$HOME" -s /bin/sh wherdr
  export HOME
  exec su-exec wherdr "$@"
fi
# Already started as another user (`user:` in compose): run as is.
exec "$@"
