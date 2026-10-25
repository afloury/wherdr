#!/bin/sh
# Runs the installer only in the isolated, network-free bubblewrap environment.
set -eu
cd "$(dirname "$0")/.."
if command -v shellcheck >/dev/null 2>&1; then shellcheck -s sh public/install; fi
exec sh tests/install.bwrap.sh
