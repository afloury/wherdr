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
