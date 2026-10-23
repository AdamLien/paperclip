#!/usr/bin/env python3
"""Stage a verified browser artifact beside the active server. Never restart it."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('artifact', type=Path)
parser.add_argument('runtime', type=Path)
parser.add_argument('--expected-server', required=True, type=Path)
args = parser.parse_args()
artifact = args.artifact.resolve()
runtime = args.runtime.resolve()
binding = runtime / 'node_modules/@paperclipai/server'
previous = binding.resolve()
if previous != args.expected_server.resolve():
    raise SystemExit('Active server changed; inspect before staging')
manifest = json.loads((artifact / 'manifest.json').read_text())
number = manifest['buildNumber']
if manifest['environment'] != 'prod' or not number.isdecimal() or len(number) != 11 or int(number[8:]) % 2:
    raise SystemExit('Expected a production artifact with an even build number')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

for name, expected in manifest['hashes'].items():
    path = (artifact / name).resolve()
    if not path.is_relative_to(artifact) or digest(path) != expected:
        raise SystemExit('Artifact checksum mismatch')
for name, expected in manifest['baselineHashes'].items():
    path = previous / Path(name).relative_to('server')
    if digest(path) != expected:
        raise SystemExit('Runtime baseline drift: ' + name)
release = runtime / 'releases' / number
release.mkdir()  # Never overwrite an existing release.
shutil.copytree(previous, release / 'server', symlinks=True)
ui_binding = release / 'server/ui-dist'
if not ui_binding.is_symlink():
    raise SystemExit('Expected a versioned UI symlink')
ui_binding.unlink()
shutil.copytree(artifact / 'server/ui-dist', release / 'ui')
ui_binding.symlink_to(release / 'ui', target_is_directory=True)
for path in (artifact / 'server/dist').rglob('*.js'):
    destination = release / 'server/dist' / path.relative_to(artifact / 'server/dist')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, destination)
shutil.copytree(artifact / 'skills', release / 'skill-packages')
for name, expected in manifest['hashes'].items():
    if name.startswith('skills/'):
        installed = release / 'skill-packages' / Path(name).relative_to('skills')
    else:
        installed = release / name
    if digest(installed) != expected:
        raise SystemExit('Staged release checksum mismatch: ' + name)
(release / 'deployment.json').write_text(json.dumps({**manifest, 'previousServer': str(previous), 'activated': False}, indent=2))
# Use the actual installed dependency graph, without binding a port or creating a DB.
subprocess.run(['node', '--input-type=module', '-e', f'await import({json.dumps((release / "server/dist/routes/crew-browser.js").as_uri())}); console.log("browser route imports successfully");'], check=True, timeout=30)
print(json.dumps({'release': str(release), 'previous': str(previous), 'activated': False, 'skillAssigned': False}))
