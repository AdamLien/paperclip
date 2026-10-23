#!/usr/bin/python3
"""Install only operator-pinned recipes inside the current company's Codex home."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

RECIPES = {'media': {'lock': Path('/opt/crew-media/requirements.lock'),
    'python': '/opt/crew-media/venv/bin/python', 'script': '/opt/crew-media/media-tools.py'}}


def managed_root(env):
    company = env.get('PAPERCLIP_COMPANY_ID', '')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', company):
        raise ValueError('A company-scoped agent run is required')
    home = Path(env.get('CODEX_HOME', ''))
    if not home.is_absolute() or home.resolve() != home or home.parent.name != company:
        raise ValueError('CODEX_HOME must be the managed home of the authenticated company')
    root = home / 'crew-runtime'
    if root.exists() and root.resolve() != root:
        raise ValueError('Runtime root must not be a symlink')
    return root


def safe_version(root, recipe, revision):
    if recipe not in RECIPES or not re.fullmatch(r'[a-f0-9]{16}', revision):
        raise ValueError('Unknown pinned recipe revision')
    target = root / recipe / 'versions' / revision
    if target.resolve() != target:
        raise ValueError('Recipe paths must not contain symlinks')
    return target


def active(root, recipe):
    pointer = root / recipe / 'active.json'
    if not pointer.exists(): return None
    if pointer.is_symlink(): raise ValueError('Invalid runtime pointer')
    value = json.loads(pointer.read_text())
    target = safe_version(root, recipe, value['revision'])
    if not (target / 'verified.json').is_file(): raise ValueError('Version has not passed its dependency probe')
    return value


def activate(root, recipe, revision, previous):
    folder = root / recipe
    if folder.resolve() != folder: raise ValueError('Invalid recipe root')
    temp = folder / 'active.new.json'
    if temp.is_symlink(): raise ValueError('Invalid runtime pointer')
    temp.write_text(json.dumps({'revision': revision, 'previous': previous, 'at': time.time()})+'\n')
    temp.replace(folder / 'active.json')


def install(root, recipe, run=subprocess.run):
    spec = RECIPES[recipe]
    lock = spec['lock'].read_bytes()
    revision = hashlib.sha256(lock).hexdigest()[:16]
    target = safe_version(root, recipe, revision)
    target.mkdir(parents=True, exist_ok=True)
    previous = active(root, recipe)
    # Never resolve "latest" or execute a command from a skill document.
    clean_env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(root),
        'LANG': 'C.UTF-8', 'UV_CACHE_DIR': '/tmp/crew-uv-cache', 'UV_PYTHON_DOWNLOADS': 'never'}
    if not (target / 'verified.json').exists():
        if not (target / 'venv/bin/python').exists():
            run(['/usr/local/bin/uv', 'venv', '--python', spec['python'], str(target / 'venv')],
                env=clean_env, check=True, timeout=120)
        run(['/usr/local/bin/uv', 'pip', 'install', '--python', str(target / 'venv/bin/python'),
             '-r', str(spec['lock'])], env=clean_env, check=True, timeout=600)
        run([str(target / 'venv/bin/python'), '-c',
             'import av,inspect,yt_dlp,edge_tts,faster_whisper,opencc; '
             'assert av.__version__=="16.1.0"; '
             'from pathlib import Path; assert Path("/opt/crew-media/models/whisper-small/model.bin").is_file()'],
            env=clean_env, check=True, timeout=60)
        (target / 'verified.json').write_text(json.dumps({'revision': revision,
            'company': os.environ.get('PAPERCLIP_COMPANY_ID'), 'kind': 'dependency_probe', 'at': time.time()})+'\n')
    activate(root, recipe, revision, previous['revision'] if previous and previous['revision'] != revision else previous.get('previous') if previous else None)
    return {'installed': True, 'recipe': recipe, **active(root, recipe),
        'verification': 'dependency_probe', 'businessVerified': False,
        'usage': 'rtk proxy crew-runtime exec media process URL --output NEW_DIR --allow-online-tts'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'install', 'rollback', 'exec'])
    parser.add_argument('recipe', nargs='?', choices=list(RECIPES))
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    root = managed_root(os.environ)
    root.mkdir(parents=True, exist_ok=True)
    if args.action == 'inspect':
        print(json.dumps({'company': os.environ['PAPERCLIP_COMPANY_ID'], 'recipes':
            {key: active(root, key) for key in RECIPES},
            'sharedTools': {key: Path(value['script']).is_file() for key, value in RECIPES.items()}}))
        return
    if not args.recipe: parser.error('A recipe is required')
    if args.action == 'exec':
        value = active(root, args.recipe)
        if not value: raise ValueError('Install this recipe first')
        python = safe_version(root, args.recipe, value['revision']) / 'venv/bin/python'
        os.execv(str(python), [str(python), RECIPES[args.recipe]['script'], *args.arguments])
    lock_path = root / '.operation.lock'
    if lock_path.is_symlink(): raise ValueError('Invalid lock')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'install': result = install(root, args.recipe)
        else:
            value = active(root, args.recipe)
            if not value or not value.get('previous'): raise ValueError('No previous installed revision')
            previous = safe_version(root, args.recipe, value['previous'])
            if not (previous / 'verified.json').is_file(): raise ValueError('Previous revision is unavailable')
            activate(root, args.recipe, value['previous'], value['revision'])
            result = {'rolledBack': True, **active(root, args.recipe)}
        print(json.dumps(result))


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f'Crew runtime failed: {error}', file=sys.stderr)
        sys.exit(1)
