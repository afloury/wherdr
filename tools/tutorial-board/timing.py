"""Frame-accurate shot timing with room for the narration lead-in."""
import math

def plan_frames(durations, fps=30, total=60):
    if not durations or any(not math.isfinite(d) or d <= 0 for d in durations):
        raise ValueError('Narration durations must be finite and positive')
    padding = (total - sum(durations)) / len(durations)
    if padding < .75:
        raise ValueError('Shorten the narration; do not speed up the selected voice')
    frames = [round((duration + padding) * fps) for duration in durations]
    frames[-1] += round(total * fps) - sum(frames)
    return frames


def phrase_captions(words, limit=50):
    """Keep measured word boundaries while breaking captions at readable phrases."""
    import re
    phrases, pending = [], []
    for word in words:
        if word['end'] < word['start']:
            raise ValueError('Word timestamps must have nonnegative duration')
        if pending and len(' '.join(w['text'] for w in pending + [word])) > limit:
            phrases.append(pending)
            pending = []
        pending.append(word)
        text = ' '.join(w['text'] for w in pending)
        if re.search(r'[.!?]$', text) or (len(text) >= 20 and re.search(r'[,;:]$', text)):
            phrases.append(pending)
            pending = []
    if pending:
        phrases.append(pending)
    # Avoid an orphan word caused by the character limit, preserving every timestamp.
    for i in range(1, len(phrases)):
        before, after = phrases[i-1], phrases[i]
        while (len(' '.join(w['text'] for w in after)) < 18 and len(before) > 4
               and not re.search(r'[.!?]$', before[-1]['text'])):
            after.insert(0, before.pop())
    return [dict(start=p[0]['start'], end=p[-1]['end'],
                 text=' '.join(w['text'] for w in p), words=p) for p in phrases]
