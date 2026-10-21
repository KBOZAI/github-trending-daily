"""Prepare public README sources and import introductions written by a Codex task.

This path needs no separate model endpoint. Each run prepares up to --limit projects:
  1. projects on the latest lists whose explanation is missing, outdated or older than 30 days;
  2. once those are covered, a daily quota (--backlog) of projects that trended often in the past
     but never had an explanation, most days on the overall list first.
The task writes an array of {repo, zh, what, use_cases, audience, features?, notes?, tags} and
imports it with --apply. The prepared file carries the writing rules and field definitions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor

from common import (CONFIG, META_FILE, SUMMARY_FILE, github_token, iter_snapshots, load_json,
                    save_json, utc_today)
from summarize import (CFG, FIELDS, GUIDELINES, README_FILE, VERSION, desc_hash, needs_summary,
                       normalise_intro, readme_record, source_reference)

SETTINGS = CONFIG.get("introductions", {})
BACKLOG_PER_DAY = SETTINGS.get("backlog_per_day", 12)


def latest_descriptions():
    latest = {}
    for snapshot in iter_snapshots():
        latest = {item["repo"]: item.get("desc", "")
                  for items in snapshot["lists"].values() for item in items}
    return latest


def backlog_candidates(summaries, exclude):
    """Never-explained projects as (name, metadata), most days on the overall daily list first."""
    from dataset import Dataset
    ds = Dataset.load()
    explained = {k.lower() for k, v in summaries.items() if (v.get("intro") or {}).get("what")}
    ranked = []
    for name, record in ds.records.get("all:daily", {}).items():
        if name.lower() in explained or name in exclude or ds.is_gone(name):
            continue
        aliases = {a.lower() for a in ds.aliases.get(name, ())}
        if aliases & explained:
            continue
        points = ds.star_points(name)
        stars = points[-1][1] if points else (ds.meta(name).get("stars") or 0)
        ranked.append((-record.n, -stars, name.lower(), name))
    return [(name, ds.meta(name)) for *_, name in sorted(ranked)]


def prepare(limit, output, backlog=BACKLOG_PER_DAY):
    meta = load_json(META_FILE, {})
    summaries = load_json(SUMMARY_FILE, {})
    readmes = load_json(README_FILE, {})
    today = utc_today()
    latest = latest_descriptions()
    todo = [(repo, meta.get(repo) or {}, "latest") for repo, desc in latest.items()
            if needs_summary(summaries.get(repo), desc, today, SETTINGS.get("refresh_days", 30))][:limit]
    done_today = sum(1 for repo, s in summaries.items() if s.get("date") == today and repo not in latest)
    room = min(limit - len(todo), max(0, backlog - done_today))
    if room > 0:
        todo += [(repo, info, "backlog") for repo, info in backlog_candidates(summaries, set(latest))[:room]]
    token = github_token()
    if todo and not token:
        raise RuntimeError("GitHub authentication is required to fetch README sources")

    def source(item):
        repo = item[0]
        cached = readmes.get(repo, {})
        return cached if cached.get("date") == today else readme_record(repo, token)
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(source, todo))
    prepared = []
    for (repo, info, reason), record in zip(todo, records):
        desc = latest[repo] if repo in latest else info.get("desc", "")
        readmes[repo] = {**record, "desc": desc}
        prepared.append({"repo": repo, "reason": reason, "description": desc or info.get("desc", ""),
                         "language": info.get("lang"), "topics": info.get("topics", []),
                         "homepage": info.get("homepage", ""), "readme": record.get("excerpt", ""),
                         "source": record.get("url")})
    save_json(README_FILE, readmes)
    save_json(output, {
        "date": today,
        "instructions": {
            "task": "为 projects 中的每个项目写中文解读，输出 JSON 数组，然后用 codex_daily.py import 导入。",
            "rules": GUIDELINES, "fields": FIELDS,
            "format": [{"repo": "owner/name", "zh": "", "what": "", "use_cases": [], "audience": "",
                        "features": [], "notes": [], "tags": []}],
        },
        "tags": CFG["tags"], "projects": prepared})
    counts = {r: sum(1 for *_, reason in todo if reason == r) for r in ("latest", "backlog")}
    print(f"Prepared {len(prepared)} projects in {output} "
          f"({counts['latest']} from the latest lists, {counts['backlog']} from the backlog)")


def apply_introductions(path):
    values = load_json(path, None)
    if not isinstance(values, list):
        raise ValueError("Expected an array of introductions")
    summaries = load_json(SUMMARY_FILE, {})
    readmes = load_json(README_FILE, {})
    descriptions = latest_descriptions()
    updates = {}
    for item in values:
        if not isinstance(item, dict) or not isinstance(item.get("repo"), str):
            raise ValueError("Each introduction must identify a repository")
        repo = item["repo"]
        source = readmes.get(repo, {})
        if not source.get("url"):
            raise ValueError(f"No prepared source for {repo}")
        intro = normalise_intro(item)
        if not isinstance(item.get("zh"), str) or not item["zh"].strip() or not intro["what"]:
            raise ValueError(f"Missing explanation for {repo}")
        tags = item.get("tags", [])
        if not isinstance(tags, list) or any(tag not in CFG["tags"] for tag in tags):
            raise ValueError(f"Invalid categories for {repo}")
        desc = descriptions[repo] if repo in descriptions else source.get("desc", "")
        updates[repo] = {"zh": " ".join(item["zh"].split())[:120], "intro": intro, "tags": tags[:2],
                         "src": desc_hash(desc), "version": VERSION,
                         "source": source_reference(source),
                         "model": "codex-task", "date": utc_today()}
    summaries.update(updates)
    save_json(SUMMARY_FILE, summaries)
    print(f"Imported {len(updates)} introductions")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=SETTINGS.get("per_run", 24))
    parser.add_argument("--backlog", type=int, default=BACKLOG_PER_DAY,
                        help="daily quota of never-explained historical projects (0 disables)")
    parser.add_argument("--output", default="/tmp/github-trending-introduction-sources.json")
    parser.add_argument("--apply", help="JSON array written by Codex; imports only after validation")
    args = parser.parse_args()
    if args.apply:
        apply_introductions(args.apply)
    elif args.limit < 1:
        parser.error("--limit must be at least 1")
    else:
        prepare(args.limit, args.output, args.backlog)


if __name__ == "__main__":
    main()
