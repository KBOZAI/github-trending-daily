import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import prepare_introductions as prep
import summarize


class IntroductionTests(unittest.TestCase):
    def test_refresh_includes_old_schema_description_changes_and_age(self):
        current = {"version": 2, "src": summarize.desc_hash("desc"), "date": "2026-10-01", "intro": {"what": "Explanation"}}
        self.assertFalse(summarize.needs_summary(current, "desc", "2026-10-11"))
        self.assertTrue(summarize.needs_summary({**current, "version": 1}, "desc", "2026-10-11"))
        self.assertTrue(summarize.needs_summary(current, "changed", "2026-10-11"))
        self.assertTrue(summarize.needs_summary({**current, "intro": {}}, "desc", "2026-10-11"))
        self.assertTrue(summarize.needs_summary(current, "desc", "2026-11-11"))

    def test_malformed_optional_fields_do_not_fabricate_uses(self):
        self.assertEqual(summarize.normalise_intro({"what": " A\nB ", "use_cases": "invalid", "audience": 3}),
                         {"what": "A B", "use_cases": [], "audience": ""})
        self.assertEqual(summarize.normalise_intro({"use_cases": [None, "", "A", "B", "C", "D"]})["use_cases"],
                         ["A", "B", "C"])

    def test_import_is_atomic_for_invalid_or_unprepared_repositories(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = {"owner/a": {"zh": "original"}}
            (root / "summaries.json").write_text(json.dumps(original))
            (root / "readmes.json").write_text(json.dumps({"owner/a": {"url": "https://github.com/owner/a", "sha": "abc"}}))
            valid = {"repo": "owner/a", "zh": "简介", "what": "作用", "tags": ["开发工具"]}
            (root / "import.json").write_text(json.dumps([valid, {**valid, "repo": "unprepared/repo"}]))
            with patch.object(prep, "SUMMARY_FILE", root / "summaries.json"), \
                    patch.object(prep, "README_FILE", root / "readmes.json"), \
                    patch.object(prep, "META_FILE", root / "meta.json"), \
                    patch.object(prep, "latest_descriptions", return_value={"owner/a": "source"}):
                with self.assertRaises(ValueError):
                    prep.apply_introductions(root / "import.json")
                self.assertEqual(json.loads((root / "summaries.json").read_text()), original)
                (root / "import.json").write_text(json.dumps([valid]))
                with contextlib.redirect_stdout(io.StringIO()):
                    prep.apply_introductions(root / "import.json")
            saved = json.loads((root / "summaries.json").read_text())["owner/a"]
            self.assertEqual(saved["intro"]["what"], "作用")
            self.assertEqual(saved["source"]["readme_sha"], "abc")
            self.assertEqual(saved["model"], "codex-task")

    def test_optional_fields_are_cleaned_and_bounded(self):
        intro = summarize.normalise_intro({"what": "作用", "features": [" A ", "", 3, "B", "C", "D", "E"],
                                           "notes": "需要 GPU"})
        self.assertEqual(intro["features"], ["A", "B", "C", "D"])
        self.assertNotIn("notes", intro)   # a string instead of a list is dropped, not guessed into a list
        self.assertFalse(summarize.needs_summary({"version": 3, "src": summarize.desc_hash("d"), "date": "2026-10-10",
                                                  "intro": {"what": "x"}}, "d", "2026-10-11"))

    def test_backlog_projects_import_with_their_prepared_description(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "summaries.json").write_text("{}")
            (root / "readmes.json").write_text(json.dumps({"old/famous": {"url": "https://github.com/old/famous", "sha": "s1",
                                                                        "desc": "Famous tool"}}))
            (root / "import.json").write_text(json.dumps([{"repo": "old/famous", "zh": "简介", "what": "作用",
                                                           "notes": ["需要 Docker"], "tags": ["开发工具"]}]))
            with patch.object(prep, "SUMMARY_FILE", root / "summaries.json"), \
                    patch.object(prep, "README_FILE", root / "readmes.json"), \
                    patch.object(prep, "latest_descriptions", return_value={"owner/a": "source"}), \
                    contextlib.redirect_stdout(io.StringIO()):
                prep.apply_introductions(root / "import.json")
            saved = json.loads((root / "summaries.json").read_text())["old/famous"]
        self.assertEqual(saved["src"], summarize.desc_hash("Famous tool"))
        self.assertEqual(saved["intro"]["notes"], ["需要 Docker"])
        self.assertEqual(saved["version"], summarize.VERSION)

    def test_prepare_puts_latest_lists_first_and_caps_the_daily_backlog(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            today = "2026-10-21"
            summaries = {"done/x": {"date": today, "zh": "x", "intro": {"what": "x"}, "version": 3}}
            (root / "summaries.json").write_text(json.dumps(summaries))
            (root / "readmes.json").write_text("{}")
            (root / "meta.json").write_text("{}")
            record = lambda repo, token: {"url": f"https://github.com/{repo}", "sha": None, "excerpt": "", "date": today}
            backlog = [(f"old/{i}", {"desc": f"d{i}"}) for i in range(10)]
            with patch.object(prep, "SUMMARY_FILE", root / "summaries.json"), \
                    patch.object(prep, "README_FILE", root / "readmes.json"), \
                    patch.object(prep, "META_FILE", root / "meta.json"), \
                    patch.object(prep, "utc_today", return_value=today), \
                    patch.object(prep, "github_token", return_value="token"), \
                    patch.object(prep, "readme_record", side_effect=record), \
                    patch.object(prep, "latest_descriptions", return_value={"new/a": "A", "new/b": "B"}), \
                    patch.object(prep, "backlog_candidates", return_value=backlog), \
                    contextlib.redirect_stdout(io.StringIO()):
                prep.prepare(24, root / "out.json", backlog=4)
            prepared = json.loads((root / "out.json").read_text())
        self.assertEqual([p["repo"] for p in prepared["projects"]], ["new/a", "new/b", "old/0", "old/1", "old/2"])
        self.assertEqual([p["reason"] for p in prepared["projects"]][-1], "backlog")
        self.assertIn("notes", prepared["instructions"]["fields"])

    def test_readme_is_public_source_data_with_traceable_sha(self):
        import base64
        response = {"content": base64.b64encode(b"# Tool\n<!-- secret comment -->\n[Docs](https://example.com)\n![badge](https://x)").decode(),
                    "html_url": "https://github.com/owner/a/blob/main/README.md", "sha": "source-sha"}
        with patch.object(summarize, "http", return_value=json.dumps(response)):
            record = summarize.readme_record("owner/a", "test-token")
        self.assertNotIn("secret comment", record["excerpt"])
        self.assertNotIn("badge", record["excerpt"])
        self.assertIn("Docs", record["excerpt"])
        self.assertEqual(record["sha"], "source-sha")


if __name__ == "__main__":
    unittest.main()
