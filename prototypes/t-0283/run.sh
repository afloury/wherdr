#!/bin/sh
# t-0283 mock-ups (throwaway): runs a script of this folder in the Playwright image, one heavy step at a time.
cd "$(dirname "$0")/../.." && exec flock /tmp/wherdr-heavy.lock docker run --rm --name hp-t-0283-pw --cpus=2 --ipc=host -u 1000:1000 -e HOME=/tmp -e REC -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.63.0-noble node "prototypes/t-0283/$@"
