"""Write a one-line Chinese summary + category tags for trending repos with an LLM (optional).

Needs an OpenAI-compatible endpoint: env LLM_API_KEY (required), LLM_BASE_URL, LLM_MODEL
(defaults in config.json: Zhipu GLM-4.7-Flash, free). Without LLM_API_KEY it exits quietly and the
site falls back to the original English description.

Default scope: every repo in the latest snapshot that has no summary yet (or whose description
changed). --backfill N additionally summarises the N most-trended historical repos lacking one.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse

from common import (BACKFILL_FILE, CONFIG, META_FILE, SUMMARY_FILE, github_token, http, iter_snapshots,
                    load_json, save_json, utc_today)

CFG = CONFIG["llm"]
PROMPT = """你是开源项目编辑。下面是若干 GitHub 项目的简介和 README 摘录。请为每个项目写：
- zh：一句中文简介（不超过 45 个字），说清它是什么、能做什么；不要复述项目名，不要用"这是一个"开头，不夸张。
- tags：从这个列表中选 1~2 个最贴切的分类：{tags}

只输出 JSON 数组，不要任何其它文字，格式：[{{"repo": "owner/name", "zh": "...", "tags": ["..."]}}]

{items}"""


def desc_hash(text):
    return hashlib.md5(" ".join((text or "").split()).encode()).hexdigest()[:8]


def readme_excerpt(repo, token, limit=1500):
    try:
        raw = http(f"https://api.github.com/repos/{urllib.parse.quote(repo)}/readme",
                   headers={"Authorization": f"bearer {token}", "Accept": "application/vnd.github.raw"},
                   timeout=30, retries=2)
    except Exception:
        return ""
    text = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)          # images / badges
    text = re.sub(r"<[^>]+>", " ", text)                        # html tags
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)       # keep link text
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()[:limit]


def call_llm(items_text):
    base = os.environ.get("LLM_BASE_URL") or CFG["default_base_url"]
    model = os.environ.get("LLM_MODEL") or CFG["default_model"]
    body = {
        "model": model,
        "temperature": 0.3,
        "messages": [{"role": "user", "content": PROMPT.format(tags="、".join(CFG["tags"]), items=items_text)}],
    }
    if "bigmodel.cn" in base:  # GLM-4.x-Flash are hybrid-thinking models; skip thinking for speed
        body["thinking"] = {"type": "disabled"}
    raw = http(base.rstrip("/") + "/chat/completions", data=body, timeout=180, retries=3,
               headers={"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"}).strip()
    if raw.startswith("data:"):  # some OpenAI-compatible proxies answer with SSE even without stream=true
        text = ""
        for line in raw.splitlines():
            payload = line[5:].strip() if line.startswith("data:") else ""
            if payload and payload != "[DONE]":
                for ch in json.loads(payload).get("choices", []):
                    text += (ch.get("delta") or ch.get("message") or {}).get("content") or ""
    else:  # raw_decode tolerates trailing junk such as "data: [DONE]"
        text = json.JSONDecoder().raw_decode(raw)[0]["choices"][0]["message"]["content"]
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    return json.loads(text[text.find("["): text.rfind("]") + 1]), model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", type=int, default=0, help="also summarise N most-trended historical repos")
    ap.add_argument("--limit", type=int, default=0, help="cap the number of repos this run (0 = no cap)")
    args = ap.parse_args()
    if not os.environ.get("LLM_API_KEY"):
        print("LLM_API_KEY not set, skip Chinese summaries")
        return

    meta = load_json(META_FILE, {})
    summaries = load_json(SUMMARY_FILE, {})
    latest = {}
    for snap in iter_snapshots():
        latest = {i["repo"]: i["desc"] for items in snap["lists"].values() for i in items}

    def needs(repo, desc):
        s = summaries.get(repo)
        return s is None or s.get("src") != desc_hash(desc)

    todo = [(r, d) for r, d in latest.items() if needs(r, d)]
    if args.backfill:
        counts = {}
        for day in load_json(BACKFILL_FILE, {"days": {}})["days"].values():
            for r in day:
                counts[r] = counts.get(r, 0) + 1
        hist = [r for r in sorted(counts, key=counts.get, reverse=True)
                if r not in summaries and r not in latest and not meta.get(r, {}).get("missing")]
        todo += [(r, meta.get(r, {}).get("desc", "")) for r in hist[:args.backfill]]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(todo)} repos to summarise")
    token = github_token()

    size, done = CFG["batch_size"], 0
    for start in range(0, len(todo), size):
        batch = todo[start:start + size]
        blocks = []
        for repo, desc in batch:
            m = meta.get(repo, {})
            blocks.append(f"### {repo}\n语言: {m.get('lang') or '-'}；topics: {', '.join(m.get('topics', [])) or '-'}\n"
                          f"简介: {desc or m.get('desc') or '-'}\nREADME 摘录:\n{readme_excerpt(repo, token) if token else ''}")
        try:
            result, model = call_llm("\n\n".join(blocks))
        except Exception as e:
            print(f"batch {start} failed: {e}", file=sys.stderr)
            continue
        by_repo = {r["repo"].lower(): r for r in result if isinstance(r, dict) and r.get("repo")}
        for repo, desc in batch:
            r = by_repo.get(repo.lower())
            if not r or not r.get("zh"):
                continue
            tags = [t for t in r.get("tags", []) if t in CFG["tags"]][:2]
            summaries[repo] = {"zh": r["zh"].strip(), "tags": tags, "src": desc_hash(desc),
                               "model": model, "date": utc_today()}
            done += 1
        save_json(SUMMARY_FILE, summaries)
        time.sleep(1)
    print(f"summarised {done}/{len(todo)}")


if __name__ == "__main__":
    main()
