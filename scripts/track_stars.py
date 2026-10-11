"""Record daily Stars for all known available repos, including those no longer trending.

The first run preserves dated metadata-cache observations. Later runs never replace past
observations. Same-day retries fetch only unfinished repos unless --force is requested.
"""
import argparse
import datetime as dt
import json
import os
import sys

from common import (META_FILE, github_token, http, load_json, save_json,
                    star_snapshot_path, utc_now, utc_today)


def known_repos(meta):
    return sorted({v.get("canonical") or k for k, v in meta.items() if not v.get("missing")})


def seed_cache(meta, today):
    groups = {}
    for name, entry in meta.items():
        date, stars = entry.get("fetched"), entry.get("stars")
        if not date or date >= today or type(stars) is not int or stars < 0:
            continue
        dt.date.fromisoformat(date)
        canonical = entry.get("canonical") or name
        group = groups.setdefault(date, {})
        if canonical not in group or name == canonical:
            group[canonical] = stars
    changed = False
    for date, stars in groups.items():
        path = star_snapshot_path(date)
        if path.exists():
            continue
        save_json(path, {"date": date, "source": "dated-metadata-cache", "captured_at": None,
                         "note": "Real API observations; only the fetched UTC date was retained.",
                         "stars": stars})
        changed = True
    return changed


def query_batch(names, token):
    fields = []
    for i, name in enumerate(names):
        owner, repo = name.split("/", 1)
        fields.append(f"r{i}: repository(owner: {json.dumps(owner)}, name: {json.dumps(repo)}) "
                      "{ stargazerCount }")
    response = json.loads(http("https://api.github.com/graphql", data={"query": "query { " +
                               " ".join(fields) + " }"},
                               headers={"Authorization": f"bearer {token}"}, timeout=45, retries=2))
    if not response.get("data"):
        raise RuntimeError("GitHub GraphQL returned no repository data")
    not_found = {e["path"][0] for e in response.get("errors", [])
                 if e.get("type") == "NOT_FOUND" and e.get("path")}
    stars, missing, errors = {}, [], {}
    for i, name in enumerate(names):
        alias = f"r{i}"
        node = response["data"].get(alias)
        value = node.get("stargazerCount") if node else None
        if type(value) is int and value >= 0:
            stars[name] = value
        elif alias in not_found:
            missing.append(name)
        else:
            errors[name] = "No Stars value returned; retry needed"
    return stars, missing, errors


def track(meta, token, date, batch_size=50, force=False):
    path = star_snapshot_path(date)
    snap = load_json(path, {"date": date, "stars": {}})
    stars = {} if force else dict(snap.get("stars", {}))
    missing = set() if force else set(snap.get("missing", []))
    candidates = known_repos(meta)
    todo = [r for r in candidates if r not in stars and r not in missing]
    if not todo:
        print(f"Stars already recorded for {len(stars)} repos on {date}; skip")
        return False, {}
    errors = {}
    for start in range(0, len(todo), batch_size):
        batch = todo[start:start + batch_size]
        try:
            found, unavailable, failures = query_batch(batch, token)
            stars.update(found)
            missing.update(unavailable)
            errors.update(failures)
        except Exception as e:
            errors.update({name: str(e) for name in batch})
        save_json(path, {"date": date, "source": "github-graphql",
                         "captured_at": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "stars": stars, "missing": sorted(missing), "errors": errors,
                         "complete": not errors and start + batch_size >= len(todo)})
        if start // batch_size % 10 == 0:
            print(f"Stars: {min(start + batch_size, len(todo))}/{len(todo)} checked", flush=True)
    print(f"Stars saved: {len(stars)} repos, {len(missing)} unavailable, {len(errors)} retry needed")
    return True, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    token = github_token()
    if not token:
        sys.exit("no GitHub token for daily Stars tracking")
    date = utc_today()
    meta = load_json(META_FILE, {})
    seeded = seed_cache(meta, date)
    changed, errors = track(meta, token, date, force=args.force)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as out:
            out.write(f"changed={'true' if changed or seeded else 'false'}\n")
    if errors:
        sys.exit("Some Stars requests failed; saved observations retained for the next retry")


if __name__ == "__main__":
    main()
