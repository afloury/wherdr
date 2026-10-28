# Board tutorial, episode 01

A private 60-second, 1080×1920 tutorial: find a task that needs you and inspect its context.
The English narration uses ElevenLabs `matilda` / `elevenlabs/eleven-v4-turbo` through
OpenRouter. Only synthesis input says `where-der`; captions and visuals say `wherdr`.

Use Python 3, Node 22, Herdr, FFmpeg with libass, and the root npm dependencies / Playwright
Chromium. Build the app with `flock /tmp/wherdr-heavy.lock npm run build`.
Set `TUTORIAL_OUT` to a fresh private artifact directory and `TUTORIAL_BUILD` to the built
checkout. Set `TMPDIR` to your private scratch directory. Copy `storyboard.json` into
`TUTORIAL_OUT`. Keep secrets out of logs and files; provide `OPENROUTER_API_KEY` only in
the narration process environment. Set `TUTORIAL_BROWSER` only to reuse an installed browser.

```sh
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/session.py
python3 tools/tutorial-board/narrate.py
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/render.py
python3 tools/tutorial-board/test_timing.py
python3 tools/tutorial-board/verify.py
```

Capture owns a disposable `hwtest-video-*` session, rejects a default session and stops
its own processes on exit. Only fictional Board GET fixtures are substituted; all writes
and external browser requests are blocked. No approval, reply or agent command is sent.
Source PNG hashes live in `capture.json`. The film edits those captures with camera moves,
a pointer, highlights and fades; it is an edited tutorial, not a continuous live recording.
`timeline.json` records shot and narration timings. Original WAVs remain untouched.

The renderer downloads Archivo, Inter and JetBrains Mono from Google Fonts with their OFL
licenses, keeps the selected voice at its original speed, and generates English captions.
To update one shot, recapture its PNG and hash or delete its WAV before regenerating it.
The private output is `wherdr-board-tutorial.mp4`; do not publish it without approval.
