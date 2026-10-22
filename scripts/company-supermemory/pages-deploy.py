#!/usr/bin/python3
"""Static Pages preview queue; provider credentials never enter agent sandboxes."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import uuid

MAX_TOTAL = 1024 * 1024 * 1024
MAX_FILE = 25 * 1024 * 1024
MAX_ARCHIVE = 1100 * 1024 * 1024
MAX_FILES = 10000


def extract_static(source, target):
    """Extract only bounded plain assets, without filesystem links or executable Workers."""
    target.mkdir(parents=True, exist_ok=False)
    seen, total = set(), 0
    with tarfile.open(source, "r:") as archive:
        for item in archive:
            name = PurePosixPath(item.name)
            if (name.is_absolute() or ".." in name.parts or not name.parts
                    or any(part.startswith(".") for part in name.parts)
                    or name.name in {"wrangler.json", "wrangler.jsonc", "wrangler.toml"}
                    or "_worker.js" in name.parts or "functions" in name.parts):
                raise ValueError("Unsupported static asset path")
            if not item.isfile() or name in seen:
                raise ValueError("Only unique regular files are allowed")
            seen.add(name)
            total += item.size
            if item.size > MAX_FILE or total > MAX_TOTAL or len(seen) > MAX_FILES:
                raise ValueError("Static deployment exceeds size limits")
            destination = target / str(name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(item) as content, destination.open("xb") as output:
                shutil.copyfileobj(content, output)
    if not (target / "index.html").is_file():
        redirects = target / "_redirects"
        locale_home = (target / "zh.html").is_file()
        root_redirect = redirects.is_file() and "/ /zh/ 302" in redirects.read_text().splitlines()
        if not locale_home or not root_redirect:
            raise ValueError("Static deployment requires a homepage or the website locale redirect")


def prepare_locale_navigation(target):
    """Preserve the existing site's locale-less links in a Functions-free preview."""
    redirects = target / "_redirects"
    if not (target / "zh.html").is_file() or not redirects.is_file():
        return
    original = redirects.read_text()
    if "/ /zh/ 302" not in original.splitlines():
        return
    routes = {line.split()[0] for line in original.splitlines() if line.strip() and not line.startswith("#")}
    aliases = []
    for page in sorted((target / "zh").rglob("*.html")):
        route = "/" + page.relative_to(target / "zh").with_suffix("").as_posix()
        if route not in routes:
            aliases.append(f"{route} /zh{route} 302")
        if page.with_suffix(".txt").is_file() and route + ".txt" not in routes:
            aliases.append(f"{route}.txt /zh{route}.txt 302")
    if len(aliases) > 1500:
        raise ValueError("Too many static preview locale aliases")
    redirects.write_text("\n".join(aliases) + "\n" + original)
    return len(aliases)


def submit(directory, workspace):
    """Snapshot current-agent assets into an atomic request; no target/credential options."""
    root = directory.resolve(strict=True)
    if not root.is_relative_to(workspace.resolve()) or not root.is_dir():
        raise ValueError("Assets must be inside the current agent workspace")
    queue = workspace / "pages-preview-queue"
    queue.mkdir(mode=0o700, exist_ok=True)
    job = uuid.uuid4().hex
    temporary = queue / (job + ".upload")
    count, total = 0, 0
    try:
        with tarfile.open(temporary, "w", dereference=False) as archive:
            for parent, dirs, files in os.walk(root, followlinks=False):
                if any((Path(parent) / name).is_symlink() for name in dirs):
                    raise ValueError("Asset symlinks are not allowed")
                for name in sorted(files):
                    path = Path(parent) / name
                    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as content:
                        metadata = os.fstat(content.fileno())
                        if not stat.S_ISREG(metadata.st_mode):
                            raise ValueError("Assets must be regular files")
                        count += 1
                        total += metadata.st_size
                        if count > MAX_FILES or total > MAX_TOTAL or metadata.st_size > MAX_FILE:
                            raise ValueError("Static deployment exceeds size limits")
                        entry = tarfile.TarInfo(path.relative_to(root).as_posix())
                        entry.size = metadata.st_size
                        archive.addfile(entry, content)
        temporary.rename(queue / (job + ".tar"))
    finally:
        temporary.unlink(missing_ok=True)
    return job


def process(policy):
    """Trusted host worker deploys one approved agent queue to one preview target."""
    workspace = Path(policy["workspace"])
    queue = workspace / "pages-preview-queue"
    if not queue.is_dir() or queue.is_symlink():
        return
    state = Path(policy["state"])
    state.mkdir(parents=True, exist_ok=True)
    queue_fd = os.open(queue, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        process_queue(policy, state, queue_fd)
    finally:
        os.close(queue_fd)


def process_queue(policy, state, queue_fd):
    requests = sorted(name for name in os.listdir(queue_fd)
                      if re.fullmatch(r"[a-f0-9]{32}\.tar", name))
    for request in requests[:1]:
        job = Path(request).stem
        result = job + ".json"
        try:
            os.stat(result, dir_fd=queue_fd, follow_symlinks=False)
            os.unlink(request, dir_fd=queue_fd)
            continue
        except FileNotFoundError:
            pass
        outcome = {"job": job, "status": "failed", "project": policy["project"], "branch": policy["branch"]}
        try:
            with tempfile.TemporaryDirectory(prefix="job-", dir=state) as stage:
                stage = Path(stage)
                with os.fdopen(os.open(request, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=queue_fd), "rb") as source:
                    metadata = os.fstat(source.fileno())
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_ARCHIVE:
                        raise ValueError("Invalid request archive")
                    snapshot = stage / "request.tar"
                    with snapshot.open("xb") as output:
                        remaining = MAX_ARCHIVE + 1
                        while remaining:
                            chunk = source.read(min(1024 * 1024, remaining))
                            if not chunk:
                                break
                            output.write(chunk)
                            remaining -= len(chunk)
                    if snapshot.stat().st_size > MAX_ARCHIVE:
                        raise ValueError("Invalid request archive")
                with snapshot.open("rb") as content:
                    outcome["sha256"] = hashlib.file_digest(content, "sha256").hexdigest()
                out = stage / "out"
                extract_static(snapshot, out)
                outcome["locale_aliases"] = prepare_locale_navigation(out) or 0
                if (out / "_redirects").exists():
                    (state / (job + ".redirects")).write_bytes((out / "_redirects").read_bytes())
                # Config and cwd are operator-owned; never execute agent Functions/build commands.
                config = stage / "wrangler.json"
                config.write_text(json.dumps({"name": policy["project"], "pages_build_output_dir": "./out", "compatibility_date": "2026-10-22"}))
                env = {"HOME": policy["authHome"], "PATH": "/usr/local/bin:/usr/bin:/bin",
                       "LANG": "C.UTF-8", "CI": "1", "WRANGLER_SEND_METRICS": "false",
                       "CLOUDFLARE_ACCOUNT_ID": policy["account"]}
                run = subprocess.run([policy["node"], policy["wrangler"], "pages", "deploy", str(out),
                    "--project-name", policy["project"], "--branch", policy["branch"],
                    "--commit-dirty=true"],
                    cwd=stage, env=env, capture_output=True, text=True, timeout=180)
                output = run.stdout + run.stderr
                (state / (job + ".log")).write_text(output)
                urls = re.findall(r"https://[a-f0-9]{8}\." + re.escape(policy["project"]) + r"\.pages\.dev", output)
                if run.returncode != 0 or not urls:
                    raise ValueError("Cloudflare deployment failed; operator log: " + job)
                outcome.update(status="succeeded", url=urls[-1])
        except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError) as error:
            outcome["error"] = str(error)
        temporary = job + "." + uuid.uuid4().hex + ".result"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=queue_fd)
        with os.fdopen(descriptor, "w") as output:
            output.write(json.dumps(outcome))
        os.replace(temporary, result, src_dir_fd=queue_fd, dst_dir_fd=queue_fd)
        os.unlink(request, dir_fd=queue_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("directory", nargs="?")
    args = parser.parse_args()
    if args.worker:
        process(json.loads(Path("/etc/crew-pages-preview.json").read_text()))
        return
    policy = json.loads(Path("/etc/crew-pages-preview.json").read_text())
    if (os.environ.get("PAPERCLIP_COMPANY_ID") != policy["company"]
            or os.environ.get("PAPERCLIP_AGENT_ID") != policy["agent"]):
        raise ValueError("This company/agent has no Pages preview permission")
    if not args.directory:
        parser.error("Supply the generated static output directory")
    workspace = Path(policy["workspace"])
    job = submit(Path(args.directory), workspace)
    print(json.dumps({"job": job, "status": "queued"}), flush=True)
    result = workspace / "pages-preview-queue" / (job + ".json")
    for _ in range(240):
        if result.is_file():
            outcome = json.loads(result.read_text())
            print(json.dumps(outcome), flush=True)
            raise SystemExit(0 if outcome["status"] == "succeeded" else 1)
        time.sleep(1)
    raise SystemExit("Preview still queued; read pages-preview-queue/" + job + ".json later")


if __name__ == "__main__":
    main()
