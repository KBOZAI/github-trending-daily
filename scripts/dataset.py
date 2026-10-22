"""Load the persistent datasets into one model keyed by canonical repository names.

Sources (read-only here):
  data/snapshots/YYYY/DATE.json              live Trending captures: rank, stars, forks, gained
  data/backfill/antonkomarev/all-daily.json  overall daily rankings since 2023-09-09, names only
  data/stars/YYYY/DATE.json                  daily total-Stars observations from the GitHub API
  data/repos/meta.json                       repository metadata cache
  data/repos/summaries.json                  Chinese explanations

Names are merged case-insensitively and through the `canonical` field written by enrich.py,
so a renamed repository keeps one history. Nothing here fills in missing observations.
"""
import collections
import datetime as dt

from common import (BACKFILL_FILE, CONFIG, META_FILE, SUMMARY_FILE, iter_snapshots,
                    iter_star_snapshots, load_json)


def days_between(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def shift(date, days):
    return (dt.date.fromisoformat(date) + dt.timedelta(days=days)).isoformat()


class ListRecord:
    """One repository's history on one list. Stale days are never counted."""
    __slots__ = ("n", "first", "last", "best", "streak", "longest", "history")

    def __init__(self, first):
        self.n, self.first, self.last, self.best = 0, first, None, None
        self.streak = self.longest = 0
        self.history = []          # [date, rank, gained-or-None]


def growth(points, window, tolerance=2):
    """Observed change over `window` days ending at the last observation.

    The baseline is the newest observation dated between window and window+tolerance days
    before the last one. Returns (gain, span_days, base_date) or None when there is no such
    observation: short histories are reported as unknown rather than estimated.
    """
    if len(points) < 2:
        return None
    last_date, last_value = points[-1]
    newest, oldest = shift(last_date, -window), shift(last_date, -window - tolerance)
    for date, value in reversed(points[:-1]):
        if date <= newest:
            if date < oldest:
                return None
            return last_value - value, days_between(date, last_date), date
    return None


class Dataset:
    def __init__(self, meta, summaries, backfill, snapshots, star_snapshots, lists_config):
        self.lists_config = lists_config
        self.list_keys = [f"{spec['key']}:{period}" for spec in lists_config for period in spec["periods"]]
        if "all:daily" not in self.list_keys:
            self.list_keys.insert(0, "all:daily")
        snapshots = sorted(snapshots, key=lambda s: s["date"])
        star_snapshots = sorted(star_snapshots, key=lambda s: s["date"])
        self._index_names(meta, summaries, backfill, snapshots, star_snapshots)
        self._build_days(backfill, snapshots)
        self._build_stars(star_snapshots)
        self._walk_lists()

    @classmethod
    def load(cls):
        return cls(load_json(META_FILE, {}), load_json(SUMMARY_FILE, {}),
                   load_json(BACKFILL_FILE, {"days": {}}), list(iter_snapshots()),
                   list(iter_star_snapshots()), CONFIG["lists"])

    # ---------------------------------------------------------------- names
    def _index_names(self, meta, summaries, backfill, snapshots, star_snapshots):
        self.backfill_source = backfill.get("source")
        # Several meta keys can differ only in case; prefer an available, recently fetched entry.
        by_lower = {}
        for key, entry in meta.items():
            current = by_lower.get(key.lower())
            rank = (not entry.get("missing"), entry.get("fetched") or "", key == entry.get("canonical"))
            if current is None or rank > current[0]:
                by_lower[key.lower()] = (rank, key)
        self._meta = {low: meta[key] for low, (_, key) in by_lower.items()}
        self._summaries = {}
        for key, value in summaries.items():
            self._summaries.setdefault(key.lower(), value)

        # Display casing: later sources win; GitHub's canonical nameWithOwner wins over all.
        display = {}
        for names in backfill.get("days", {}).values():
            display.update((n.lower(), n) for n in names)
        display.update((k.lower(), k) for k in meta)
        for snap in star_snapshots:
            display.update((n.lower(), n) for n in snap.get("stars", {}))
        for snap in snapshots:
            for items in snap["lists"].values():
                display.update((i["repo"].lower(), i["repo"]) for i in items)
        for entry in meta.values():
            if entry.get("canonical"):
                display[entry["canonical"].lower()] = entry["canonical"]
        self._display = display
        # canonical -> former names (one spelling per lower-cased name; lookups are case-insensitive)
        found = collections.defaultdict(dict)
        for low, name in display.items():
            c = self.canon(name)
            if c.lower() != low:
                found[c].setdefault(low, name)
        for key in list(meta) + list(summaries):
            c = self.canon(key)
            if c.lower() != key.lower():
                found[c].setdefault(key.lower(), key)
        self.aliases = {c: set(spellings.values()) for c, spellings in found.items()}

    def canon(self, name):
        low, seen = name.lower(), set()
        while low not in seen:
            seen.add(low)
            target = (self._meta.get(low) or {}).get("canonical")
            if not target or target.lower() == low:
                break
            low = target.lower()
        return self._display.get(low, name if name.lower() == low else low)

    def meta(self, name):
        """Metadata for a canonical name, falling back to entries stored under old names."""
        entry = self._meta.get(name.lower())
        if entry and not entry.get("missing"):
            return entry
        for alias in sorted(self.aliases.get(name, ())):
            other = self._meta.get(alias.lower())
            if other and not other.get("missing") and "stars" in other:
                return other
        return entry or {}

    def summary(self, name):
        found = self._summaries.get(name.lower())
        if found:
            return found
        for alias in sorted(self.aliases.get(name, ())):
            if alias.lower() in self._summaries:
                return self._summaries[alias.lower()]
        return {}

    def is_gone(self, name):
        entry = self._meta.get(name.lower())
        return bool(entry and entry.get("missing"))

    # ----------------------------------------------------------------- days
    def _build_days(self, backfill, snapshots):
        days = {}
        for date, names in backfill.get("days", {}).items():
            days[date] = {"src": "backfill", "captured_at": None,
                          "lists": {"all:daily": [{"rank": i + 1, "repo": n} for i, n in enumerate(names)]}}
        for snap in snapshots:   # our own capture wins over the archive for the same date
            days[snap["date"]] = {"src": "live", "captured_at": snap.get("captured_at"),
                                  "lists": snap.get("lists", {}), "errors": sorted(snap.get("errors") or {})}
        self.dates = sorted(days)
        previous = None
        for date in self.dates:
            day = days[date]
            lists = {}
            for key, items in day["lists"].items():
                if key not in self.list_keys:
                    continue
                seen, rows = set(), []
                for item in sorted(items, key=lambda i: i["rank"]):
                    c = self.canon(item["repo"])
                    if c in seen:   # the archive pads short days with repeated names
                        continue
                    seen.add(c)
                    rows.append({**item, "repo": c})
                if day["src"] == "backfill":
                    for rank, row in enumerate(rows, 1):
                        row["rank"] = rank
                lists[key] = rows
            day["lists"] = lists
            # GitHub's pipeline has frozen before (2025-11-13 .. 12-04): an overall list identical
            # to the previous captured day is marked stale and excluded from all counts.
            sequence = [i["repo"] for i in lists.get("all:daily", [])]
            day["stale"] = bool(sequence) and sequence == previous
            previous = sequence
        self.days = days
        self.live_dates = [d for d in self.dates if days[d]["src"] == "live"]
        self.valid_dates = [d for d in self.dates if not days[d]["stale"]]
        self.latest = self.dates[-1] if self.dates else None

    # ---------------------------------------------------------------- stars
    def _build_stars(self, star_snapshots):
        series = collections.defaultdict(dict)
        self.star_dates = []
        for snap in star_snapshots:
            self.star_dates.append(snap["date"])
            for name, value in (snap.get("stars") or {}).items():
                if type(value) is int and value >= 0:
                    series[self.canon(name)][snap["date"]] = value
        # Totals printed on the Trending page are real observations as well; the API value of the
        # same UTC date takes precedence. Missing, deleted or private repos are never written as 0.
        for date in self.live_dates:
            for items in self.days[date]["lists"].values():
                for item in items:
                    value = item.get("stars")
                    if type(value) is int and value >= 0:
                        series[item["repo"]].setdefault(date, value)
        self.stars = {repo: sorted(points.items()) for repo, points in series.items()}
        self.star_latest = max((p[-1][0] for p in self.stars.values()), default=None)

    def star_points(self, name):
        return self.stars.get(name, [])

    # ---------------------------------------------------------------- lists
    def _walk_lists(self):
        self.records = collections.defaultdict(dict)   # list key -> repo -> ListRecord
        self.list_since = {}                           # list key -> first date with items
        self.list_last_valid = {}                      # list key -> latest counted date
        self.rows = {}                                 # date -> list key -> annotated rows
        previous_ranks = {}
        for date in self.dates:
            day = self.days[date]
            counted = not day["stale"]
            out = {}
            for key in self.list_keys:
                items = day["lists"].get(key)
                if not items:
                    continue
                self.list_since.setdefault(key, date)
                records = self.records[key]
                before = previous_ranks.get(key)
                rows = []
                for item in items:
                    repo, rank = item["repo"], item["rank"]
                    record = records.get(repo)
                    if counted:
                        if record is None:
                            record = records[repo] = ListRecord(date)
                        follows = record.last is not None and record.last == self.list_last_valid.get(key)
                        record.streak = record.streak + 1 if follows else 1
                        record.n += 1
                        record.longest = max(record.longest, record.streak)
                        record.best = rank if record.best is None else min(record.best, rank)
                        record.last = date
                        record.history.append([date, rank, item.get("gained")])
                    row = {"r": repo, "k": rank}
                    for source, short in (("stars", "s"), ("forks", "f"), ("gained", "g")):
                        if item.get(source) is not None:
                            row[short] = item[source]
                    if record is not None:
                        row["d"] = record.n
                    if counted and record is not None:
                        if record.streak > 1:
                            row["st"] = record.streak
                        if record.n == 1 and self.list_since[key] < date:
                            row["new"] = 1
                        if before is not None:
                            if repo in before:
                                row["chg"] = before[repo] - rank
                            elif record.n > 1:
                                row["back"] = 1
                    rows.append(row)
                out[key] = rows
                if counted:
                    self.list_last_valid[key] = date
                    previous_ranks[key] = {i["repo"]: i["rank"] for i in items}
            self.rows[date] = out

    def record(self, key, repo):
        return self.records.get(key, {}).get(repo)

    def current_streak(self, key, repo):
        record = self.record(key, repo)
        if record and record.last == self.list_last_valid.get(key):
            return record.streak
        return 0

    def all_repos(self):
        """Every canonical repository that appeared on a list or has a Stars observation."""
        names = set(self.stars)
        for records in self.records.values():
            names.update(records)
        for date in self.dates:
            for items in self.days[date]["lists"].values():
                names.update(i["repo"] for i in items)
        return sorted(names, key=str.lower)
