import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from dataset import Dataset, growth

LISTS = [{"key": "all", "name": "总榜", "path": "", "periods": ["daily", "weekly"]},
         {"key": "python", "name": "Python", "path": "python", "periods": ["daily"]}]


def snapshot(date, daily, extra=None):
    lists = {"all:daily": [{"rank": i + 1, "repo": r, "stars": 100 + i, "gained": 10} for i, r in enumerate(daily)]}
    lists.update(extra or {})
    return {"date": date, "captured_at": f"{date}T13:00:00Z", "lists": lists}


def dataset(meta=None, summaries=None, backfill=None, snapshots=(), stars=()):
    return Dataset(meta or {}, summaries or {}, {"source": "test", "days": backfill or {}},
                   list(snapshots), list(stars), LISTS)


class DatasetTests(unittest.TestCase):
    def test_archive_padding_is_removed_and_ranks_close_up(self):
        ds = dataset(backfill={"2024-01-01": ["a/x", "b/y", "a/x", "c/z", "b/y"]})
        rows = ds.rows["2024-01-01"]["all:daily"]
        self.assertEqual([(r["r"], r["k"]) for r in rows], [("a/x", 1), ("b/y", 2), ("c/z", 3)])
        self.assertEqual(ds.record("all:daily", "a/x").n, 1)

    def test_renames_and_case_variants_share_one_history(self):
        meta = {"old/tool": {"canonical": "New/Tool", "stars": 5, "fetched": "2026-10-09"},
                "New/Tool": {"stars": 7, "fetched": "2026-10-10", "desc": "current"}}
        ds = dataset(meta=meta, backfill={"2024-01-01": ["old/tool", "a/x"], "2024-01-02": ["new/tool", "b/y"]},
                     snapshots=[snapshot("2026-10-10", ["NEW/TOOL", "c/z"])])
        self.assertEqual(ds.canon("old/tool"), "New/Tool")
        self.assertEqual(ds.canon("new/TOOL"), "New/Tool")
        record = ds.record("all:daily", "New/Tool")
        self.assertEqual(record.n, 3)
        self.assertEqual(ds.meta("New/Tool")["desc"], "current")
        self.assertIn("old/tool", ds.aliases["New/Tool"])
        self.assertEqual(ds.all_repos(), ["a/x", "b/y", "c/z", "New/Tool"])

    def test_stale_day_is_listed_but_not_counted(self):
        ds = dataset(snapshots=[snapshot("2026-10-10", ["a/x", "b/y"]), snapshot("2026-10-11", ["a/x", "b/y"]),
                                snapshot("2026-10-12", ["b/y", "a/x"])])
        self.assertTrue(ds.days["2026-10-11"]["stale"])
        self.assertEqual(ds.record("all:daily", "a/x").n, 2)
        self.assertNotIn("2026-10-11", [h[0] for h in ds.record("all:daily", "a/x").history])
        stale_row = ds.rows["2026-10-11"]["all:daily"][0]
        self.assertNotIn("chg", stale_row)
        self.assertEqual(ds.rows["2026-10-12"]["all:daily"][0]["chg"], 1)   # b/y moved from 2 to 1
        self.assertEqual(ds.rows["2026-10-12"]["all:daily"][1]["st"], 2)    # streak continues past the stale day

    def test_streaks_skip_missing_days_and_flags_new_and_returning(self):
        ds = dataset(snapshots=[snapshot("2026-10-10", ["a/x"]), snapshot("2026-10-12", ["a/x", "b/y"]),
                                snapshot("2026-10-13", ["b/y"]), snapshot("2026-10-14", ["a/x", "b/y"])])
        rows = {r["r"]: r for r in ds.rows["2026-10-12"]["all:daily"]}
        self.assertEqual(rows["a/x"]["st"], 2)          # 10-11 has no data: skipped, not a break
        self.assertTrue(rows["b/y"]["new"])
        back = {r["r"]: r for r in ds.rows["2026-10-14"]["all:daily"]}["a/x"]
        self.assertTrue(back["back"])
        self.assertNotIn("st", back)
        self.assertEqual(ds.current_streak("all:daily", "b/y"), 3)
        self.assertEqual(ds.current_streak("all:daily", "a/x"), 1)
        first_day = ds.rows["2026-10-10"]["all:daily"][0]
        self.assertNotIn("new", first_day)               # nothing is "new" on a list's first recorded day

    def test_api_observations_win_and_missing_days_stay_missing(self):
        stars = [{"date": "2026-10-10", "stars": {"a/x": 150}}, {"date": "2026-10-12", "stars": {"a/x": 0}}]
        ds = dataset(snapshots=[snapshot("2026-10-10", ["a/x"]), snapshot("2026-10-11", ["b/y", "a/x"])], stars=stars)
        self.assertEqual(ds.star_points("a/x"), [("2026-10-10", 150), ("2026-10-11", 101), ("2026-10-12", 0)])
        self.assertEqual(ds.star_points("b/y"), [("2026-10-11", 100)])

    def test_growth_needs_a_real_baseline(self):
        points = [("2026-10-01", 10), ("2026-10-05", 30), ("2026-10-08", 40)]
        self.assertEqual(growth(points, 7), (30, 7, "2026-10-01"))
        self.assertIsNone(growth(points, 2, 0))          # no observation exactly two days earlier
        self.assertEqual(growth(points, 3, 0), (10, 3, "2026-10-05"))
        self.assertIsNone(growth(points[1:], 7))          # history shorter than the window: unknown
        self.assertEqual(growth([("2026-10-01", 50), ("2026-10-08", 45)], 7), (-5, 7, "2026-10-01"))
        self.assertIsNone(growth(points[:1], 1))


if __name__ == "__main__":
    unittest.main()
