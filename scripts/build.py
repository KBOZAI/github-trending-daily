"""Aggregate snapshots + backfill + metadata into the JSON files the website reads (site/data/).

Outputs
  index.json          dates, list definitions, provenance
  days/<date>.json    every list of that day, items annotated with days-on-list / streak / first-time
  repos.json          one entry per repo: metadata, Chinese summary, overall-list history
  stats.json          monthly language & AI share, recent topics, top owners
A day whose overall list is identical to the previous day is marked stale (GitHub's trending
pipeline froze 2025-11-13..12-04) and is not counted in days/streak statistics.
"""
import collections
import re
import shutil

from common import (BACKFILL_FILE, CONFIG, META_FILE, SITE_DATA, SUMMARY_FILE, iter_snapshots,
                    iter_star_snapshots, load_json, save_json, utc_now)

AI_RE = re.compile(
    r"\b(ai|aigc|genai|llms?|gpt\w*|chatgpt|openai|claude|gemini|llama\w*|deepseek|qwen\w*|mistral|"
    r"agents?|agentic|rag|mcp|copilot|langchain|diffusion|transformers?|machine[- ]learning|deep[- ]learning|"
    r"neural|chatbot|prompts?|embeddings?|multimodal|vlm|text-to-\w+|speech-to-text|tts|whisper|"
    r"model context protocol|large language models?|vibe[- ]coding)\b|人工智能|大模型|智能体|大语言模型",
    re.I)
AI_TAGS = {"AI 智能体", "大模型", "AI 应用"}


def main():
    meta = load_json(META_FILE, {})
    summaries = load_json(SUMMARY_FILE, {})
    backfill = load_json(BACKFILL_FILE, {"days": {}, "source": ""})

    def canon(name):
        return (meta.get(name) or {}).get("canonical") or name

    def info(name):
        """Metadata + summary for a repo, looked up under its canonical and original names."""
        c = canon(name)
        m = dict(meta.get(name) or {})
        if c in meta and not meta[c].get("missing"):
            m = dict(meta[c])
        s = summaries.get(c) or summaries.get(name) or {}
        return m, s

    # ---- assemble days: our own snapshots win over backfill ----
    days = {}
    for date, names in backfill["days"].items():
        days[date] = {"src": "backfill", "lists": {"all:daily": [{"rank": i + 1, "repo": n} for i, n in enumerate(names)]}}
    for snap in iter_snapshots():
        days[snap["date"]] = {"src": "live", "lists": snap["lists"], "captured_at": snap["captured_at"]}
    dates = sorted(days)
    didx = {d: i for i, d in enumerate(dates)}

    prev_seq = None
    for d in dates:
        seq = [canon(i["repo"]) for i in days[d]["lists"].get("all:daily", [])]
        days[d]["stale"] = bool(seq) and seq == prev_seq
        prev_seq = seq

    # ---- walk days in order, keep per-list state, annotate items ----
    state = collections.defaultdict(dict)        # list -> repo -> stats
    last_date = {}                               # list -> last non-stale date with data
    first_date = {}                              # list -> first date with data
    repos = {}
    stars_hist = collections.defaultdict(dict)
    # API observations take precedence over the earlier Trending sample of the same UTC day.
    for snap in iter_star_snapshots():
        for name, stars in snap.get("stars", {}).items():
            if type(stars) is int and stars >= 0:
                stars_hist[canon(name)][snap["date"]] = stars
    lists_cfg = {f"{l['key']}:{p}" for l in CONFIG["lists"] for p in l["periods"]}

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    days_dir = SITE_DATA / "days"
    shutil.rmtree(days_dir, ignore_errors=True)
    days_dir.mkdir()

    for d in dates:
        day = days[d]
        out_lists = {}
        for key, items in day["lists"].items():
            if key not in lists_cfg and key != "all:daily":
                continue
            daily = key.endswith(":daily")
            first_date.setdefault(key, d)
            out_items = []
            for it in items:
                c = canon(it["repo"])
                m, s = info(it["repo"])
                row = {
                    "rank": it["rank"], "repo": c,
                    "desc": it.get("desc") if day["src"] == "live" else m.get("desc", ""),
                    "zh": s.get("zh", ""), "tags": s.get("tags", []),
                    "intro": s.get("intro", {}),
                    "lang": it.get("lang") if day["src"] == "live" else m.get("lang"),
                    "topics": m.get("topics", [])[:5], "created": m.get("created"),
                }
                if day["src"] == "live":
                    row.update(stars=it.get("stars"), forks=it.get("forks"), gained=it.get("gained"))
                    observed = stars_hist.get(c, {})
                    if observed:
                        observed_date = max(observed)
                        row.update(stars_latest=observed[observed_date], stars_latest_date=observed_date)
                else:
                    observed = stars_hist.get(c, {})
                    observed_date = max(observed) if observed else m.get("fetched")
                    row["stars_now"] = observed[observed_date] if observed else m.get("stars")
                    row["stars_now_date"] = observed_date
                if m.get("missing"):
                    row["gone"] = True
                if daily:
                    st = state[key].get(c)
                    if not day["stale"] and (st is None or st.get("last") != d):
                        if st is None:
                            st = state[key][c] = {"n": 0, "streak": 0, "max": 0, "best": 999, "first": d, "h": []}
                        st["streak"] = st["streak"] + 1 if st.get("last") == last_date.get(key) else 1
                        st["n"] += 1
                        st["max"] = max(st["max"], st["streak"])
                        st["best"] = min(st["best"], it["rank"])
                        st["last"] = d
                        if key == "all:daily":
                            st["h"].append([didx[d], it["rank"]])
                    if st:
                        today = st.get("last") == d
                        row.update(n=st["n"], st=st["streak"] if today else 0, new=today and st["n"] == 1)
                out_items.append(row)
                if day["src"] == "live" and it.get("stars") is not None:
                    stars_hist[c].setdefault(d, it["stars"])
                repos.setdefault(c, it["repo"])
            out_lists[key] = {"hist": first_date[key] < d, "items": out_items}
            if daily and not day["stale"] and items:
                last_date[key] = d
        out = {"date": d, "src": day["src"], "stale": day["stale"], "lists": out_lists}
        if day.get("captured_at"):
            out["captured_at"] = day["captured_at"]
        save_json(days_dir / f"{d}.json", out, compact=True)

    stars_dir = SITE_DATA / "stars"
    shutil.rmtree(stars_dir, ignore_errors=True)
    stars_dir.mkdir()

    # ---- repos.json (history is loaded per project, keeping the search index small) ----
    latest_live = {}
    for d in dates:
        if days[d]["src"] == "live":
            for items in days[d]["lists"].values():
                for it in items:
                    latest_live[canon(it["repo"])] = it
    repo_out = {}
    for c, orig in repos.items():
        m, s = info(orig)
        live = latest_live.get(c, {})
        r = {
            "d": live.get("desc") or m.get("desc", ""), "zh": s.get("zh", ""), "tags": s.get("tags", []),
            "intro": s.get("intro", {}), "intro_source": s.get("source", {}), "intro_date": s.get("date"),
            "l": live.get("lang") or m.get("lang"), "s": live.get("stars") or m.get("stars"),
            "c": m.get("created"), "t": m.get("topics", []), "lic": m.get("license"), "hp": m.get("homepage", ""),
        }
        if m.get("missing"):
            r["gone"] = True
        a = state["all:daily"].get(c)
        if a:
            r["a"] = {"n": a["n"], "f": a["first"], "l": a["last"], "b": a["best"], "ms": a["max"], "h": a["h"]}
        other = {k: st[c]["n"] for k, st in state.items() if k != "all:daily" and c in st}
        if other:
            r["o"] = other
        if stars_hist.get(c):
            points = sorted(stars_hist[c].items())
            owner, name = c.split("/", 1)
            if owner in (".", "..") or name in (".", "..") or "/" in name:
                raise ValueError(f"Invalid repository name: {c}")
            file = f"stars/{owner}/{name}.json"
            save_json(SITE_DATA / file, {"repo": c, "points": points}, compact=True)
            r["s"] = points[-1][1]
            r["star_history"] = {"file": file, "count": len(points),
                                 "first": points[0][0], "last": points[-1][0]}
        repo_out[c] = r
    save_json(SITE_DATA / "repos.json", repo_out, compact=True)

    # ---- stats.json (overall daily list, non-stale days) ----
    lang_month = collections.defaultdict(collections.Counter)
    ai_month = collections.defaultdict(lambda: [0, 0])
    first_seen = {}
    owner_repos = collections.defaultdict(set)
    owner_days = collections.Counter()
    for d in dates:
        day = days[d]
        if day["stale"]:
            continue
        month = d[:7]
        for it in day["lists"].get("all:daily", []):
            c = canon(it["repo"])
            m, s = info(it["repo"])
            lang = (it.get("lang") if day["src"] == "live" else None) or m.get("lang") or "无语言(文档类)"
            lang_month[month][lang] += 1
            text = " ".join([c.replace("/", " ").replace("-", " "), it.get("desc") or m.get("desc", ""),
                             " ".join(m.get("topics", []))])
            ai_month[month][1] += 1
            if AI_RE.search(text) or AI_TAGS & set(s.get("tags", [])):
                ai_month[month][0] += 1
            first_seen.setdefault(c, d)
            owner_repos[c.split("/")[0]].add(c)
            owner_days[c.split("/")[0]] += 1
    months = sorted(lang_month)
    recent_cut = months[-12:]
    top_langs = [l for l, _ in sum((lang_month[m] for m in recent_cut), collections.Counter()).most_common(9)]
    lang_series = {l: [] for l in top_langs + ["其他"]}
    for mth in months:
        tot = sum(lang_month[mth].values()) or 1
        for l in top_langs:
            lang_series[l].append(round(100 * lang_month[mth][l] / tot, 1))
        lang_series["其他"].append(round(100 * sum(v for k, v in lang_month[mth].items() if k not in top_langs) / tot, 1))

    fresh = [d for d in dates if not days[d]["stale"]]

    def topic_counts(window):
        cnt = collections.Counter()
        for d in window:
            for orig in {canon(i["repo"]): i["repo"] for i in days[d]["lists"].get("all:daily", [])}.values():
                cnt.update(info(orig)[0].get("topics", []))
        return cnt
    recent, before = topic_counts(fresh[-30:]), topic_counts(fresh[-60:-30])
    topics = [{"t": t, "n": n, "prev": before.get(t, 0)} for t, n in recent.most_common(25)]

    owners = sorted(owner_repos, key=lambda o: (len(owner_repos[o]), owner_days[o]), reverse=True)[:20]
    last30 = set(fresh[-30:])
    new_30 = sum(1 for d in first_seen.values() if d in last30) / max(len(last30), 1)
    size_30 = sum(len(days[d]["lists"].get("all:daily", [])) for d in last30) / max(len(last30), 1)
    stats = {
        "months": months,
        "lang": lang_series,
        "ai": [round(100 * ai_month[m][0] / max(ai_month[m][1], 1), 1) for m in months],
        "topics": topics,
        "owners": [{"o": o, "repos": len(owner_repos[o]), "days": owner_days[o]} for o in owners],
        "unique_repos": len(first_seen),
        "new_30": round(new_30, 1),
        "size_30": round(size_30, 1),
    }
    save_json(SITE_DATA / "stats.json", stats, compact=True)

    lists = [{"key": l["key"], "name": l["name"], "periods": l["periods"]} for l in CONFIG["lists"]]
    live = [d for d in dates if days[d]["src"] == "live"]
    bf = sorted(backfill["days"])
    index = {
        "generated": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dates": dates, "latest": dates[-1], "lists": lists,
        "live_since": live[0] if live else None,
        "backfill": {"source": backfill.get("source"), "from": bf[0], "to": bf[-1]} if bf else None,
        "stale": [d for d in dates if days[d]["stale"]],
    }
    save_json(SITE_DATA / "index.json", index, compact=True)
    print(f"{len(dates)} days ({dates[0]} .. {dates[-1]}), {len(repo_out)} repos, "
          f"{len(index['stale'])} stale days -> {SITE_DATA}")


if __name__ == "__main__":
    main()
