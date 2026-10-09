"""One-off import of historical overall daily lists from antonkomarev/github-trending-archive (MIT).

That archive stores only repo names in rank order (no stars/description), captured at the first
successful run after 00:00 UTC and labelled with that UTC date -- the same convention we use.
Its "all languages" list starts on 2023-09-09.

Usage: python scripts/backfill_antonkomarev.py /path/to/github-trending-archive
"""
import json
import shutil
import sys
from pathlib import Path

from common import BACKFILL_FILE, save_json

SOURCE = "https://github.com/antonkomarev/github-trending-archive"


def main():
    src = Path(sys.argv[1])
    days = {}
    for f in sorted(src.glob("archive/repository/*/*/(null).json")):
        j = json.loads(f.read_text(encoding="utf-8"))
        if j.get("list"):
            days[j["date"]] = j["list"]
    out = {
        "source": SOURCE,
        "license": "MIT, Copyright (c) Anton Komarev (see LICENSE in this folder)",
        "note": "Overall daily GitHub Trending lists, repo names in rank order only. "
                "Date = UTC date of capture (~00:00 UTC). Used only for days without our own snapshot.",
        "days": days,
    }
    save_json(BACKFILL_FILE, out)
    shutil.copy(src / "LICENSE", BACKFILL_FILE.parent / "LICENSE")
    print(f"{len(days)} days ({min(days)} .. {max(days)}) -> {BACKFILL_FILE}")


if __name__ == "__main__":
    main()
