"""Fetch the GitHub Trending pages listed in config.json and save today's snapshot.

Usage: python scripts/scrape.py [--force] [--date YYYY-MM-DD]
Skips when today's snapshot already exists (the workflow runs twice a day as a fallback).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse

from bs4 import BeautifulSoup

from common import CONFIG, http, iter_snapshots, save_json, snapshot_path, utc_now, utc_today


def list_url(spec, period):
    url = "https://github.com/trending"
    if spec.get("path"):
        url += "/" + urllib.parse.quote(spec["path"], safe="")
    query = {"since": period, **spec.get("query", {})}
    return url + "?" + urllib.parse.urlencode(query)


def _int(node):
    if node is None:
        return None
    digits = re.sub(r"[^\d]", "", node.get_text())
    return int(digits) if digits else None


def parse(html):
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for rank, art in enumerate(soup.select("article.Box-row"), 1):
        link = art.select_one("h2 a[href]")
        if link is None:
            continue
        repo_id = None
        try:
            repo_id = json.loads(link.get("data-hydro-click", "{}"))["payload"]["record_id"]
        except (ValueError, KeyError, TypeError):
            pass
        desc = art.select_one("p")
        lang = art.select_one('[itemprop="programmingLanguage"]')
        items.append({
            "rank": rank,
            "repo": link["href"].strip("/"),
            "id": repo_id,
            "desc": " ".join(desc.get_text().split()) if desc else "",
            "lang": lang.get_text(strip=True) if lang else None,
            "stars": _int(art.select_one('a[href$="/stargazers"]')),
            "forks": _int(art.select_one('a[href$="/forks"]')),
            "gained": _int(art.select_one("span.float-sm-right")),
        })
    return items


def previous_snapshot(date):
    prev = None
    for snap in iter_snapshots():
        if snap["date"] >= date:
            break
        prev = snap
    return prev


def set_output(changed):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=utc_today())
    ap.add_argument("--force", action="store_true", help="overwrite an existing snapshot")
    args = ap.parse_args()

    path = snapshot_path(args.date)
    if path.exists() and not args.force:
        print(f"{path.name} exists, skip (use --force to overwrite)")
        set_output(False)
        return

    lists, errors = {}, {}
    for spec in CONFIG["lists"]:
        for period in spec["periods"]:
            key = f"{spec['key']}:{period}"
            try:
                lists[key] = parse(http(list_url(spec, period)))
                print(f"{key:18s} {len(lists[key]):3d} repos")
            except Exception as e:  # a single language page failing should not lose the day
                errors[key] = str(e)
                print(f"{key:18s} FAILED: {e}", file=sys.stderr)
            time.sleep(1)

    if not lists.get("all:daily"):
        sys.exit("overall daily list is empty: page layout changed or request blocked")

    snap = {"date": args.date, "captured_at": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"), "lists": lists}
    if errors:
        snap["errors"] = errors
    # GitHub's trending pipeline has frozen before (2025-11-13 .. 2025-12-04); flag identical days.
    prev = previous_snapshot(args.date)
    if prev and [i["repo"] for i in prev["lists"].get("all:daily", [])] == [i["repo"] for i in lists["all:daily"]]:
        snap["stale"] = True
        print("warning: overall list identical to previous snapshot (marked stale)")
    save_json(path, snap)
    print(f"saved {path}")
    set_output(True)


if __name__ == "__main__":
    main()
