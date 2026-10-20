"""Read-only live proof, executed inside exactly the same agent sandbox."""
import json
import os
from pathlib import Path
import urllib.request
import urllib.error

c = json.loads(Path('/run/crew-memory/client.json').read_text())
own = os.environ['CREW_MEMORY_CONTAINER']
other = 'crew_company_13f3f257-5f52-4fe3-a674-cc728f71ff5d' if own.endswith('0802115b-f3cd-4363-a629-9f857a315f20') else 'crew_company_0802115b-f3cd-4363-a629-9f857a315f20'

def request(base, tag):
    req = urllib.request.Request(base + '/v4/profile',
        data=json.dumps({'containerTag': tag, 'q': 'connection verification'}).encode(),
        headers={'Authorization': 'Bearer ' + c['apiKey'], 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=35) as r:
            data = json.load(r)
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        return 'network-blocked'

def readable(p):
    try:
        with open(p, 'rb') as f:
            f.read(1)
        return True
    except OSError:
        return False

result = {
    'companyId': os.environ['PAPERCLIP_COMPANY_ID'],
    'agentId': os.environ['PAPERCLIP_AGENT_ID'],
    'ownMemoryHTTP': request(c['baseUrl'], own),
    'otherCompanyMemoryHTTP': request(c['baseUrl'], other),
    'administratorFrontWithCompanyKeyHTTP': request('http://127.0.0.1:6767', other),
    'directStorageWithCompanyKeyHTTP': request('http://127.0.0.1:6770', own),
    'hostAdminMemoryKeyReadable': readable('/home/metabiz-admin/.codex/supermemory.json'),
    'gatewayAdminConfigReadable': readable('/etc/crew-company-memory/server.json'),
    'hostProcVisible': Path('/proc/1/root/home/metabiz-admin/.codex/supermemory.json').exists(),
    'otherCompanyHomeVisible': Path(str(Path(os.environ['CODEX_HOME']).parents[1] / other.removeprefix('crew_company_'))).exists(),
    'metabizWikiVisible': Path('/mnt/obsidian/metabiz/INDEX/index.md').exists(),
}
print(json.dumps(result))
assert result['ownMemoryHTTP'] == 200
assert result['otherCompanyMemoryHTTP'] == 403
assert result['administratorFrontWithCompanyKeyHTTP'] == 403
assert result['directStorageWithCompanyKeyHTTP'] == 'network-blocked'
assert not any(result[k] for k in ['hostAdminMemoryKeyReadable', 'gatewayAdminConfigReadable', 'hostProcVisible', 'otherCompanyHomeVisible'])
