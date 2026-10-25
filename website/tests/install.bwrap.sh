#!/bin/sh
# Runs the installer cases (install-cases.sh) in a bubblewrap
# sandbox, as the current user: a root of its own (the system's /usr and /etc
# read-only, Node.js hidden from /usr/bin), an empty /home with /home/alice,
# fresh /tmp, /srv, /stubs, /opt and /usr/local/bin, and no network. The real
# home folder, Herdr and wherdr are never reachable from inside.
#   sh tests/install.bwrap.sh            (from website/, needs bwrap)
set -eu
cd "$(dirname "$0")/.."
command -v bwrap >/dev/null 2>&1 || { echo "bwrap (bubblewrap) is needed: install bubblewrap first." >&2; exit 2; }
node="$(command -v node)" || { echo "node is needed (the cases run it as Node.js 22)." >&2; exit 2; }

R="$(mktemp -d)"
trap 'rm -rf "$R"' EXIT INT TERM
mkdir -p "$R/home/alice" "$R/srv" "$R/stubs" "$R/opt" "$R/ulb" "$R/usrbin"
cp public/install "$R/opt/install"
cp tests/install-cases.sh "$R/opt/cases.sh"
# /usr/bin without node: links to the real one, mounted at /realbin.
for f in /usr/bin/* /usr/bin/.[!.]*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  n="$(basename "$f")"
  case "$n" in node|nodejs|npm|npx|corepack|bun|bunx) continue ;; esac
  ln -s "/realbin/$n" "$R/usrbin/$n"
done
# Node.js 22 where the cases expect it.
printf '#!/bin/sh\nexec /realnode "$@"\n' > "$R/ulb/node"
chmod 755 "$R/ulb/node"

set -- --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind /usr/bin /realbin --bind "$R/usrbin" /usr/bin \
  --ro-bind "$(readlink -f "$node")" /realnode \
  --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib
[ ! -e /lib64 ] || set -- "$@" --symlink usr/lib64 /lib64
set -- "$@" --ro-bind /etc /etc --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$R/home" /home --bind "$R/srv" /srv --bind "$R/stubs" /stubs --bind "$R/opt" /opt \
  --bind "$R/ulb" /usr/local/bin --setenv HOME /home/alice --setenv CASES_SELF 1 \
  --setenv PATH /usr/local/bin:/usr/bin:/bin --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY \
  --unsetenv SSH_CONNECTION --unsetenv SSH_TTY --chdir /
bwrap "$@" sh /opt/cases.sh
