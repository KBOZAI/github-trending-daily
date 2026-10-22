"""Build the website data in site/data/ from the persistent datasets (see docs/DATA.md).

Outputs (all generated, never committed to main):
  index.json              manifest: dates, lists, coverage, counts, shard layout
  home.json               the latest edition, self-contained for a fast front page
  days/<date>.json        every list of a day, annotated with days-on-list, streak, rank change
  catalog.json            one compact row per repository for the library, rankings and search
  search.json             lower-cased text per catalog row, loaded only when searching
  repo/<shard>.json       per-repository metadata, explanation, list history, related projects
  stars/<year>/<shard>.json  recorded total-Stars observations (calendar-aligned, gaps are null)
  insights.json           long-term statistics for the trends page
"""
import collections
import hashlib
import math
import re
import shutil

from common import CONFIG, SITE_DATA, save_json, utc_now
from dataset import Dataset, days_between, growth, shift

SCHEMA = 3
SHARDS = 256
SPARK_DAYS = 15
RELATED_MIN_SCORE = 3.0
CATEGORIES = CONFIG["llm"]["tags"]
AI_TAGS = {"AI 智能体", "大模型", "AI 应用"}
AI_RE = re.compile(
    r"\b(ai|aigc|genai|llms?|gpt\w*|chatgpt|openai|claude|gemini|llama\w*|deepseek|qwen\w*|mistral|"
    r"agents?|agentic|rag|mcp|copilot|langchain|diffusion|transformers?|machine[- ]learning|deep[- ]learning|"
    r"neural|chatbot|prompts?|embeddings?|multimodal|vlm|text-to-\w+|speech-to-text|tts|whisper|"
    r"model context protocol|large language models?|vibe[- ]coding)\b|人工智能|大模型|智能体|大语言模型",
    re.I)
FLAG_GONE, FLAG_ARCHIVED, FLAG_FORK, FLAG_EXPLAINED, FLAG_ORG = 1, 2, 4, 8, 16


def shard_key(index, count=SHARDS):
    return format(index, "0%dx" % len(format(count - 1, "x")))


def shard_of(name, count=SHARDS):
    """FNV-1a over the lower-cased UTF-8 name; mirrored by shardOf() in site/assets/js/data.js."""
    value = 0x811C9DC5
    for byte in name.lower().encode("utf-8"):
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    return shard_key(value % count, count)


def date_ranges(dates):
    ranges = []
    for date in dates:
        if ranges and days_between(ranges[-1][1], date) == 1:
            ranges[-1][1] = date
        else:
            ranges.append([date, date])
    return ranges


def calendar_values(points, start, end):
    """Observations between start and end aligned to calendar days; unobserved days are None."""
    values = [None] * (days_between(start, end) + 1)
    for date, value in points:
        if start <= date <= end:
            values[days_between(start, date)] = value
    return values


def clean_intro(summary):
    intro = summary.get("intro") or {}
    if not summary.get("zh"):
        return None
    out = {"zh": summary["zh"], "what": intro.get("what") or "",
           "use_cases": intro.get("use_cases") or [], "audience": intro.get("audience") or "",
           "tags": [t for t in summary.get("tags") or [] if t in CATEGORIES],
           "date": summary.get("date"), "source": summary.get("source") or {}}
    for optional in ("features", "notes"):
        if intro.get(optional):
            out[optional] = intro[optional]
    return out


class SiteBuilder:
    def __init__(self, ds):
        self.ds = ds
        self.repos = ds.all_repos()
        self.base = ds.dates[0]
        self.latest = ds.latest
        self.metrics = {name: self._metrics(name) for name in self.repos}

    def day_number(self, date):
        return days_between(self.base, date) if date else None

    # ------------------------------------------------------------ per repo
    def _metrics(self, name):
        ds = self.ds
        meta, summary = ds.meta(name), ds.summary(name)
        points = ds.star_points(name)
        overall = ds.record("all:daily", name)
        seen = max((r.last for key in ds.list_keys if (r := ds.record(key, name)) and r.last), default=None)
        flags = 0
        if ds.is_gone(name):
            flags |= FLAG_GONE
        if meta.get("archived"):
            flags |= FLAG_ARCHIVED
        if meta.get("fork"):
            flags |= FLAG_FORK
        if (summary.get("intro") or {}).get("what") and summary.get("zh"):
            flags |= FLAG_EXPLAINED
        if meta.get("org"):
            flags |= FLAG_ORG
        m = {"meta": meta, "summary": summary, "points": points, "overall": overall, "seen": seen,
             "flags": flags, "stars": points[-1][1] if points else meta.get("stars"),
             "stars_date": points[-1][0] if points else None,
             "g1": growth(points, 1, 0), "g7": growth(points, 7), "g30": growth(points, 30, 3)}
        return m

    # ------------------------------------------------------------------ days
    def day_payload(self, date):
        """One day's lists plus the short descriptions they need, so the archive stands alone."""
        ds, day = self.ds, self.ds.days[date]
        lists = ds.rows[date]
        live = day["src"] == "live"
        captured = {}
        if live:   # descriptions and languages as printed on that day's Trending page
            for items in day["lists"].values():
                for item in items:
                    captured.setdefault(item["repo"], item)
        repos = {}
        for name in sorted({row["r"] for rows in lists.values() for row in rows}, key=str.lower):
            m = self.metrics[name]
            info = {}
            if m["flags"] & FLAG_EXPLAINED:
                info["zh"] = m["summary"]["zh"]
                tags = [t for t in m["summary"].get("tags") or [] if t in CATEGORIES]
                if tags:
                    info["tags"] = tags
            desc = (captured.get(name) or {}).get("desc") or m["meta"].get("desc")
            if desc and "zh" not in info:
                info["desc"] = desc[:200]
            lang = (captured.get(name) or {}).get("lang") or m["meta"].get("lang")
            if lang:
                info["lang"] = lang
            if m["flags"] & FLAG_GONE:
                info["gone"] = 1
            # No current totals here: archive days would otherwise change on every publish.
            repos[name] = info
        out = {"date": date, "src": day["src"], "stale": day["stale"], "lists": lists, "repos": repos}
        if day.get("captured_at"):
            out["captured_at"] = day["captured_at"]
        if day.get("errors"):
            out["errors"] = day["errors"]
        return out

    # --------------------------------------------------------------- catalog
    CATALOG_COLS = ["name", "zh", "lang", "stars", "g1", "g7", "n", "best", "first", "last", "seen", "na",
                    "created", "flags", "tags", "st", "sd", "g7s", "g30"]

    def catalog(self):
        """Columnar rows; trailing empty values are trimmed and dates are day numbers from `base`."""
        langs = collections.Counter(self.metrics[n]["meta"].get("lang") for n in self.repos)
        lang_list = [l for l, _ in langs.most_common() if l]
        lang_index = {l: i for i, l in enumerate(lang_list)}
        tag_index = {t: i for i, t in enumerate(CATEGORIES)}
        rows, texts = [], []
        for name in self.repos:
            m = self.metrics[name]
            meta, summary, overall = m["meta"], m["summary"], m["overall"]
            explained = m["flags"] & FLAG_EXPLAINED
            appearances = set()
            for key in self.ds.list_keys:
                if key.endswith(":daily") and (r := self.ds.record(key, name)):
                    appearances.update(h[0] for h in r.history)
            g7 = m["g7"]
            row = [
                name, summary["zh"] if explained else "", lang_index.get(meta.get("lang"), -1), m["stars"],
                m["g1"][0] if m["g1"] else None, g7[0] if g7 else None,
                overall.n if overall else 0, overall.best if overall else None,
                self.day_number(overall.first) if overall else None, self.day_number(overall.last) if overall else None,
                self.day_number(m["seen"]), len(appearances),
                self.day_number(meta["created"]) if meta.get("created") else None, m["flags"],
                [tag_index[t] for t in summary.get("tags", []) if t in tag_index] if explained else [],
                self.ds.current_streak("all:daily", name) or None,
                None if m["stars_date"] == self.ds.star_latest else self.day_number(m["stars_date"]),
                g7[1] if g7 and g7[1] != 7 else None, m["g30"][0] if m["g30"] else None]
            while row and row[-1] in (None, []):
                row.pop()
            rows.append(row)
            intro = (summary.get("intro") or {}) if explained else {}
            desc = " ".join((meta.get("desc") or "").split())
            if len(desc) > 140:
                desc = desc[:139].rstrip() + "…"
            extra = " ".join([" ".join(meta.get("topics") or []), intro.get("what", ""),
                              " ".join(intro.get("use_cases") or []), " ".join(intro.get("features") or []),
                              " ".join(sorted(self.ds.aliases.get(name, ())))])
            texts.append([desc, " ".join(extra.lower().split())])
        catalog = {"v": SCHEMA, "base": self.base, "star_date": self.ds.star_latest, "langs": lang_list,
                   "tags": CATEGORIES, "cols": self.CATALOG_COLS, "rows": rows}
        return catalog, {"v": SCHEMA, "rows": texts}

    # ----------------------------------------------------------- repo shards
    def related(self):
        """Similar explained projects: shared GitHub topics (IDF-weighted), categories and language."""
        pool = [n for n in self.repos if self.metrics[n]["flags"] & FLAG_EXPLAINED
                and not self.metrics[n]["flags"] & FLAG_GONE]
        topic_df = collections.Counter(t for n in self.repos for t in set(self.metrics[n]["meta"].get("topics") or []))
        total = max(len(self.repos), 1)
        idf = {t: math.log(total / df) for t, df in topic_df.items()}
        by_topic, by_tag = collections.defaultdict(list), collections.defaultdict(list)
        for n in pool:
            for t in set(self.metrics[n]["meta"].get("topics") or []):
                by_topic[t].append(n)
            for t in self.metrics[n]["summary"].get("tags") or []:
                by_tag[t].append(n)
        out = {}
        for name in self.repos:
            m = self.metrics[name]
            scores = collections.Counter()
            for t in set(m["meta"].get("topics") or []):
                if topic_df[t] > 1:
                    for other in by_topic.get(t, ()):
                        scores[other] += idf[t]
            tags = (m["summary"].get("tags") or []) if m["flags"] & FLAG_EXPLAINED else []
            for t in tags:
                for other in by_tag.get(t, ()):
                    scores[other] += 0.8
            lang = m["meta"].get("lang")
            scores.pop(name, None)
            ranked = sorted(((s + (0.25 if lang and self.metrics[o]["meta"].get("lang") == lang else 0), o)
                             for o, s in scores.items() if s >= RELATED_MIN_SCORE),
                            key=lambda x: (-x[0], -(self.metrics[x[1]]["stars"] or 0), x[1].lower()))
            out[name] = [o for _, o in ranked[:6]]
        return out

    def repo_record(self, name, related):
        ds, m = self.ds, self.metrics[name]
        meta = m["meta"]
        info = {k: meta[k] for k in ("desc", "lang", "topics", "created", "pushed", "license", "homepage",
                                     "forks", "fetched", "release", "issues") if meta.get(k) not in (None, "", [])}
        for flag, key in ((FLAG_GONE, "gone"), (FLAG_ARCHIVED, "archived"), (FLAG_FORK, "fork"), (FLAG_ORG, "org")):
            if m["flags"] & flag:
                info[key] = True
        lists = {}
        for key in ds.list_keys:
            record = ds.record(key, name)
            if record:
                lists[key] = {"n": record.n, "first": record.first, "last": record.last, "best": record.best,
                              "streak": ds.current_streak(key, name), "longest": record.longest,
                              "h": [[d, r, g] if g is not None else [d, r] for d, r, g in record.history]}
        out = {"name": name, "meta": info, "intro": clean_intro(m["summary"]) if m["flags"] & FLAG_EXPLAINED else None,
               "lists": lists}
        if related:
            out["related"] = [[o, self.metrics[o]["summary"].get("zh", ""), self.metrics[o]["meta"].get("lang")]
                              for o in related]
        if ds.aliases.get(name):
            out["aliases"] = sorted(ds.aliases[name])
        return out

    # ------------------------------------------------------------------ home
    def spark(self, name):
        points = self.metrics[name]["points"]
        if not points or not self.ds.star_latest:
            return None
        start = shift(self.ds.star_latest, -(SPARK_DAYS - 1))
        values = calendar_values(points, start, self.ds.star_latest)
        return [start, values] if sum(v is not None for v in values) >= 2 else None

    def brief(self, name):
        """Everything a front-page card needs about one repository."""
        m = self.metrics[name]
        meta, summary, overall = m["meta"], m["summary"], m["overall"]
        out = {"lang": meta.get("lang"), "stars": m["stars"], "sd": m["stars_date"], "flags": m["flags"]}
        if m["flags"] & FLAG_EXPLAINED:
            intro = summary.get("intro") or {}
            out.update(zh=summary["zh"], what=intro.get("what", ""), uses=intro.get("use_cases") or [],
                       aud=intro.get("audience", ""), tags=[t for t in summary.get("tags") or [] if t in CATEGORIES])
        elif meta.get("desc"):
            out["desc"] = meta["desc"][:240]
        if meta.get("created"):
            out["created"] = meta["created"]
        for window in ("g1", "g7", "g30"):
            if m[window]:
                out[window] = m[window][:2]
        if overall:
            out.update(n=overall.n, first=overall.first, best=overall.best)
            streak = self.ds.current_streak("all:daily", name)
            if streak > 1:
                out["st"] = streak
        spark = self.spark(name)
        if spark:
            out["spark"] = spark
        return out

    def home(self):
        ds, date = self.ds, self.latest
        day = ds.days[date]
        lists = ds.rows[date]
        star_date = ds.star_latest
        fresh = [n for n in self.repos if self.metrics[n]["stars_date"] == star_date
                 and not self.metrics[n]["flags"] & FLAG_GONE]

        def top(key, limit=12, minimum=1):
            ranked = sorted((n for n in fresh if self.metrics[n][key] and self.metrics[n][key][0] >= minimum),
                            key=lambda n: (-self.metrics[n][key][0], n.lower()))
            return ranked[:limit]

        def relative(n):
            gain, span, base_date = self.metrics[n]["g7"]
            base = self.metrics[n]["stars"] - gain
            return gain / base if base >= 500 else 0
        rel = sorted((n for n in fresh if self.metrics[n]["g7"] and relative(n) > 0),
                     key=lambda n: (-relative(n), n.lower()))[:12]

        window_start = shift(date, -29)
        recent = collections.Counter()
        for d in ds.valid_dates:
            if d >= window_start:
                recent.update(i["repo"] for i in ds.days[d]["lists"].get("all:daily", []))
        sustained = [[n, c] for n, c in sorted(recent.items(), key=lambda x: (-x[1], x[0].lower()))[:12]]
        newcomers = [row["r"] for row in lists.get("all:daily", []) if row.get("new")]
        week_start = shift(date, -6)
        first_week = sorted(((n, r.first, r.best) for n, r in ds.records.get("all:daily", {}).items()
                             if r.first >= week_start and ds.list_since.get("all:daily", date) < r.first),
                            key=lambda x: (x[1], -x[2]), reverse=True)[:12]
        list_new = {key: [row["r"] for row in rows if row.get("new")] for key, rows in lists.items()
                    if key != "all:daily" and key.endswith(":daily")}
        risers = {"g1": top("g1"), "g7": top("g7"), "rel7": rel}
        names = {row["r"] for rows in lists.values() for row in rows}
        names.update(n for group in risers.values() for n in group)
        names.update(n for n, _ in sustained)
        names.update(n for n, _, _ in first_week)
        out = {"date": date, "src": day["src"], "stale": day["stale"], "captured_at": day.get("captured_at"),
               "star_date": star_date, "lists": lists, "risers": risers, "newcomers": newcomers,
               "first_week": [list(x) for x in first_week], "list_new": {k: v for k, v in list_new.items() if v},
               "sustained": sustained, "window_start": window_start,
               "repos": {n: self.brief(n) for n in sorted(names, key=str.lower)}}
        if day.get("errors"):
            out["errors"] = day["errors"]
        return out

    # -------------------------------------------------------------- insights
    def insights(self):
        ds = self.ds
        lang_month = collections.defaultdict(collections.Counter)
        ai_month = collections.defaultdict(lambda: [0, 0])
        size_month = collections.defaultdict(list)
        first_seen, owner_repos, owner_days = {}, collections.defaultdict(set), collections.Counter()
        for d in ds.valid_dates:
            items = ds.days[d]["lists"].get("all:daily", [])
            month = d[:7]
            size_month[month].append(len(items))
            live = ds.days[d]["src"] == "live"
            for item in items:
                name = item["repo"]
                meta, summary = self.metrics[name]["meta"], self.metrics[name]["summary"]
                lang_month[month][(item.get("lang") if live else None) or meta.get("lang") or "无主语言"] += 1
                text = " ".join([name.replace("/", " ").replace("-", " "), item.get("desc") or meta.get("desc") or "",
                                 " ".join(meta.get("topics") or [])])
                ai_month[month][1] += 1
                if AI_RE.search(text) or AI_TAGS & set(summary.get("tags") or []):
                    ai_month[month][0] += 1
                first_seen.setdefault(name, d)
                owner_repos[name.split("/")[0]].add(name)
                owner_days[name.split("/")[0]] += 1
        months = sorted(lang_month)
        recent_months = months[-12:]
        top_langs = [l for l, _ in sum((lang_month[m] for m in recent_months), collections.Counter()).most_common(9)]
        share = {l: [] for l in top_langs + ["其他"]}
        for month in months:
            total = sum(lang_month[month].values()) or 1
            for l in top_langs:
                share[l].append(round(100 * lang_month[month][l] / total, 1))
            share["其他"].append(round(100 * sum(v for k, v in lang_month[month].items() if k not in top_langs) / total, 1))
        newcomers = collections.Counter(d[:7] for d in first_seen.values())

        def topic_counts(window):
            counts = collections.Counter()
            for d in window:
                for item in ds.days[d]["lists"].get("all:daily", []):
                    counts.update(self.metrics[item["repo"]]["meta"].get("topics") or [])
            return counts
        valid = ds.valid_dates
        recent, before = topic_counts(valid[-30:]), topic_counts(valid[-60:-30])
        topics = [{"t": t, "n": n, "prev": before.get(t, 0)} for t, n in recent.most_common(30)]

        def evergreen(days):
            start = shift(self.latest, -(days - 1)) if days else ""
            counts, best = collections.Counter(), {}
            for d in valid:
                if d >= start:
                    for item in ds.days[d]["lists"].get("all:daily", []):
                        counts[item["repo"]] += 1
                        best[item["repo"]] = min(best.get(item["repo"], 999), item["rank"])
            ranked = sorted(counts, key=lambda n: (-counts[n], best[n], n.lower()))[:20]
            return [[n, counts[n], best[n], self.metrics[n]["summary"].get("zh", "") if self.metrics[n]["flags"] & FLAG_EXPLAINED else ""]
                    for n in ranked]

        window_start = shift(self.latest, -29)
        seen_recent = {row["r"] for d in ds.dates if d >= window_start for rows in ds.rows[d].values() for row in rows}
        categories = collections.Counter(t for n in seen_recent if self.metrics[n]["flags"] & FLAG_EXPLAINED
                                         for t in self.metrics[n]["summary"].get("tags") or [] if t in CATEGORIES)
        explained_recent = sum(1 for n in seen_recent if self.metrics[n]["flags"] & FLAG_EXPLAINED)
        owners = sorted(owner_repos, key=lambda o: (-len(owner_repos[o]), -owner_days[o], o.lower()))[:20]
        last30 = set(valid[-30:])
        return {
            "months": months, "archive_start": self.base,
            "ai": [round(100 * ai_month[m][0] / max(ai_month[m][1], 1), 1) for m in months],
            "lang": share, "newcomers": [newcomers.get(m, 0) for m in months],
            "size": [round(sum(size_month[m]) / len(size_month[m]), 1) for m in months],
            "topics": topics,
            "evergreen": {str(k): evergreen(k) for k in (30, 90, 365, 0)},
            "categories": [[t, categories[t]] for t in CATEGORIES if categories[t]],
            "categories_window": {"from": window_start, "repos": len(seen_recent), "explained": explained_recent},
            "owners": [{"o": o, "repos": len(owner_repos[o]), "days": owner_days[o],
                        "top": sorted(owner_repos[o], key=lambda n: (-self.ds.record("all:daily", n).n, n.lower()))[:3]}
                       for o in owners],
            "kpi": {"overall_repos": len(first_seen),
                    "new_per_day_30": round(sum(1 for d in first_seen.values() if d in last30) / max(len(last30), 1), 1),
                    "size_30": round(sum(len(ds.days[d]["lists"].get("all:daily", [])) for d in last30) / max(len(last30), 1), 1)},
        }

    # ------------------------------------------------------------- manifest
    def manifest(self, catalog_rows):
        ds = self.ds
        star_years = sorted({d[:4] for d in ds.star_dates} | {p[0][0][:4] for p in ds.stars.values() if p})
        return {
            "schema": SCHEMA, "generated": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "latest": self.latest, "first": self.base, "dates": date_ranges(ds.dates),
            "stale": [d for d in ds.dates if ds.days[d]["stale"]],
            "live_since": ds.live_dates[0] if ds.live_dates else None,
            "lists": [{"key": s["key"], "name": s["name"], "periods": s["periods"]} for s in ds.lists_config],
            "since": ds.list_since,
            "stars": {"since": min(ds.star_dates) if ds.star_dates else None, "latest": ds.star_latest,
                      "years": star_years},
            "shards": SHARDS, "categories": CATEGORIES,
            "backfill": {"source": ds.backfill_source, "to": max((d for d in ds.dates if ds.days[d]["src"] == "backfill"), default=None)},
            "counts": {"repos": len(catalog_rows), "days": len(ds.dates),
                       "tracked": sum(1 for n in self.repos if self.metrics[n]["stars_date"] == ds.star_latest),
                       "explained": sum(1 for n in self.repos if self.metrics[n]["flags"] & FLAG_EXPLAINED)},
        }

    # ----------------------------------------------------------------- write
    def write(self, target=None):
        target = target or SITE_DATA
        for sub in ("days", "repo", "stars"):
            shutil.rmtree(target / sub, ignore_errors=True)
        for date in self.ds.dates:
            save_json(target / "days" / f"{date}.json", self.day_payload(date), compact=True)

        related = self.related()
        shards = collections.defaultdict(dict)
        for name in self.repos:
            shards[shard_of(name)][name] = self.repo_record(name, related.get(name))
        for name, aliases in sorted(self.ds.aliases.items(), key=lambda x: x[0].lower()):
            for alias in sorted(aliases):
                bucket = shards[shard_of(alias)]
                if alias not in bucket and alias.lower() != name.lower():
                    bucket[alias] = {"redirect": name}
        for key in (shard_key(i) for i in range(SHARDS)):
            save_json(target / "repo" / f"{key}.json", shards.get(key, {}), compact=True)

        by_year = collections.defaultdict(lambda: collections.defaultdict(dict))
        for name in self.repos:
            points = self.metrics[name]["points"]
            for year in sorted({d[:4] for d, _ in points}):
                inside = [p for p in points if p[0][:4] == year]
                by_year[year][shard_of(name)][name] = [inside[0][0], calendar_values(inside, inside[0][0], inside[-1][0])]
        for year, buckets in by_year.items():
            for key in (shard_key(i) for i in range(SHARDS)):
                save_json(target / "stars" / year / f"{key}.json", buckets.get(key, {}), compact=True)

        catalog, search = self.catalog()
        save_json(target / "catalog.json", catalog, compact=True)
        save_json(target / "search.json", search, compact=True)
        save_json(target / "home.json", self.home(), compact=True)
        save_json(target / "insights.json", self.insights(), compact=True)
        manifest = self.manifest(catalog["rows"])
        digest = hashlib.sha1(manifest["generated"].encode()).hexdigest()[:10]
        manifest["version"] = digest
        save_json(target / "index.json", manifest, compact=True)
        return manifest


def main():
    ds = Dataset.load()
    manifest = SiteBuilder(ds).write()
    counts = manifest["counts"]
    print(f"{counts['days']} days ({manifest['first']} .. {manifest['latest']}), {counts['repos']} repos, "
          f"{counts['explained']} explained, {counts['tracked']} with Stars on {manifest['stars']['latest']}, "
          f"{len(manifest['stale'])} stale days -> {SITE_DATA}")


if __name__ == "__main__":
    main()
