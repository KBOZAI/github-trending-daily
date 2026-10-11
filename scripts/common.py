"""Shared paths and helpers for the pipeline scripts."""
import datetime as dt
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"
STAR_SNAPSHOTS = DATA / "stars"
BACKFILL_FILE = DATA / "backfill" / "antonkomarev" / "all-daily.json"
META_FILE = DATA / "repos" / "meta.json"
SUMMARY_FILE = DATA / "repos" / "summaries.json"
SITE_DATA = ROOT / "site" / "data"
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))

UA = "Mozilla/5.0 (github-trending-daily; +https://github.com/KBOZAI/github-trending-daily)"


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def utc_today():
    """Snapshot date label = UTC date of capture (capture runs ~00:17 UTC = 08:17 Beijing)."""
    return utc_now().date().isoformat()


def snapshot_path(date):
    return SNAPSHOTS / date[:4] / f"{date}.json"


def iter_snapshots():
    for p in sorted(SNAPSHOTS.glob("*/*.json")):
        yield json.loads(p.read_text(encoding="utf-8"))


def star_snapshot_path(date):
    return STAR_SNAPSHOTS / date[:4] / f"{date}.json"


def iter_star_snapshots():
    for p in sorted(STAR_SNAPSHOTS.glob("*/*.json")):
        yield json.loads(p.read_text(encoding="utf-8"))


def load_json(path, default):
    path = Path(path)
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path, obj, compact=False):
    """Write JSON. Dicts keyed by repo are written one entry per line so git diffs stay small."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    elif isinstance(obj, dict) and obj and all(isinstance(v, dict) for v in obj.values()):
        lines = [f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, sort_keys=True)}"
                 for k, v in sorted(obj.items())]
        text = "{\n" + ",\n".join(lines) + "\n}\n"
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=1) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def http(url, data=None, headers=None, timeout=60, retries=4):
    """GET/POST with retry; honours https_proxy from the environment."""
    hdrs = {"User-Agent": UA}
    hdrs.update(headers or {})
    body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
    if isinstance(data, (dict, list)):
        hdrs.setdefault("Content-Type", "application/json")
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (401, 404, 422):
                raise
            if e.code == 403 and "rate limit" not in e.read().decode("utf-8", "ignore").lower():
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(5 * (attempt + 1))
    raise last


def github_token():
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        return tok
    try:
        return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None
