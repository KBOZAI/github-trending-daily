import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import codex_daily


class PublicationTests(unittest.TestCase):
    def fixture(self, root):
        site = root / "site"
        (site / "data/days").mkdir(parents=True)
        (site / "vendor").mkdir()
        for name in ["index.html", "app.js", "style.css", "vendor/echarts.min.js"]:
            (site / name).write_text("static file")
        (site / "data/index.json").write_text(json.dumps({"latest": "2026-10-11"}))
        (site / "data/repos.json").write_text("{}")
        (site / "data/days/2026-10-11.json").write_text(json.dumps({"lists": {"all:daily": {"items": [{"repo": "owner/repo"}]}}}))
        return site

    def test_invalid_site_does_not_remove_previous_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = self.fixture(root)
            (site / "data/days/2026-10-11.json").write_text("{}")
            target = root / "target"
            target.mkdir()
            (target / "index.html").write_text("last good publication")
            with self.assertRaises(RuntimeError):
                codex_daily.copy_site(site, target)
            self.assertEqual((target / "index.html").read_text(), "last good publication")

    def test_copy_preserves_git_and_domain_but_removes_stale_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = self.fixture(root)
            target = root / "target"
            target.mkdir()
            (target / ".git").mkdir()
            (target / ".git/config").write_text("git settings")
            (target / "CNAME").write_text("example.com")
            (target / "stale.json").write_text("old data")
            codex_daily.copy_site(site, target)
            self.assertEqual((target / ".git/config").read_text(), "git settings")
            self.assertEqual((target / "CNAME").read_text(), "example.com")
            self.assertFalse((target / "stale.json").exists())
            self.assertTrue((target / ".nojekyll").exists())
            self.assertTrue((target / "data/days/2026-10-11.json").exists())

    def test_unexpected_files_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = self.fixture(root)
            (site / ".env").write_text("private placeholder")
            with self.assertRaises(RuntimeError):
                codex_daily.check_site(site)
            (site / ".env").unlink()
            (site / "vendor/link").symlink_to(root)
            with self.assertRaises(RuntimeError):
                codex_daily.check_site(site)


if __name__ == "__main__":
    unittest.main()
