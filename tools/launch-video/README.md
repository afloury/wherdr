# wherdr launch recording

A 15-second recording of **the actual wherdr app**, built from `origin/main` in its
existing `app/demo` mode. All agent data is fictional; the components, styles, forms,
conversation, approval, Project panel and Board are the real app. The native DEMO
banner remains visible. No interface is redrawn, no hand/cursor/tap graphic is added,
and no app CSS or DOM is changed for filming.

## Rebuild

Requires Node.js 22, the repository's locked dependencies, Chromium from Playwright,
and FFmpeg/ffprobe with H.264, animated WebP and drawtext support. Use the host's shared
lock for each heavy operation; no Docker or system installation is needed.

```sh
flock /tmp/wherdr-heavy.lock nice -n 15 npm ci
# Only if Chromium is not already in Playwright's user cache:
npx playwright install chromium
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/render.mjs
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/review.mjs
```

`render.mjs` checks that `app/` and `nuxt.config.ts` match `origin/main`, builds with
`npm run build:demo`, captures the real controls with Playwright, then encodes the
recording with FFmpeg. `--skip-build` reuses the existing demo build during editing;
`--reuse-captures` only re-encodes a completed recording. Neither flag is needed for
a clean rebuild. HyperFrames and the former HTML reconstruction have been removed.

The demo is served only on loopback, on a free port from 7690 to 7699. Its existing
in-browser backend handles every agent request. External requests and real API
requests are refused. The static server and the single browser close in `finally`,
including on failure. No Herdr session or installed wherdr server is used.

## Shots

| Time | Actual app interaction |
| --- | --- |
| 0–1.2 s | Desktop 1440×900: the real New agent form, with a first message |
| 1.2–2.4 s | Click Launch; the new Claude conversation opens and starts working |
| 2.4–4.8 s | Resize the same page to 390×844; same agent and message, then its permission request |
| 4.8–10 s | Select the native Yes option; the demo agent runs its script and reports 162 tests passed |
| 10–12 s | Open the existing coordinator's Project panel and Tasks tab |
| 12–15 s | Return to desktop and open the app's four-column Board |

The browser clock makes the demo's existing scripted responses reproducible. Reduced
motion is the browser's accessibility preference, also disabling the app's typing
animation. All actions are real clicks on the unmodified app. The handoff uses one
page and one demo session, with no reload. `capture.json` records the exact main
commit, app Git tree, actions, viewport and SHA-256 of every captured frame.

The camera captures 225 instants at 15 fps. Each is duplicated for the 30 fps MP4s.
The 720 px WebP samples those same instants; its encoder coalesces identical holds.
FFmpeg only scales/pads the actual screenshots and adds short captions **outside**
their bounds. In the wide mobile shot, the last PC screenshot stays on the left;
the live phone capture is on the right. There is no fake phone bezel or app panel.
The current demo has one machine; this recording does not invent a second machine.

## Outputs and review

- `assets/wherdr-launch.mp4`: square 1080×1080, silent H.264, 30 fps.
- `assets/wherdr-launch-wide.mp4`: 1920×1080, silent H.264, 30 fps.
- `assets/wherdr-launch.webp`: 720×720, infinite loop, sampled at 15 fps.

`verify.mjs` checks the capture provenance, all 225 frame records, codecs, dimensions,
15-second duration, MP4 frame counts, absence of audio, fast start, WebP loop and size.
It runs after rendering; run it alone with `node tools/launch-video/verify.mjs`.

`review.mjs` extracts every distinct instant from both MP4s into 15 numbered contact
sheets under `.shots/real-review/sheet-01.jpg` through `sheet-15.jpg`, plus full-size
key frames. Inspect every sheet and the key frames before committing/pushing. The
225 source screenshots remain under `tools/launch-video/.generated/` (ignored).
Exact pixels and encoded bytes can vary with browser/FFmpeg versions.
