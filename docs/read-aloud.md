# Read aloud: the voice of wherdr

[Documentation](README.md) · [Project](../README.md)

**Voice of wherdr (on this device)** reads replies with a neural voice that runs on the phone:
the text never leaves the device. It is chosen in **Settings › Conversation › Read aloud**, next
to Off and the device's own voices. How the engine works (worker, streaming, memory marks) is in
[Dictation design › Read aloud](dictation.md#read-aloud).

## Voices

| Voice | Language | Download | Licence | Attribution shown |
| --- | --- | --- | --- | --- |
| Siwis (`fr_FR-siwis-medium`) | French, default | 64 MB | CC BY 4.0 ([SIWIS database](https://doi.org/10.7488/ds/1705)) | Yes, required: the SIWIS French Speech Synthesis Database by Pierre-Edouard Honnet, Philip Garner and Alexandros Lazaridis (University of Edinburgh, CSTR) |
| Cori (`en_GB-cori-medium`) | English (UK), default | 64 MB | Public domain (LibriVox recordings, [voice page](https://brycebeattie.com/files/tts/)) | Yes, as a courtesy: Bryce Beattie |
| MLS (`fr_FR-mls-medium`) | French, fallback, not offered in Settings | 78 MB | CC BY 4.0 ([MLS](https://openslr.org/94/)) | In the catalog: Vineel Pratap et al. (Meta AI) |

Each row of the setting shows its attribution, read from `app/utils/speech/voices.json`. The
voices are Piper models packaged by sherpa-onnx. A voice is fetched by the wherdr server (sets
`tts-siwis-medium`, `tts-cori-medium`, `tts-mls-medium`, see
[On-device dictation files](installation.md#on-device-dictation-files)) and installed on the
device from there.

## Licences of the engine

| Part | Licence | Where |
| --- | --- | --- |
| sherpa-onnx (WASM runtime and `sherpa-onnx-tts.js`) | Apache 2.0 | runtime set, shared with dictation |
| ONNX Runtime (inside the WASM) | MIT | same |
| espeak-ng (phonemizer, inside the WASM) and its `espeak-ng-data` | GPL 3.0 or later | same, and each voice's `espeak-ng-data/` |
| Piper voice models | per voice, above | the voice sets |

### espeak-ng

Piper voices are fed phonemes, not letters: sherpa-onnx turns the text into phonemes with
espeak-ng, compiled into its WASM build, and reads the language rules from `espeak-ng-data/`
(trimmed to French and English, about 0.9 MB, part of each voice). espeak-ng is GPL 3.0 or
later. wherdr does not bundle these files: the server downloads them unchanged from their
pinned upstream sources (a sherpa-onnx WASM build matching releases 1.12.34 to 1.12.40, each file checked by sha256) and serves them to the
device. Their source is [espeak-ng](https://github.com/espeak-ng/espeak-ng) and
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). The choice for now is to keep this pinned
1.12.x runtime with espeak-ng; a runtime without a GPL phonemizer would need a different
phonemizer and new voices.

## Measurements

The catalog keeps what a voice was measured to take on a phone, as dictation models do:

| Field | Meaning |
| --- | --- |
| `memory` | `{ heap, speaking, basis }`: WASM heap after load and while speaking, in bytes, and how it was measured |
| `speed` | `{ rtf, basis }`: real-time factor, time to generate speech divided by its length (below 1 is faster than speech) |

**Memory budget.** A voice is used only when it fits: `heapNeeded()` (`neuralVoice.ts`) takes
the larger of the measured `memory.heap` and `memory.speaking`, and, until a voice is measured,
an estimate of three times its files (about 190 MB for Siwis or Cori). It is checked against
the device budget of dictation, `memoryBudget()`: 640 MiB of heap on iOS and iPadOS, a quarter
of `navigator.deviceMemory` elsewhere. A voice over it shows **Too large for this device** and
its replies use the device's voices. The worker also reports its real heap once loaded, and a
voice that goes over the budget then is stopped and marked too large.

**Not measured yet.** No voice has phone figures in the catalog yet. The study's figures for an
iPhone 13 (Siwis, fp32) are **estimates**, not measurements:

| What | Estimate, iPhone 13 |
| --- | --- |
| Download | about 64 MB |
| First load (runtime, files, model) | about 0.7 to 1.5 s |
| First sentence (after the load) | about 0.3 to 0.5 s |
| Real-time factor | about 0.15 to 0.25 |
| Memory while speaking | about 150 to 250 MB |
| Memory after release | about 0 (the worker is closed, its heap goes back to the system) |

### How to measure

1. On the phone, open **Settings › Conversation › Read aloud**, choose **Voice of wherdr**, and
   install the voice. The row then shows the download time.
2. Tap **Test** right after a reload (cold start). When it ends, the row shows **Load** (the
   worker: runtime, files and model), **First sentence** (tap to the first audio), **Real-time
   factor** and **Heap** (the largest WASM heap seen). A second Test gives the warm figures.
3. For the page's memory while speaking and after release (the worker is closed 60 s after the
   last speech), use Safari's Web Inspector (Timelines › Memory) with the phone plugged into a
   Mac.
4. Record the figures in the voice's `memory` and `speed` in `voices.json`, with a `basis` that
   names the device and the date, and replace the estimates above.
