import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build import SHARDS, SiteBuilder, shard_of
from dataset import Dataset

LISTS = [{"key": "all", "name": "总榜", "path": "", "periods": ["daily"]}]
INTRO = {"what": "A source-backed explanation", "use_cases": ["A supported use"], "audience": "Developers"}
# Shared with site/assets/js/data.js shardOf(); both sides must agree for detail pages to load.
SHARD_VECTORS = {"morluto/rea": "a8", "MadsLorentzen/ai-job-search": "2d", "warpdotdev/Warp": "20", "a/b": "c1",
                 "codecrafters-io/build-your-own-x": "46"}


def snap(date, rows):
    return {"date": date, "captured_at": f"{date}T13:00:00Z",
            "lists": {"all:daily": [{"rank": i + 1, "repo": r, "stars": s, "gained": 5} for i, (r, s) in enumerate(rows)]}}


class BuildTests(unittest.TestCase):
    def build(self, meta, summaries, backfill, snapshots, stars):
        ds = Dataset(meta, summaries, {"source": "test", "days": backfill}, snapshots, stars, LISTS)
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        with contextlib.redirect_stdout(io.StringIO()):
            manifest = SiteBuilder(ds).write(Path(folder))
        return Path(folder), manifest

    @staticmethod
    def read(root, path):
        return json.loads((root / path).read_text())

    def test_stars_are_recorded_values_only_and_follow_renames(self):
        meta = {"old/a": {"canonical": "owner/a", "stars": 1, "fetched": "2026-10-09"},
                "owner/a": {"stars": 999, "fetched": "2026-10-09", "desc": "Tool A", "topics": ["cli"]},
                "owner/b": {"stars": 0, "fetched": "2026-10-09"}}
        summaries = {"owner/a": {"zh": "说明", "intro": INTRO, "tags": ["开发工具"], "date": "2026-10-10",
                                 "source": {"url": "https://github.com/owner/a"}}}
        snapshots = [snap("2026-10-09", [("old/a", 10), ("c/c", 3)]), snap("2026-10-10", [("owner/b", 0)])]
        stars = [{"date": "2026-10-09", "stars": {"owner/a": 11}},
                 {"date": "2026-10-10", "stars": {"owner/a": 15, "owner/b": 0}},
                 {"date": "2026-10-12", "stars": {"owner/a": 14}}]
        root, manifest = self.build(meta, summaries, {"2026-10-08": ["old/a", "z/z"]}, snapshots, stars)

        series = self.read(root, f"stars/2026/{shard_of('owner/a')}.json")["owner/a"]
        self.assertEqual(series, ["2026-10-09", [11, 15, None, 14]])       # 10-11 unobserved stays null
        record = self.read(root, f"repo/{shard_of('owner/a')}.json")["owner/a"]
        self.assertEqual(record["intro"]["what"], INTRO["what"])
        self.assertEqual(record["intro"]["source"]["url"], "https://github.com/owner/a")
        self.assertEqual(record["lists"]["all:daily"]["n"], 2)             # archive day + live day, one history
        self.assertEqual(record["aliases"], ["old/a"])
        self.assertEqual(self.read(root, f"repo/{shard_of('old/a')}.json")["old/a"], {"redirect": "owner/a"})

        catalog = self.read(root, "catalog.json")
        rows = {r[0]: dict(zip(catalog["cols"], r)) for r in catalog["rows"]}
        self.assertEqual(rows["owner/a"]["stars"], 14)                     # stars may fall; no forced monotonicity
        self.assertEqual(rows["owner/b"]["stars"], 0)
        self.assertEqual(rows["owner/a"]["zh"], "说明")
        self.assertEqual(manifest["dates"], [["2026-10-08", "2026-10-10"]])
        self.assertEqual(manifest["stars"]["since"], "2026-10-09")
        self.assertEqual(len(list((root / "repo").glob("*.json"))), SHARDS)
        day = self.read(root, "days/2026-10-09.json")
        self.assertEqual(day["lists"]["all:daily"][0]["r"], "owner/a")
        self.assertEqual(day["repos"]["owner/a"]["zh"], "说明")
        archive = self.read(root, "days/2026-10-08.json")
        self.assertEqual(archive["src"], "backfill")
        self.assertNotIn("now", archive["repos"]["owner/a"])               # archive days stay byte-stable day to day
        self.assertNotIn("s", archive["lists"]["all:daily"][0])             # no invented historical totals

    def test_front_page_growth_uses_complete_windows_only(self):
        days = [f"2026-10-{d:02d}" for d in range(1, 10)]
        stars = [{"date": d, "stars": {"steady/x": 100 + i * 10, **({"late/y": 50 + i * 100} if i >= 4 else {})}}
                 for i, d in enumerate(days)]
        stars[-2]["stars"].pop("steady/x")                                  # one missing day mid-series
        snapshots = [snap(d, [("steady/x", None), ("late/y", None)] if i % 2 else [("late/y", None), ("steady/x", None)])
                     for i, d in enumerate(days[-2:])]
        root, _ = self.build({}, {}, {}, snapshots, stars)
        home = self.read(root, "home.json")
        self.assertEqual(home["risers"]["g7"], ["steady/x"])               # late/y has only 5 days: not ranked
        self.assertEqual(home["repos"]["steady/x"]["g7"], [70, 7])
        self.assertNotIn("g7", home["repos"]["late/y"])
        self.assertNotIn("g1", home["repos"]["steady/x"])                   # yesterday unobserved: no 1-day change
        spark = home["repos"]["steady/x"]["spark"]
        self.assertIsNone(spark[1][-2])

    def test_output_is_byte_stable_across_hash_seeds(self):
        """Unchanged input must give identical files, or every publish would rewrite gh-pages history."""
        script = (
            "import contextlib, io, json, sys; from pathlib import Path;"
            f"sys.path.insert(0, {str(ROOT / 'scripts')!r});"
            "from dataset import Dataset; from build import SiteBuilder;"
            "meta = {'old/a': {'canonical': 'owner/a'}, 'Old/B': {'canonical': 'owner/b'}, 'owner/a': {'topics': ['x', 'y']},"
            " 'owner/b': {'topics': ['x', 'y']}, 'owner/c': {'topics': ['x', 'y']}};"
            "intro = {'zh': 'z', 'intro': {'what': 'w'}, 'tags': ['开发工具']};"
            "snaps = [{'date': '2026-10-09', 'lists': {'all:daily': [{'rank': 1, 'repo': 'old/a'}, {'rank': 2, 'repo': 'owner/b'}]}},"
            " {'date': '2026-10-10', 'lists': {'all:daily': [{'rank': 1, 'repo': 'owner/c'}, {'rank': 2, 'repo': 'old/b'}]}}];"
            "ds = Dataset(meta, {'owner/a': intro, 'owner/b': intro, 'owner/c': intro}, {'days': {}}, snaps,"
            " [{'date': '2026-10-10', 'stars': {'owner/a': 1, 'owner/b': 2, 'owner/c': 3}}],"
            " [{'key': 'all', 'name': 'all', 'periods': ['daily']}]);"
            "out = contextlib.redirect_stdout(io.StringIO());"
            "out.__enter__(); SiteBuilder(ds).write(Path(sys.argv[1]))")
        folders = []
        for seed in ("1", "2"):
            folder = Path(tempfile.mkdtemp())
            self.addCleanup(shutil.rmtree, folder)
            subprocess.run([sys.executable, "-c", script, str(folder)], check=True, env={"PYTHONHASHSEED": seed})
            folders.append(folder)
        files = sorted(p.relative_to(folders[0]) for p in folders[0].rglob("*.json") if p.name != "index.json")
        self.assertTrue(files)
        for path in files:
            self.assertEqual((folders[0] / path).read_bytes(), (folders[1] / path).read_bytes(), str(path))

    def test_shards_match_frontend_vectors(self):
        for name, expected in SHARD_VECTORS.items():
            self.assertEqual(shard_of(name), expected)
            self.assertEqual(shard_of(name.upper()), expected)
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed; Python vectors checked only")
        script = ("const { shardOf } = await import(process.argv[1]);"
                  f"console.log(JSON.stringify(Object.fromEntries({json.dumps(list(SHARD_VECTORS))}.map((n) => [n, shardOf(n, 256)]))));")
        out = subprocess.run([node, "--input-type=module", "-e", script, (ROOT / "site/assets/js/data.js").as_uri()],
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), SHARD_VECTORS)


if __name__ == "__main__":
    unittest.main()
