import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('media', Path(__file__).with_name('media-tools.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaTest(unittest.TestCase):
    def test_timestamp_carries_milliseconds(self):
        self.assertEqual(media.timestamp(59.9998), '00:01:00,000')
        self.assertEqual(media.timestamp(3661.25, '.'), '01:01:01.250')

    def test_output_stays_under_current_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            self.assertEqual(media.contained(root/'out', root), root/'out')
            with self.assertRaises(ValueError):
                media.contained(root.parent/'escape', root)
            (root/'link').symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(ValueError):
                media.contained(root/'link'/'escape', root)

    def test_subtitles_reject_empty_invalid_and_overlapping_cues(self):
        valid = [{'start':0.,'end':1.2,'text':'測試'}]
        media.validate_cues(valid, 2.)
        for cues in [[], [{'start':0.,'end':1.,'text':''}],
                     [{'start':0.,'end':3.,'text':'越界'}],
                     [{'start':0.,'end':1.,'text':'一'}, {'start':.5,'end':2.,'text':'二'}]]:
            with self.subTest(cues=cues), self.assertRaises(ValueError):
                media.validate_cues(cues, 2.)

    def test_online_speech_requires_explicit_flag(self):
        with self.assertRaises(ValueError):
            media.speak(Path('private.txt'), Path('.'), allow_online=False)

    def test_youtube_url_validation(self):
        media.youtube_url('https://www.youtube.com/shorts/OJaC8516n6Q')
        media.youtube_url('https://youtu.be/OJaC8516n6Q')
        for url in ['file:///etc/passwd','https://youtube.com.evil.test/x','http://127.0.0.1/',
                    'https://user:password@youtube.com/watch?v=test']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                media.youtube_url(url)


if __name__ == '__main__': unittest.main()
