# wherdr launch film

A 15-second, silent HTML/CSS + GSAP composition rendered by **HyperFrames 0.8.169**.
All conversations, project names, thread IDs and machines are fictional. This is a redrawn
product animation, not a recording of a live Herdr session. No app server or agent is contacted.

## Rebuild

Requires Node.js ≥ 22, FFmpeg with H.264 and animated WebP support, and Chromium.
Install only the isolated tooling dependencies; there is no need to install/build wherdr:

```sh
npm ci --prefix tools/launch-video --ignore-scripts
# Optional: reuse a Chromium installation instead of HyperFrames' managed browser.
export HYPERFRAMES_BROWSER_PATH=/path/to/chrome-headless-shell
nice -n 15 node tools/launch-video/render.mjs
```

On a shared development host, put both installation and rendering under its shared lock:

```sh
flock /tmp/wherdr-heavy.lock nice -n 15 npm ci --prefix tools/launch-video --ignore-scripts
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/render.mjs
```

The script reuses Linux Playwright headless Chromium if present in its normal cache; otherwise
HyperFrames manages Chromium (`npx --prefix tools/launch-video hyperframes browser --help`).
No global packages, Docker, system installs, music or external media services are needed.
Fonts and GSAP come from the lockfile; the app logo is copied into an ignored staging folder.
HyperFrames telemetry and update checks are disabled. One browser worker renders each cut in
sequence with the low-memory profile and a 1 GiB Node heap. Close preview tools before rendering.

Outputs (relative to the repository root):

| File | Format | Size |
| --- | --- | --- |
| `assets/wherdr-launch.mp4` | 1080 × 1080, H.264, 30 fps, silent | ~0.55 MiB |
| `assets/wherdr-launch.webp` | 720 × 720, 15 fps, infinite loop; README preview | ~0.44 MiB |
| `assets/wherdr-launch-wide.mp4` | 1920 × 1080, H.264, 30 fps, silent; X / YouTube | ~0.65 MiB |

`verify.mjs` runs automatically after rendering. It checks dimensions, codecs, duration,
frame counts, absence of audio, MP4 fast start, WebP loop and file-size limits. Run it alone
with `node tools/launch-video/verify.mjs`. Exact encoded bytes can vary with browser/FFmpeg
versions; the timeline and frame count are fixed.

## Story and editing

| Time | Shot | Copy |
| --- | --- | --- |
| 0–1.5 s | Start Claude Code in the desktop browser; Checkout opens beside working agents | Start on PC. Keep going. |
| 1.5–2.2 s | The browser reshapes into a phone, preserving the conversation | Step away. Stay in control. |
| 2.7–6.4 s | Agent asks to run checkout tests; thumb approves; agent continues | Same agent. Same conversation. |
| 6.4–9.3 s | Web shop project: threads, tasks and a Tested action | Keep work moving. |
| 9.3–12.1 s | Studio and Server agents together, with working/ready states | Every machine. One view. |
| 12.1–15 s | Product name, promise and wherdr.dev | Step away. Stay in control. |

`index.html` is the scene; `style.css` mirrors Titanium tokens and uses the app's Archivo,
Inter and JetBrains Mono families. `timeline.js` registers a paused, seekable GSAP timeline
for HyperFrames. The handoff animates the **same conversation DOM** into a mobile layout,
with no reload, new conversation or fabricated synchronization feature. The hand is a simple
original vector drawing. Only device hardware is rounded; app panels keep square corners.
The wide cut recomposes the layout rather than cropping the square.

Generate review stills in both formats without rendering the films:

```sh
flock /tmp/wherdr-heavy.lock nice -n 15 node tools/launch-video/render.mjs --stills
```

They land in `.shots/launch-video/` and `.shots/launch-video-wide/` (ignored).
For interactive editing, use `cd tools/launch-video && npx hyperframes preview --no-open`;
stop the preview when finished. Run the build or `--stills` once first to stage the logo.

Tone references: [herdr-projects hero](https://github.com/eliasstravik/herdr-projects/pull/139)
and [herdr-voice](https://github.com/brogrammerMW/herdr-voice): dark grid, agent statuses,
short headlines and a product action. No footage, music or source code was copied from them.
