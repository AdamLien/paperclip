#!/usr/bin/python3
"""Operator-run browser integration check against provisioned company sandboxes."""
import argparse
import concurrent.futures
import tempfile
import http.server
import importlib.util
import json
import select
import subprocess
import threading
import time
from pathlib import Path

class Fixture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'''<!doctype html><title>mCrew Browser Check</title>
<h1>mCrew Browser Check</h1><label>Name <input aria-label="Name"></label>
<button onclick="document.querySelector('output').textContent='Verified '+document.querySelector('input').value">Verify</button>
<output>Ready</output><a href="data:text/plain,mcrew-browser-download-ok" download="browser-check.txt">Download</a>'''
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass

class Client:
    def __init__(self, command):
        self.err = tempfile.TemporaryFile(mode='w+')
        self.p = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=self.err, text=True, bufsize=1)
        self.id = 0
        self.call('initialize', {'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'crew-check','version':'1'}})
        self.p.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n'); self.p.stdin.flush()
    def call(self, method, params):
        self.id += 1
        self.p.stdin.write(json.dumps({'jsonrpc':'2.0','id':self.id,'method':method,'params':params})+'\n'); self.p.stdin.flush()
        deadline = time.monotonic()+90
        while time.monotonic()<deadline:
            if select.select([self.p.stdout],[],[],1)[0]:
                line = self.p.stdout.readline()
                if not line: raise RuntimeError('Browser MCP exited before responding')
                obj = json.loads(line)
                if obj.get('id') == self.id:
                    if 'error' in obj: raise RuntimeError(str(obj['error']))
                    result = obj['result']
                    if result.get('isError'): raise RuntimeError(str(result)[:1800])
                    return result
        raise TimeoutError(method)
    def tool(self, name, args): return self.call('tools/call', {'name':name,'arguments':args})
    def close(self):
        try: self.tool('browser_close', {})
        finally:
            self.p.stdin.close()
            try: self.p.wait(timeout=10)
            except subprocess.TimeoutExpired: self.p.terminate(); self.p.wait(timeout=10)
            self.err.close()

def text(result): return '\n'.join(x.get('text','') for x in result.get('content',[]) if x['type']=='text')

def probe(item, items, policy, module, url):
    company, agent = item
    root = Path(policy['instanceRoot'])
    assert policy['tenants'][company].get('browserEnabled') is True
    workspace = root/'workspaces'/agent
    env = {'PAPERCLIP_COMPANY_ID':company, 'PAPERCLIP_AGENT_ID':agent}
    cmd = module.build_command(policy,env,workspace,[])
    browser = json.loads(next(x.split('=',1)[1] for x in cmd if x.startswith('mcp_servers.crew_browser.args=')))
    prefix = cmd[:cmd.index('/usr/local/bin/codex')]
    hidden = [root/'workspaces'/a for c,a in items if c!=company or a!=agent]
    check = 'import json,pathlib;print(json.dumps([pathlib.Path(p).exists() for p in '+repr(list(map(str,hidden)))+']))'
    visibility = subprocess.check_output(prefix+['python3','-c',check],text=True,timeout=15)
    assert not any(json.loads(visibility)), visibility
    client = Client(prefix+['node']+browser)
    try:
        tools = client.call('tools/list',{})['tools']
        nav = text(client.tool('browser_navigate',{'url':url}))
        assert 'mCrew Browser Check' in nav, nav
        client.tool('browser_fill_form',{'fields':[{'target':'input','name':'Name','type':'textbox','value':agent}]})
        client.tool('browser_click',{'target':'button','element':'Verify'})
        result = text(client.tool('browser_evaluate',{'function':"() => {localStorage.setItem('crew-marker', '"+agent+"'); document.cookie='crew_marker="+agent+"; path=/'; return {message:document.querySelector('output').textContent,marker:localStorage.getItem('crew-marker')};}"}))
        assert 'Verified '+agent in result, result
        client.tool('browser_take_screenshot',{'type':'png','scale':'css','filename':str(workspace/'browser-check.png')})
        assert (workspace/'browser-check.png').stat().st_size>1000
        # A second simultaneous client must start with no cookies/localStorage.
        second = Client(prefix+['node']+browser)
        try:
            second.tool('browser_navigate',{'url':url})
            state = text(second.tool('browser_evaluate',{'function':"() => ({marker:localStorage.getItem('crew-marker'),cookies:document.cookie})"}))
            assert '"marker": null' in state and '"cookies": ""' in state, state
        finally: second.close()
        return {'company':company,'agent':agent,'tools':len(tools),'navigate':True,'fill_click':True,'screenshot':True,'concurrent_session_isolation':True,'other_workspaces_hidden':True}
    finally: client.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runner', default='/usr/local/lib/crew-company-memory/codex-sandbox.py')
    parser.add_argument('--output')
    args = parser.parse_args()
    policy = json.loads(Path('/etc/crew-company-memory/runtime.json').read_text())
    spec = importlib.util.spec_from_file_location('sb', args.runner)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    root = Path(policy['instanceRoot'])
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    items = [(c,p.name) for c,t in policy['tenants'].items() if t.get('browserEnabled') is True
             for p in (root/'companies'/c/'agents').iterdir()
             if p.is_dir() and (root/'workspaces'/p.name).is_dir()]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda item: probe(item,items,policy,module,url),items))
        output = json.dumps(results,indent=2)+'\n'
        if args.output: Path(args.output).write_text(output)
        print(output)
    finally: server.shutdown()

if __name__ == '__main__': main()
