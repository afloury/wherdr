# Board tutorial, episode 01

Private 60-second desktop tutorial, 1920×1080, constant 60 fps, H.264/AAC.
Matilda's original English WAVs are preserved at their original speed. Synthesis says
`where-der`; captions say `wherdr`. No secret is needed when reusing the WAVs.

Use Node 22, root npm dependencies / Playwright Chromium, Python 3, FFmpeg with libass,
and a separate Python environment with `pip install -r tools/tutorial-board/requirements.txt`
for local alignment.
Build with `flock /tmp/wherdr-heavy.lock npm run build`. Set `TUTORIAL_OUT` to a private
artifact directory and `TUTORIAL_BUILD` to the built checkout. Keep all caches and models
in that private directory. Copy `storyboard.json` there and restore the original WAVs
from the private review download. `TUTORIAL_BROWSER` optionally selects installed Chromium.

```sh
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/session.py
python3 tools/tutorial-board/align.py
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/render.py
python3 tools/tutorial-board/test_timing.py
python3 tools/tutorial-board/verify.py
```

Capture owns and removes a disposable `hwtest-video-*` session, never the default session.
Only fictional Board GET fixtures are substituted; writes and external browser requests
are blocked. The actual desktop UI uses its collapsed list and Global grouping. The CSS
viewport is 1280×720 at 1.5 device scale, producing native 1920×1080 PNGs. Source hashes
are in `capture.json`. No personal task, conversation or credential enters the film.

The camera is locked to eliminate drift and retain text clarity. One minimum-jerk curved
cursor approach accompanies the task opening, with one brief click mark. The screen
changes once at that click; the pointer fades out. Other shots use direct editorial cuts.
Square rules, Archivo headings, Inter captions and JetBrains Mono labels match the app.
The renderer stores downloaded Google Fonts and their OFL licenses in the artifact folder.

`align.py` computes actual word timestamps locally with small.en. `alignment.json` is the
editable alignment source: review it against the WAVs before rendering. Phrase boundaries
preserve those timestamps; no proportional word-count timing is used. Captions have a
solid dark backing, generous margins and a maximum phrase length of 50 characters.
Set `TUTORIAL_SHOT=outro` to rerender only that shot when all other encoded shots exist.
Audio uses constant gain with peak headroom, followed by explicit silence padding; no
dynamic loudness filter can shift the measured waveform. Use `TUTORIAL_SHOT=audio` to
rebuild only audio and remux the existing shots. The verifier cross-correlates the muxed
audio against each original WAV to check actual caption placement within 10 ms.
`timeline.json` records the narration lead-in and exact frame budgets.

For fresh narration, `narrate.py` still supports Matilda through OpenRouter. Load the key
only into that process environment at invocation; never print or persist it. Delete only
the WAV that needs replacing, then rerun alignment. Never change playback speed to fit.

Output: `wherdr-board-tutorial.mp4`. Review all decoded frames for text, cursor and cuts,
and listen against the timed captions. Share only through a private review page; do not
publish. Preserve the WAVs, alignment, captures, fonts and sources in its download bundle.
