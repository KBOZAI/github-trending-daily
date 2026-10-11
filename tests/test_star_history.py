import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build
import track_stars


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = lambda date: self.root / f"{date}.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_seed_preserves_real_dates_and_zero_without_replacing_history(self):
        meta = {"owner/a": {"fetched": "2026-10-09", "stars": 0},
                "owner/b": {"fetched": "2026-10-10", "stars": 9}}
        with patch.object(track_stars, "star_snapshot_path", self.path):
            self.assertTrue(track_stars.seed_cache(meta, "2026-10-10"))
            original = self.path("2026-10-09").read_bytes()
            meta["owner/a"]["stars"] = 50
            self.assertFalse(track_stars.seed_cache(meta, "2026-10-10"))
        self.assertEqual(original, self.path("2026-10-09").read_bytes())
        self.assertFalse(self.path("2026-10-10").exists())
        seeded = json.loads(original)
        self.assertEqual(seeded["stars"], {"owner/a": 0})
        self.assertIsNone(seeded["captured_at"])

    def test_retry_only_fetches_unfinished_repos(self):
        self.path("2026-10-10").write_text(json.dumps({"date": "2026-10-10", "stars": {"owner/a": 10}}))
        meta = {"owner/a": {}, "owner/b": {}}
        with patch.object(track_stars, "star_snapshot_path", self.path), \
                patch.object(track_stars, "query_batch", return_value=({"owner/b": 20}, [], {})) as query, \
                contextlib.redirect_stdout(io.StringIO()):
            changed, errors = track_stars.track(meta, "test-token", "2026-10-10")
        query.assert_called_once_with(["owner/b"], "test-token")
        snap = json.loads(self.path("2026-10-10").read_text())
        self.assertEqual(snap["stars"], {"owner/a": 10, "owner/b": 20})
        self.assertTrue(snap["complete"])
        self.assertTrue(changed)
        self.assertFalse(errors)

    def test_completed_day_skips_network(self):
        self.path("2026-10-10").write_text(json.dumps({"date": "2026-10-10", "stars": {"owner/a": 10}}))
        with patch.object(track_stars, "star_snapshot_path", self.path), \
                patch.object(track_stars, "query_batch") as query, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(track_stars.track({"owner/a": {}}, "test-token", "2026-10-10"), (False, {}))
        query.assert_not_called()

    def test_failed_batch_keeps_completed_points_for_retry(self):
        self.path("2026-10-10").write_text(json.dumps({"date": "2026-10-10", "stars": {"owner/a": 10}}))
        with patch.object(track_stars, "star_snapshot_path", self.path), \
                patch.object(track_stars, "query_batch", side_effect=RuntimeError("temporary outage")), \
                contextlib.redirect_stdout(io.StringIO()):
            changed, errors = track_stars.track({"owner/a": {}, "owner/b": {}}, "test-token", "2026-10-10")
        saved = json.loads(self.path("2026-10-10").read_text())
        self.assertTrue(changed)
        self.assertEqual(saved["stars"], {"owner/a": 10})
        self.assertFalse(saved["complete"])
        self.assertIn("owner/b", errors)

    def test_graphql_distinguishes_zero_missing_and_transient_null(self):
        response = {"data": {"r0": {"stargazerCount": 0}, "r1": None, "r2": None},
                    "errors": [{"type": "NOT_FOUND", "path": ["r1"]}]}
        with patch.object(track_stars, "http", return_value=json.dumps(response)):
            stars, missing, errors = track_stars.query_batch(["owner/a", "owner/b", "owner/c"], "test-token")
        self.assertEqual(stars, {"owner/a": 0})
        self.assertEqual(missing, ["owner/b"])
        self.assertEqual(set(errors), {"owner/c"})

    def test_canonical_names_are_tracked_once(self):
        self.assertEqual(track_stars.known_repos({"old/a": {"canonical": "owner/a"}, "owner/a": {},
                                                "private/repo": {"missing": True}}), ["owner/a"])


class BuildTests(unittest.TestCase):
    def test_stars_continue_after_exit_and_do_not_invent_historical_points(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            meta = {"old/a": {"canonical": "owner/a"}, "owner/a": {"stars": 999}, "owner/b": {"stars": 0}}
            introduction = {"what": "A source-backed explanation", "use_cases": ["A supported use"], "audience": "Developers"}
            summary = {"owner/a": {"zh": "说明", "intro": introduction, "source": {"url": "https://github.com/owner/a"}, "date": "2026-10-10"}}
            for name, data in [("meta", meta), ("summaries", summary),
                               ("backfill", {"source": "test", "days": {"2026-10-08": ["old/a"]}})]:
                (root / f"{name}.json").write_text(json.dumps(data))
            snapshots = [{"date": "2026-10-09", "captured_at": "2026-10-09T01:00:00Z",
                          "lists": {"all:daily": [{"repo": "old/a", "rank": 1, "stars": 10}]}},
                         {"date": "2026-10-10", "captured_at": "2026-10-10T01:00:00Z",
                          "lists": {"all:daily": [{"repo": "owner/b", "rank": 1, "stars": 0}]}}]
            star_samples = [{"date": "2026-10-09", "stars": {"owner/a": 11}},
                            {"date": "2026-10-10", "stars": {"owner/a": 15, "owner/b": 0}},
                            {"date": "2026-10-12", "stars": {"owner/a": 14}}]
            with patch.object(build, "META_FILE", root / "meta.json"), \
                    patch.object(build, "SUMMARY_FILE", root / "summaries.json"), \
                    patch.object(build, "BACKFILL_FILE", root / "backfill.json"), \
                    patch.object(build, "SITE_DATA", root / "site"), \
                    patch.object(build, "iter_snapshots", return_value=iter(snapshots)), \
                    patch.object(build, "iter_star_snapshots", return_value=iter(star_samples)), \
                    contextlib.redirect_stdout(io.StringIO()):
                build.main()
            repos = json.loads((root / "site/repos.json").read_text())
            history = json.loads((root / "site/stars/owner/a.json").read_text())["points"]
            self.assertEqual(history, [["2026-10-09", 11], ["2026-10-10", 15], ["2026-10-12", 14]])
            self.assertEqual(repos["owner/a"]["s"], 14)
            self.assertEqual(repos["owner/a"]["intro"], introduction)
            self.assertEqual(repos["owner/a"]["intro_source"]["url"], "https://github.com/owner/a")
            day = json.loads((root / "site/days/2026-10-09.json").read_text())
            self.assertEqual(day["lists"]["all:daily"]["items"][0]["intro"], introduction)
            self.assertEqual(repos["owner/a"]["star_history"]["count"], 3)
            self.assertEqual(repos["owner/b"]["s"], 0)
            self.assertNotIn("sh", repos["owner/a"])
            self.assertNotIn("2026-10-11", [date for date, _ in history])
            index = json.loads((root / "site/index.json").read_text())
            self.assertNotIn("2026-10-12", index["dates"])


if __name__ == "__main__":
    unittest.main()
