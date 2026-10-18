# wherdr launch film

A silent 15-second marketing animation: big Archivo headlines, Titanium grid,
zooming desktop screenshots, an animated PC-to-phone handoff, one-tap approval,
Project tasks, Board, and a wherdr.dev end card. The square cut is 1080×1080; the
wide cut reflows the composition to 1920×1080. Both are H.264 at 30 fps.
The README uses an infinitely looping 720×720 animated WebP sampled at 15 fps.

Every app screen is an **unaltered Playwright screenshot of the real demo build**.
There are no recreated app controls, hand or finger. A brief blue outline around
the real Yes button is part of the marketing stage. Transitions between captured
states are edited for launch-film pacing; this is not a continuous screen recording.
The demo data is fictional and no actual agent command runs.

## Rebuild

Use Node 22, FFmpeg/ffprobe and Playwright Chromium. Install the root dependencies
and this directory's pinned animation dependencies (`npm ci --prefix tools/launch-video`).
On a shared host, hold the heavy-job lock and use low priority:

```sh
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/render.mjs
```

The script checks that `app/` and `nuxt.config.ts` match `origin/main`, builds
`npm run build:demo`, captures actual interactions, verifies every source PNG's
SHA-256, then renders the HTML/GSAP stage with HyperFrames 0.8.169 (one worker,
low-memory mode, no GPU). FFmpeg adds source metadata and makes the WebP.
Use `--skip-build` after building the demo, or `--reuse-captures` to recompose
verified screenshots already in `.generated/`. `--stills --reuse-captures` previews
both layouts without encoding the videos. Rendering closes its browser on exit.

`capture.json` records the source main commit, app tree, routes, actual interaction
times, viewports and hashes of all 225 raw screenshots. It describes the source
recording; `timeline.js` defines the shorter edited shot holds in the final film.
The desktop launch and phone conversation are the same page/session, resized
without reloading. Only loopback requests are allowed during capture.

```sh
node tools/launch-video/verify.mjs
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/review.mjs
```

The verifier checks provenance, silent H.264, dimensions, duration, frame count,
fast-start metadata, file-size budgets and WebP loop/duration. The review script
extracts **all 450 output frames in both cuts**, in numbered contact sheets, plus
four full-resolution key images. Review the sheets and key images before publishing.

Outputs replace `assets/wherdr-launch{,-wide}.mp4` and `assets/wherdr-launch.webp`.
Sources use local fonts and assets; telemetry and update checks are disabled.
