"""Derive phrase captions from the original WAVs using local word timestamps.

Install faster-whisper in an isolated environment. Models and cache stay in TUTORIAL_OUT.
Inspect alignment.json against the audio before rendering; never estimate by word count.
"""
import json, os, pathlib, re, subprocess
import numpy as np
from faster_whisper import WhisperModel
from timing import phrase_captions
root = pathlib.Path(os.environ['TUTORIAL_OUT'])
model = WhisperModel('small.en', device='cpu', compute_type='int8', cpu_threads=2,
                     download_root=str(root / 'models'))
result = {}
for shot in json.loads((root / 'storyboard.json').read_text())['segments']:
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(root / (shot['id'] + '.wav')), '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'])
    segments, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32),
                                   word_timestamps=True, beam_size=5,
                                   initial_prompt='wherdr, pronounced where-der. Board. Needs you.')
    words = [dict(text=w.word.strip(), start=round(w.start, 3), end=round(w.end, 3))
             for segment in segments for w in segment.words]
    for word in words:
        word['text'] = re.sub(r'(?i)\b(?:weirder|where-der)\b', 'wherdr', word['text'])
    result[shot['id']] = phrase_captions(words)
    (root / 'alignment.json').write_text(json.dumps(result, indent=2))
    print(shot['id'], result[shot['id']], flush=True)
