import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime_tools', Path(__file__).with_name('runtime-tools.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeToolsTest(unittest.TestCase):
    def test_company_home_is_not_inferred_from_caller_paths(self):
        with self.assertRaises(ValueError): runtime.managed_root({})
        with self.assertRaises(ValueError): runtime.managed_root({'PAPERCLIP_COMPANY_ID':'11111111-1111-4111-8111-111111111111','CODEX_HOME':'/tmp/other-company/home'})

    def test_rejects_unknown_recipe_and_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for recipe, revision in [('shell','a'*16),('media','../x')]:
                with self.assertRaises(ValueError): runtime.safe_version(root,recipe,revision)

    def test_refuses_symlinked_dependency_path(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            (root/'media').symlink_to('/tmp')
            with self.assertRaises(ValueError): runtime.safe_version(root,'media','a'*16)

    def test_atomic_activation_and_rollback_pointer_preserve_versions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for revision in ('a'*16,'b'*16):
                version=runtime.safe_version(root,'media',revision); version.mkdir(parents=True)
                (version/'verified.json').write_text('{}')
            runtime.activate(root,'media','a'*16,None)
            runtime.activate(root,'media','b'*16,'a'*16)
            self.assertEqual(runtime.active(root,'media')['previous'],'a'*16)
            runtime.activate(root,'media','a'*16,'b'*16)
            self.assertEqual(runtime.active(root,'media')['revision'],'a'*16)
            self.assertTrue(runtime.safe_version(root,'media','b'*16).exists())

    def test_unverified_revision_cannot_be_activated_for_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve(); (root/'media').mkdir()
            runtime.activate(root,'media','a'*16,None)
            with self.assertRaises(ValueError): runtime.active(root,'media')


if __name__=='__main__': unittest.main()
