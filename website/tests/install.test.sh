#!/bin/sh
# Tests public/install in a throwaway Alpine container with stub `docker` and
# `herdr` binaries: never on the host, never with the real Docker daemon.
#   sh tests/install.test.sh            (from website/, needs Docker)
# Also runs shellcheck (koalaman/shellcheck-alpine) when the image is available.
set -eu
cd "$(dirname "$0")/.."

if docker image inspect koalaman/shellcheck-alpine:stable >/dev/null 2>&1 \
  || docker pull -q koalaman/shellcheck-alpine:stable >/dev/null 2>&1; then
  docker run --rm -v "$PWD/public/install:/install:ro" koalaman/shellcheck-alpine:stable shellcheck -s sh /install
  echo "shellcheck: ok"
else
  echo "shellcheck: image unavailable, skipped"
fi

docker run --rm -i --cpus=1 -v "$PWD/public/install:/opt/install:ro" -v "$PWD/tests/install-cases.sh:/opt/cases.sh:ro" \
  node:22-alpine sh /opt/cases.sh
