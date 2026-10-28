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

if __name__ == '__main__':
    unittest.main()
