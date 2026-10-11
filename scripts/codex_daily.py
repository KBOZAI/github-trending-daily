"""Local Codex daily pipeline: capture, prepare introductions, import, and publish.

Codex writes the introductions itself between capture/prepare and import/publish.
Only this repository's main and gh-pages branches can be pushed. No model API is used.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

from common import ROOT, http, load_json, utc_now, utc_today

REMOTE = "https://github.com/KBOZAI/github-trending-daily.git"
REPO = "KBOZAI/github-trending-daily"
SITE = "https://kbozai.github.io/github-trending-daily/"
SOURCE_FILE = "/tmp/trending-sources.json"


def command(args, cwd=ROOT, capture=False):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=capture)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args[0]}")
    return result.stdout.strip() if capture else ""


def git_args(*args):
    options = ["git", "-c", "http.version=HTTP/1.1", "-c", "credential.helper=",
               "-c", "credential.helper=!gh auth git-credential"]
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        options += ["-c", f"http.proxy={proxy}"]
    return options + list(args)


def check_repository():
    remote = command(["git", "remote", "get-url", "origin"], capture=True)
    parsed = urllib.parse.urlparse(remote)
    if parsed.hostname != "github.com" or parsed.username or parsed.password or \
            parsed.path.rstrip("/").removesuffix(".git").lower() != "/kbozai/github-trending-daily":
        raise RuntimeError("Unexpected origin; only the configured GitHub Trending repository is allowed")
    if command(["git", "branch", "--show-current"], capture=True) != "main":
        raise RuntimeError("Run daily maintenance from the main checkout")


def run_script(name, *args):
    command([sys.executable, str(ROOT / "scripts" / name), *args])


def prepare_sources():
    run_script("prepare_introductions.py", "--limit", "24", "--output", SOURCE_FILE)


def capture():
    check_repository()
    if command(["git", "status", "--porcelain"], capture=True):
        raise RuntimeError("Working tree has pending changes; preserve them and resolve before capture")
    command(git_args("pull", "--ff-only", "origin", "main"))
    run_script("scrape.py")
    run_script("enrich.py")
    run_script("track_stars.py")
    prepare_sources()


def check_site(site):
    site = Path(site)
    allowed = {"index.html", "app.js", "style.css", "vendor", "data", ".nojekyll", "CNAME", "404.html"}
    if any(path.name not in allowed for path in site.iterdir()):
        raise RuntimeError("Unexpected file in site/; review it before public publication")
    for name in ["index.html", "app.js", "style.css", "vendor/echarts.min.js", "data/index.json", "data/repos.json"]:
        if not (site / name).is_file():
            raise RuntimeError(f"Missing publication file: {name}")
    if any(path.is_symlink() for path in site.rglob("*")):
        raise RuntimeError("Publication must contain regular static files, without symbolic links")
    index = load_json(site / "data/index.json", {})
    day = load_json(site / "data/days" / f"{index.get('latest')}.json", {})
    if not day.get("lists", {}).get("all:daily", {}).get("items"):
        raise RuntimeError("The latest daily list is empty")
    return index


def copy_site(source, destination):
    check_site(source)
    destination = Path(destination)
    for path in destination.iterdir():
        if path.name in (".git", "CNAME"):
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    for path in Path(source).iterdir():
        target = destination / path.name
        if path.is_dir():
            shutil.copytree(path, target)
        else:
            shutil.copy2(path, target)
    (destination / ".nojekyll").write_text("")


def publish_static():
    index = check_site(ROOT / "site")
    sha = command(["git", "rev-parse", "HEAD"], capture=True)
    with tempfile.TemporaryDirectory(prefix="codex-trending-pages-") as folder:
        target = Path(folder)
        command(["git", "init", "-q", "--initial-branch=gh-pages"], cwd=target)
        command(["git", "remote", "add", "origin", REMOTE], cwd=target)
        lookup = subprocess.run(git_args("ls-remote", "--exit-code", "--heads", "origin", "gh-pages"),
                                cwd=target, text=True, capture_output=True)
        if lookup.returncode == 0:
            command(git_args("fetch", "--depth=1", "origin", "gh-pages"), cwd=target)
            command(["git", "checkout", "-q", "-B", "gh-pages", "FETCH_HEAD"], cwd=target)
        elif lookup.returncode != 2:
            raise RuntimeError("Cannot check gh-pages; preserve the remote publication")
        copy_site(ROOT / "site", target)
        manifest = {"source_sha": sha, "latest": index["latest"],
                    "published_at": utc_now().isoformat(), "publisher": "local-codex"}
        (target / "data/publication.json").write_text(json.dumps(manifest) + "\n")
        command(["git", "config", "user.name", "KBOZAI"], cwd=target)
        command(["git", "config", "user.email", "132818291+KBOZAI@users.noreply.github.com"], cwd=target)
        command(["git", "add", "--all"], cwd=target)
        command(["git", "commit", "-q", "-m", f"pages: {index['latest']} via Codex"], cwd=target)
        command(git_args("push", "origin", "HEAD:gh-pages"), cwd=target)
    print(json.dumps(manifest), flush=True)


def publish():
    check_repository()
    # Only the data authored by this task may be committed automatically.
    changed = command(["git", "diff", "--name-only", "HEAD"], capture=True).splitlines()
    new = command(["git", "ls-files", "--others", "--exclude-standard"], capture=True).splitlines()
    def owned_data(path):
        return path.startswith(("data/snapshots/", "data/stars/")) or path in (
            "data/repos/meta.json", "data/repos/summaries.json")
    if any(not owned_data(path) for path in changed + new):
        raise RuntimeError("Changes outside generated daily data need review; preserve unrelated work")
    command([sys.executable, "-m", "unittest", "discover", "-s", "tests"])
    run_script("build.py")
    check_site(ROOT / "site")
    command(git_args("fetch", "origin", "main"))
    head = command(["git", "rev-parse", "HEAD"], capture=True)
    remote = command(["git", "rev-parse", "origin/main"], capture=True)
    if head != remote:
        raise RuntimeError("main changed remotely; sync and revalidate before publication")
    if changed or new:
        command(["git", "add", "--", "data/snapshots", "data/stars", "data/repos/meta.json", "data/repos/summaries.json"])
        command(["git", "commit", "-m", f"data: {utc_today()} via Codex"])
        command(git_args("push", "origin", "main"))
    publish_static()


def verify():
    expected = command(["git", "rev-parse", "HEAD"], capture=True)
    manifest = json.loads(http(SITE + "data/publication.json?check=" + expected, timeout=30, retries=2))
    if manifest.get("source_sha") != expected:
        raise RuntimeError("Pages has not published this revision yet; retry verification after deployment")
    index = json.loads(http(SITE + "data/index.json?check=" + expected, timeout=30, retries=2))
    if index["latest"] != manifest["latest"]:
        raise RuntimeError("Live publication has inconsistent dates")
    print(json.dumps({"site": SITE, **manifest}), flush=True)


def main():
    # Reuse the user's currently configured local network proxy when available.
    # Nothing is changed globally; if it is stopped, normal networking is used.
    if not (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")):
        try:
            with socket.create_connection(("127.0.0.1", 6789), timeout=0.3):
                os.environ["HTTPS_PROXY"] = "http://127.0.0.1:6789"
                os.environ["https_proxy"] = "http://127.0.0.1:6789"
        except OSError:
            pass
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["capture", "prepare", "import", "publish", "publish-static", "verify"])
    parser.add_argument("--input", default="/tmp/trending-introductions.json")
    args = parser.parse_args()
    if args.mode == "capture":
        capture()
    elif args.mode == "prepare":
        prepare_sources()
    elif args.mode == "import":
        run_script("prepare_introductions.py", "--apply", args.input)
    elif args.mode == "publish":
        publish()
    elif args.mode == "publish-static":
        check_repository()
        publish_static()
    else:
        verify()


if __name__ == "__main__":
    main()
