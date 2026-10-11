"""Prepare public README sources and import introductions written by a Codex task.

This path needs no separate model endpoint. The task reads the prepared JSON, writes
an array of {repo, zh, what, use_cases, audience, tags}, then imports it with --apply.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor

from common import (META_FILE, SUMMARY_FILE, github_token, iter_snapshots, load_json,
                    save_json, utc_today)
from summarize import (CFG, README_FILE, VERSION, desc_hash, needs_summary,
                       normalise_intro, readme_record, source_reference)


def latest_descriptions():
    latest = {}
    for snapshot in iter_snapshots():
        latest = {item["repo"]: item.get("desc", "")
                  for items in snapshot["lists"].values() for item in items}
    return latest


def prepare(limit, output):
    meta = load_json(META_FILE, {})
    summaries = load_json(SUMMARY_FILE, {})
    readmes = load_json(README_FILE, {})
    todo = [(repo, desc) for repo, desc in latest_descriptions().items()
            if needs_summary(summaries.get(repo), desc, utc_today())][:limit]
    token = github_token()
    if todo and not token:
        raise RuntimeError("GitHub authentication is required to fetch README sources")
    def source(item):
        repo, _ = item
        cached = readmes.get(repo, {})
        return cached if cached.get("date") == utc_today() else readme_record(repo, token)
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(source, todo))
    prepared = []
    for (repo, desc), record in zip(todo, records):
        readmes[repo] = record
        prepared.append({"repo": repo, "description": desc or meta.get(repo, {}).get("desc", ""),
                         "language": meta.get(repo, {}).get("lang"),
                         "readme": record.get("excerpt", ""), "source": record.get("url")})
    save_json(README_FILE, readmes)
    save_json(output, {"date": utc_today(), "tags": CFG["tags"], "projects": prepared})
    print(f"Prepared {len(prepared)} projects in {output}")


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
        if repo not in descriptions or not source.get("url"):
            raise ValueError(f"No prepared latest-snapshot source for {repo}")
        intro = normalise_intro(item)
        if not isinstance(item.get("zh"), str) or not item["zh"].strip() or not intro["what"]:
            raise ValueError(f"Missing explanation for {repo}")
        tags = item.get("tags", [])
        if not isinstance(tags, list) or any(tag not in CFG["tags"] for tag in tags):
            raise ValueError(f"Invalid categories for {repo}")
        updates[repo] = {"zh": item["zh"].strip()[:120], "intro": intro, "tags": tags[:2],
                         "src": desc_hash(descriptions[repo]), "version": VERSION,
                         "source": source_reference(source),
                         "model": "codex-task", "date": utc_today()}
    summaries.update(updates)
    save_json(SUMMARY_FILE, summaries)
    print(f"Imported {len(updates)} introductions")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--output", default="/tmp/github-trending-introduction-sources.json")
    parser.add_argument("--apply", help="JSON array written by Codex; imports only after validation")
    args = parser.parse_args()
    if args.apply:
        apply_introductions(args.apply)
    elif args.limit < 1:
        parser.error("--limit must be at least 1")
    else:
        prepare(args.limit, args.output)


if __name__ == "__main__":
    main()
