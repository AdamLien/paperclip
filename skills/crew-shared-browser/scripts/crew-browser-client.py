#!/usr/bin/env python3
"""Assigned-Agent client for human-shared Chrome. Uses current run credentials."""
import argparse
import json
import os
import time
import urllib.request


def request(path, body=None):
    base = os.environ['PAPERCLIP_API_URL'].rstrip('/')
    if not base.startswith(('https://', 'http://127.0.0.1:', 'http://localhost:')):
        raise RuntimeError('Require HTTPS or local instance')
    if not base.endswith('/api'):
        base += '/api'
    headers = {'Authorization': 'Bearer ' + os.environ['PAPERCLIP_API_KEY'], 'Content-Type': 'application/json'}
    if os.environ.get('PAPERCLIP_RUN_ID'):
        headers['X-Paperclip-Run-Id'] = os.environ['PAPERCLIP_RUN_ID']
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    # Do not forward credentials through redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=10) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['list', 'snapshot', 'navigate', 'click', 'type', 'key', 'scroll'])
    parser.add_argument('--session')
    parser.add_argument('--url')
    parser.add_argument('--text')
    parser.add_argument('--x', type=int)
    parser.add_argument('--y', type=int)
    parser.add_argument('--key')
    parser.add_argument('--delta-y', type=int)
    args = parser.parse_args()
    root = '/companies/' + os.environ['PAPERCLIP_COMPANY_ID'] + '/browser-workspace'
    if args.action == 'list':
        print(json.dumps(request(root), ensure_ascii=False))
        return
    if not args.session:
        parser.error('--session is required')
    import uuid
    uuid.UUID(args.session)
    body = {'action': args.action}
    for name in ['url', 'text', 'x', 'y', 'key', 'delta_y']:
        if getattr(args, name) is not None:
            body['deltaY' if name == 'delta_y' else name] = getattr(args, name)
    path = root + '/' + args.session + '/commands'
    result = request(path, body)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        state = request(path + '/' + result['id'])
        if state['status'] != 'pending':
            print(json.dumps(state, ensure_ascii=False))
            if state['status'] != 'done' or state.get('result', {}).get('error'):
                raise RuntimeError('Browser action failed or expired; inspect state before any retry')
            return
        time.sleep(1)
    raise RuntimeError('Command timed out; do not automatically retry actions')


if __name__ == '__main__':
    main()
