import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("pages", Path(__file__).with_name("pages-deploy.py"))
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)

class ArchiveBoundary(unittest.TestCase):
    def extract(self, entries):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "job.tar"
            with tarfile.open(source, "w") as archive:
                for name, kind, payload in entries:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    if kind == tarfile.REGTYPE:
                        item.size = len(payload)
                        archive.addfile(item, io.BytesIO(payload))
                    else:
                        item.linkname = "/etc/passwd"
                        archive.addfile(item)
            out = Path(root) / "out"
            pages.extract_static(source, out)
            return (out / "index.html").read_text()

    def test_actual_static_files_roundtrip(self):
        self.assertEqual(self.extract([("index.html", tarfile.REGTYPE, b"preview")]), "preview")

    def test_accept_existing_site_locale_home(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "site.tar"
            with tarfile.open(source, "w") as archive:
                for name, data in [("zh.html", b"website"), ("_redirects", b"/ /zh/ 302\n")]:
                    entry = tarfile.TarInfo(name); entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
            pages.extract_static(source, Path(root) / "out")
            self.assertEqual((Path(root) / "out/zh.html").read_text(), "website")

    def test_locale_navigation_has_static_redirects(self):
        with tempfile.TemporaryDirectory() as root:
            out = Path(root)
            (out / "zh/products").mkdir(parents=True)
            (out / "zh.html").write_text("home")
            (out / "zh/products/mcrm.html").write_text("product")
            (out / "zh/products/mcrm.txt").write_text("rsc")
            (out / "_redirects").write_text("/ /zh/ 302\n/blog/* /zh/blog/:splat 302\n")
            pages.prepare_locale_navigation(out)
            redirects = (out / "_redirects").read_text()
            self.assertIn("/products/mcrm /zh/products/mcrm 302", redirects)
            self.assertIn("/products/mcrm.txt /zh/products/mcrm.txt 302", redirects)
            self.assertIn("/ /zh/ 302\n", redirects)
            self.assertLess(redirects.index("/products/mcrm /zh"), redirects.index("/blog/*"))

    def test_reject_traversal(self):
        with self.assertRaises(ValueError):
            self.extract([("../escape", tarfile.REGTYPE, b"x")])

    def test_reject_absolute_path(self):
        with self.assertRaises(ValueError):
            self.extract([("/etc/escape", tarfile.REGTYPE, b"x")])

    def test_reject_symlink(self):
        with self.assertRaises(ValueError):
            self.extract([("index.html", tarfile.SYMTYPE, b"")])

    def test_reject_hardlink(self):
        with self.assertRaises(ValueError):
            self.extract([("index.html", tarfile.LNKTYPE, b"")])

    def test_reject_worker_execution(self):
        with self.assertRaises(ValueError):
            self.extract([("_worker.js", tarfile.REGTYPE, b"export default {}")])

    def test_reject_config_and_credentials(self):
        for name in [".env", "wrangler.jsonc", "config/.env.local", ".git/config"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.extract([(name, tarfile.REGTYPE, b"x")])

    def test_reject_missing_homepage(self):
        with self.assertRaises(ValueError):
            self.extract([("file.txt", tarfile.REGTYPE, b"x")])

    def test_reject_duplicate_path(self):
        with self.assertRaises(ValueError):
            self.extract([("index.html", tarfile.REGTYPE, b"x"), ("index.html", tarfile.REGTYPE, b"y")])

class QueueBoundary(unittest.TestCase):
    def test_reject_outside_workspace(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "workspace").mkdir()
            (base / "outside").mkdir()
            with self.assertRaises(ValueError):
                pages.submit(base / "outside", base / "workspace")

    def test_reject_linked_assets(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "out").mkdir()
            (base / "out" / "index.html").symlink_to("/etc/passwd")
            with self.assertRaises(OSError):
                pages.submit(base / "out", base)

    def test_real_queue_to_deploy_command(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "out").mkdir()
            (base / "out" / "index.html").write_text("preview")
            job = pages.submit(base / "out", base)
            runner = base / "fake-wrangler.py"
            runner.write_text('import sys; assert "--branch" in sys.argv; assert "mcrew-tony" in sys.argv; assert "metabiz-pages-preview" in sys.argv; print("https://1234abcd.metabiz-pages-preview.pages.dev")')
            policy = {"workspace": str(base), "state": str(base / "state"),
                      "project": "metabiz-pages-preview", "branch": "mcrew-tony",
                      "authHome": str(base), "account": "test", "node": sys.executable,
                      "wrangler": str(runner)}
            pages.process(policy)
            result = json.loads((base / "pages-preview-queue" / (job + ".json")).read_text())
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["url"], "https://1234abcd.metabiz-pages-preview.pages.dev")

    def test_completed_request_is_removed_after_interrupted_cleanup(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "out").mkdir()
            (base / "out/index.html").write_text("preview")
            job = pages.submit(base / "out", base)
            queue = base / "pages-preview-queue"
            (queue / (job + ".json")).write_text('{"status":"succeeded"}')
            pages.process({"workspace": str(base), "state": str(base / "state")})
            self.assertFalse((queue / (job + ".tar")).exists())

    def test_reject_symlinked_queue(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "outside").mkdir()
            (base / "pages-preview-queue").symlink_to(base / "outside")
            pages.process({"workspace": str(base)})
            self.assertEqual(list((base / "outside").iterdir()), [])

if __name__ == "__main__":
    unittest.main()
