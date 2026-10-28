# Board tutorial, episode 01

Private desktop tutorial of about one minute: 1920×1080, constant 60 fps, H.264/AAC.
Voice: ElevenLabs Matilda (`eleven-v4-turbo`) through OpenRouter, saying `where-der`;
captions write `wherdr`, `Herdr` and `herdr-projects`.

What the film says: the Board, its tasks, coordinators and project management come from
herdr-projects; wherdr displays that board and makes it easy to use, and also works with
Herdr alone. Keep that attribution when editing `storyboard.json`.

## Pipeline

Use Node 22 with the root npm dependencies and Playwright Chromium, FFmpeg with libass,
and a separate Python 3.12 environment with `pip install -r requirements.txt` (local
speech alignment and frame composition). Build with `flock /tmp/wherdr-heavy.lock npm run build`.
Set `TUTORIAL_OUT` to a private folder (copy `storyboard.json` there) and `TUTORIAL_BUILD`
to the built checkout. `TUTORIAL_BROWSER` optionally selects an installed Chromium.
`TUTORIAL_CAPTURE` optionally selects another episode's capture script, using the
same isolated-session lifecycle. See `../tutorial-intro/` for the introduction.

```sh
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/session.py   # captures
python3 tools/tutorial-board/narrate.py                              # only for new narration
python3 tools/tutorial-board/align.py                                # word timestamps
flock /tmp/wherdr-heavy.lock python3 tools/tutorial-board/render.py    # the film
python3 tools/tutorial-board/test_timing.py && python3 tools/tutorial-board/verify.py
```

**Capture** (`session.py`, `capture.mjs`) starts a disposable `hwtest-video-*` Herdr session
and wherdr instance, never the default session, and removes both afterwards. Only fictional
read-only Board fixtures are served; writes and external requests are blocked. The CSS
viewport is 1920×1080, wide enough for the Board to keep its four columns beside an open
task (asserted), at 2× device scale for sharp 3840×2160 sources. Each screenshot records
the boxes of its named targets in `capture.json`, with source hashes. `content` targets hug
the visible text and controls, so marks keep an even margin.

**Narration** (`narrate.py`). Load the OpenRouter key only into that process environment at
invocation; never print or persist it. The untouched take is kept as `<id>.raw.wav`; pauses
longer than `pause` seconds are shortened in `<id>.wav`. Speech is never sped up or pitched
(the model does not accept a speed setting). Delete a shot's `.raw.wav` to resynthesize it.

**Alignment** (`align.py`) measures word timestamps locally with faster-whisper `small.en`
and puts them on the written `caption` text (`spoken` maps how names sound to how they are
written). Captions break at phrases; no proportional word-count timing is used.

**Composition** (`render.py`) draws every frame in Python and pipes it to FFmpeg, which
burns `captions.ass` and encodes. Shot length follows the narration (`lead_in` + take +
`tail`). Actions in `storyboard.json` are tied to spoken words (exact spelling):

- `output`, `label` and `end_label` at the top level name the film file, the header
  label and the end-card line (the Board episode's values are the defaults).
- `screen` on a segment selects a capture at its start. Without it, the last
  screen remains visible, as in the original Board episode.
- `cursor`: `{to, at, then}` moves the pointer to a target when the word `at` starts,
  on a slight arc with a minimum-jerk speed profile and a Fitts-like duration, clicks
  (brief press and a small ring), then shows the screen `then`. The pointer is a black
  macOS-style arrow with a white keyline and soft shadow, drawn at 4× for subpixel motion.
  It fades out a second after a click and returns where it was before the next move.
- `marks`: `{on, at, until?, pad?}` highlights a target from `at` to `until` (or the shot's
  end). Marks belong to the tutorial, not the app: a yellow rounded ring with a dark keyline
  that draws itself on, and the rest of the UI dimmed (`mark: "spotlight"`; `ring` and
  `marker` are the alternatives that were compared).

The camera stays locked: the whole UI stays sharp and nothing drifts. Screen changes after
a click cross-fade over 7 frames; titles cross-fade between shots. `TUTORIAL_STILLS=12.5,30`
writes PNG stills instead of the film, for frame-level review.

`verify.py` checks the encoded film: format, every frame timestamp, capture hashes, caption
intervals, pace (150 to 175 words per minute), clipping, and cross-correlates the muxed audio
against each take to confirm its placement.

Share the output only through a private review page; do not publish it.
