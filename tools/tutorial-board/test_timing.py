import unittest
from timing import plan_frames

class TimingTests(unittest.TestCase):
    def test_actual_narration_fits_exactly_one_minute(self):
        durations = [5.44, 8.96, 7.12, 7.6, 7.68, 7.36, 5.12]
        frames = plan_frames(durations)
        self.assertEqual(sum(frames), 1800)
        for count, spoken in zip(frames, durations):
            self.assertGreater(count / 30 - .55, spoken)

    def test_rounding_and_other_frame_rates(self):
        self.assertEqual(sum(plan_frames([4.123, 7.89, 12.121], fps=24)), 1440)

    def test_invalid_or_overlong_audio_is_rejected(self):
        for durations in [[], [0], [-1], [float('nan')], [float('inf')], [60], [58, 1]]:
            with self.subTest(durations=durations), self.assertRaises(ValueError):
                plan_frames(durations)


class CaptionTests(unittest.TestCase):
    def test_phrases_preserve_measured_boundaries_and_every_word(self):
        from timing import phrase_captions
        texts = 'Read the description, then check the question.'.split()
        words = [dict(text=text, start=i*.31, end=i*.31+.2) for i,text in enumerate(texts)]
        phrases = phrase_captions(words, limit=24)
        self.assertEqual([w for p in phrases for w in p['words']], words)
        for phrase in phrases:
            self.assertEqual(phrase['start'], phrase['words'][0]['start'])
            self.assertEqual(phrase['end'], phrase['words'][-1]['end'])
            self.assertLessEqual(len(phrase['text']), 24)

    def test_character_limit_does_not_leave_an_orphan_word(self):
        from timing import phrase_captions
        words = [dict(text=w, start=i, end=i+1) for i,w in enumerate(
            'Understand the next step and let the rest keep moving.'.split())]
        phrases = phrase_captions(words)
        self.assertGreater(len(phrases[-1]['words']), 2)
        self.assertEqual([w for p in phrases for w in p['words']], words)

    def test_desktop_frame_budget(self):
        self.assertEqual(sum(plan_frames([5.44,8.96,7.12,7.6,7.68,7.36,5.12], fps=60)), 3600)

if __name__ == '__main__':
    unittest.main()
