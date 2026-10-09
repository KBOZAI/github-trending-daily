"""Fetch repository metadata (topics, created date, license...) via the GitHub GraphQL API.

Fetches every repo seen in snapshots/backfill that has no metadata yet, and refreshes repos in the
latest snapshot whose metadata is older than --refresh-days. Results cache in data/repos/meta.json.
"""
import argparse
import datetime as dt
import json
import sys

from common import BACKFILL_FILE, META_FILE, github_token, http, iter_snapshots, load_json, save_json, utc_today

FIELDS = """databaseId nameWithOwner description homepageUrl createdAt pushedAt
stargazerCount forkCount isArchived isFork owner { __typename }
primaryLanguage { name } licenseInfo { spdxId }
repositoryTopics(first: 8) { nodes { topic { name } } }"""


def query_batch(names, token):
    parts = []
    for i, name in enumerate(names):
        owner, repo = name.split("/", 1)
        parts.append(f"r{i}: repository(owner: {json.dumps(owner)}, name: {json.dumps(repo)}) {{ {FIELDS} }}")
    body = {"query": "query {\n" + "\n".join(parts) + "\n}"}
    resp = json.loads(http("https://api.github.com/graphql", data=body,
                           headers={"Authorization": f"bearer {token}"}))
    if not resp.get("data"):
        raise RuntimeError(f"GraphQL error: {resp.get('errors')}")
    not_found = {e["path"][0] for e in resp.get("errors", []) if e.get("type") == "NOT_FOUND" and e.get("path")}
    today = utc_today()
    out = {}
    for i, name in enumerate(names):
        node = resp["data"].get(f"r{i}")
        if node is None:
            if f"r{i}" in not_found:  # deleted, renamed away or made private
                out[name] = {"missing": True, "fetched": today}
            continue
        entry = {
            "id": node["databaseId"],
            "desc": node["description"] or "",
            "lang": (node["primaryLanguage"] or {}).get("name"),
            "topics": [t["topic"]["name"] for t in node["repositoryTopics"]["nodes"]],
            "created": node["createdAt"][:10],
            "pushed": (node["pushedAt"] or "")[:10],
            "stars": node["stargazerCount"],
            "forks": node["forkCount"],
            "license": (node["licenseInfo"] or {}).get("spdxId"),
            "homepage": node["homepageUrl"] or "",
            "org": node["owner"]["__typename"] == "Organization",
            "fetched": today,
        }
        if node["isArchived"]:
            entry["archived"] = True
        if node["isFork"]:
            entry["fork"] = True
        if node["nameWithOwner"].lower() != name.lower():
            entry["canonical"] = node["nameWithOwner"]
        out[name] = entry
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-days", type=int, default=30)
    ap.add_argument("--batch", type=int, default=50)
    args = ap.parse_args()

    names, latest = set(), []
    for snap in iter_snapshots():
        latest = [i["repo"] for items in snap["lists"].values() for i in items]
        names.update(latest)
    for day in load_json(BACKFILL_FILE, {"days": {}})["days"].values():
        names.update(day)

    meta = load_json(META_FILE, {})
    cutoff = (dt.date.fromisoformat(utc_today()) - dt.timedelta(days=args.refresh_days)).isoformat()
    todo = sorted(n for n in names if n not in meta)
    todo += sorted(n for n in set(latest) if n in meta and meta[n]["fetched"] < cutoff)
    print(f"{len(names)} repos known, {len(meta)} cached, {len(todo)} to fetch")
    token = github_token()
    if not token:
        sys.exit("no GitHub token (set GITHUB_TOKEN or log in with gh)")

    for start in range(0, len(todo), args.batch):
        batch = todo[start:start + args.batch]
        try:
            meta.update(query_batch(batch, token))
        except Exception as e:  # retry one by one so a single bad name cannot sink the batch
            print(f"batch {start} failed ({e}); retrying individually", file=sys.stderr)
            for name in batch:
                try:
                    meta.update(query_batch([name], token))
                except Exception as e2:
                    print(f"  {name}: {e2}", file=sys.stderr)
        if start // args.batch % 10 == 0:
            save_json(META_FILE, meta)
            print(f"  {min(start + args.batch, len(todo))}/{len(todo)}")
    save_json(META_FILE, meta)
    missing = sum(1 for v in meta.values() if v.get("missing"))
    print(f"done: {len(meta)} cached ({missing} deleted/private)")


if __name__ == "__main__":
    main()
