#!/usr/bin/python3
"""Fail-closed company filesystem boundary around the existing OCX Codex CLI."""
import json
import os
import re
from pathlib import Path
import sys
import tomllib


def beneath(path, root):
    return path == root or root in path.parents


def build_command(policy, env, cwd, args):
    company = env.get('PAPERCLIP_COMPANY_ID')
    tenant = policy['tenants'].get(company)
    if not tenant:
        raise ValueError('Company has no provisioned memory sandbox')
    instance = Path(policy['instanceRoot']).resolve()
    company_root = instance / 'companies' / company
    home = Path(env.get('CODEX_HOME', str(company_root / 'codex-home'))).resolve()
    if not beneath(home, company_root) or home == company_root:
        raise ValueError('Codex home must be inside its own company')
    agent = env.get('PAPERCLIP_AGENT_ID', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', agent):
        raise ValueError('Invalid managed agent identity')
    workspace = instance / 'workspaces' / agent
    cwd = Path(cwd).resolve()
    project = None
    projects = instance / 'projects' / company
    if not beneath(cwd, workspace):
        if agent in tenant.get('projectWorkspaceAgents', []) and beneath(cwd, projects):
            parts = cwd.relative_to(projects).parts
            if len(parts) >= 2 and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', parts[0]):
                candidate = projects / parts[0]
                if candidate.resolve() == candidate:
                    project = candidate
        if project is None:
            raise ValueError('Only the current agent or an approved company project workspace is allowed')
    if not home.is_dir() or not workspace.is_dir() or not cwd.is_dir():
        raise ValueError('Managed home/workspace missing')
    config = tomllib.loads((home / 'config.toml').read_text()) if (home / 'config.toml').exists() else {}
    # Start from an empty mount tree: never expose the host root or /home.
    cmd = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--share-net', '--disable-userns',
           '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv']
    for root in ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt']:
        if Path(root).exists():
            cmd += ['--ro-bind', root, root]
    cmd += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home',
            '--dir', '/run', '--dir', '/run/crew-memory', '--dir', '/var', '--dir', '/mnt']
    # /etc/resolv.conf may point into /run, which is otherwise an empty tree.
    resolver = Path('/etc/resolv.conf').resolve()
    if beneath(resolver, Path('/run')) and resolver.is_file():
        cmd += ['--ro-bind', str(resolver), str(resolver)]
    cmd += ['--bind', str(home), str(home), '--bind', str(workspace), str(workspace)]
    if project is not None:
        # Mount this one company-owned project, never the shared project root.
        cmd += ['--bind', str(project), str(project)]
    # OCX seeds its public model catalog as an absolute host path. Expose only
    # that file, never the surrounding host Codex home or credentials.
    catalog = config.get('model_catalog_json')
    if catalog:
        if catalog != '/home/metabiz-admin/.codex/opencodex-catalog.json':
            raise ValueError('Unapproved model catalog path')
        cmd += ['--ro-bind', catalog, catalog]
    instructions = company_root / 'agents' / agent / 'instructions'
    if instructions.is_dir():
        cmd += ['--ro-bind', str(instructions), str(instructions)]
    skills = instance / 'skills' / company
    if skills.is_dir():
        cmd += ['--ro-bind', str(skills), str(skills)]
    # Core Paperclip skills are public code, never instance data or credentials.
    for item in (home / 'skills').glob('*'):
        target = item.resolve()
        if item.is_symlink() and ('/server/skills/' in str(target) or '/onboarding-assets/' in str(target)):
            cmd += ['--ro-bind', str(target), str(target)]
    for wiki in tenant.get('readOnlyWiki', []):
        if Path(wiki).is_dir():
            cmd += ['--ro-bind', wiki, wiki]
    # Only named librarians can update compiled company knowledge. Keep the
    # vault root, control files and raw evidence read-only for everyone.
    if agent in tenant.get('wikiWriterAgents', []):
        for wiki in tenant.get('readOnlyWiki', []):
            root = Path(wiki)
            if root.resolve() != root or not root.is_dir():
                raise ValueError('Wiki writer root must be a real mounted directory')
            for name in ['00 Inbox', 'Company', '01 Clients', '02 Projects', '03 Tasks',
                         '04 Quotes', '05 Proposals', '06 Knowledge', '07 Ops',
                         '08 Templates', '09 Infra', 'INDEX']:
                folder = root / name
                if not folder.exists():
                    continue
                if folder.resolve() != folder or not folder.is_dir():
                    raise ValueError('Wiki writer folders must not be symlinks')
                cmd += ['--bind', str(folder), str(folder)]
                evidence = folder / '_assets'
                if evidence.exists():
                    if evidence.resolve() != evidence or not evidence.is_dir():
                        raise ValueError('Wiki evidence must not be a symlink')
                    cmd += ['--ro-bind', str(evidence), str(evidence)]
    client = tenant['clientConfig']
    cmd += ['--ro-bind', client, '/run/crew-memory/client.json']
    # Shared login symlinks must not expose the host's subscription identity.
    # OCX authenticates through the existing, resolved OCX_API_KEY environment.
    cmd += ['--ro-bind', policy['emptyAuth'], str((home / 'auth.json').resolve())]
    safe_env = {
        'HOME': '/home/crew', 'CODEX_HOME': str(home), 'PATH': '/usr/local/bin:/usr/bin:/bin',
        'LANG': 'C.UTF-8', 'TERM': 'dumb', 'TMPDIR': '/tmp',
        'PAPERCLIP_API_URL': 'http://127.0.0.1:3100',
        'SUPERMEMORY_CONFIG_PATH': '/run/crew-memory/client.json',
        'CREW_MEMORY_CONTAINER': tenant['containerTag'],
    }
    # Personal Google tokens live outside the shared company Codex home.
    # Only an explicitly provisioned agent receives this mount and key.
    if agent in tenant.get('gogAgents', []):
        gog_root = instance / 'agent-secrets' / company / agent
        gog_home = gog_root / 'gog'
        gog_key = gog_root / 'keyring-password'
        if (gog_root.resolve() != gog_root or gog_home.resolve() != gog_home
                or gog_key.resolve() != gog_key):
            raise ValueError('Google credential paths must not be symlinks')
        if not gog_home.is_dir() or not gog_key.is_file():
            raise ValueError('Agent Google credential store is not provisioned')
        password = gog_key.read_text().strip()
        if not password:
            raise ValueError('Agent Google keyring password is empty')
        cmd += ['--bind', str(gog_home), '/run/crew-gog']
        safe_env.update({'GOG_HOME': '/run/crew-gog',
                         'GOG_KEYRING_BACKEND': 'file',
                         'GOG_KEYRING_PASSWORD': password})
    allowed = ['OCX_API_KEY', 'PAPERCLIP_API_KEY', 'PAPERCLIP_AGENT_ID', 'PAPERCLIP_COMPANY_ID',
               'PAPERCLIP_RUN_ID', 'PAPERCLIP_TASK_ID', 'PAPERCLIP_WAKE_REASON',
               'PAPERCLIP_WAKE_COMMENT_ID', 'PAPERCLIP_WAKEUP_REQUEST_ID',
               'PAPERCLIP_APPROVAL_ID', 'PAPERCLIP_APPROVAL_STATUS', 'PAPERCLIP_LINKED_ISSUE_IDS']
    finance_enabled = agent in tenant.get('odooFinanceAgents', [])
    if finance_enabled:
        allowed += ['ODOO_FINANCE_LOGIN', 'ODOO_FINANCE_API_KEY']
    safe_env.update({k: env[k] for k in allowed if k in env})
    for key, value in safe_env.items():
        cmd += ['--setenv', key, value]
    cmd += ['--dir', '/home/crew', '--chdir', str(cwd)]
    if args == ['--company-memory-probe']:
        return cmd + ['/usr/bin/python3', '/usr/local/lib/crew-company-memory/probe.py']
    overrides = []
    for name, entry in config.get('mcp_servers', {}).items():
        if name != 'supermemory' and 'command' in entry:
            if not re.fullmatch(r'[A-Za-z0-9_-]+', name):
                raise ValueError('Unsupported host MCP server name')
            overrides += ['-c', f'mcp_servers.{name}.enabled=false']
    # Keep managed company/run credentials; only avoid the public edge for
    # these existing gateways hosted by the same Crew backend.
    for name, endpoint in {
        'paperclip-connections': '/mcp/runtime-tools',
        'paperclip-projects': '/api/mcp/project-tools',
        'paperclip-management': '/api/mcp/crew-management',
    }.items():
        entry = config.get('mcp_servers', {}).get(name, {})
        if 'command' not in entry and entry.get('url') == f'https://crew.metabiz.work{endpoint}':
            overrides += ['-c', f'mcp_servers.{name}.url="http://127.0.0.1:3100{endpoint}"']
    assigned = config.get('mcp_servers', {}).get('paperclip-assigned', {})
    assigned_url = assigned.get('url', '')
    if 'command' not in assigned and isinstance(assigned_url, str):
        match = re.fullmatch(r'https://crew\.metabiz\.work(/mcp/gateways/gw_[a-f0-9]+)', assigned_url)
        if match:
            overrides += ['-c', f'mcp_servers.paperclip-assigned.url="http://127.0.0.1:3100{match[1]}"']
    overrides += [
        # Bind management to this actual run token; never persist credentials
        # in the company-shared Codex config or borrow another agent's header.
        '-c', 'mcp_servers.paperclip-management.url="http://127.0.0.1:3100/api/mcp/crew-management"',
        '-c', 'mcp_servers.paperclip-management.bearer_token_env_var="PAPERCLIP_API_KEY"',
        '-c', 'mcp_servers.paperclip-management.enabled=true',
        # The outer bwrap already confines files/processes and denies nested
        # user namespaces. Avoid a second Codex sandbox that cannot start.
        '-c', 'sandbox_mode="danger-full-access"',
        '-c', 'approval_policy="never"',
        # OCX uses company-governed MCP connections, not subscription Apps.
        '-c', 'features.apps=false',
        '-c', 'mcp_servers.supermemory.command="node"',
        '-c', 'mcp_servers.supermemory.args=["/usr/local/lib/crew-company-memory/mcp.cjs"]',
        '-c', 'mcp_servers.supermemory.env_vars=["SUPERMEMORY_CONFIG_PATH"]',
        '-c', 'model_provider="ocx"',
        '-c', 'model_providers.ocx.name="OpenCodex"',
        '-c', 'model_providers.ocx.base_url="http://127.0.0.1:10100/v1"',
        '-c', 'model_providers.ocx.env_key="OCX_API_KEY"',
        '-c', 'model_providers.ocx.env_http_headers={"x-opencodex-api-key"="OCX_API_KEY"}',
        '-c', 'model_providers.ocx.wire_api="responses"',
    ]
    if finance_enabled:
        overrides += [
            '-c', 'mcp_servers.odoo_finance.enabled=true',
            '-c', 'mcp_servers.odoo_finance.command="python3"',
            '-c', 'mcp_servers.odoo_finance.args=["/usr/local/lib/crew-company-memory/odoo-finance-mcp.py"]',
            '-c', 'mcp_servers.odoo_finance.env_vars=["ODOO_FINANCE_LOGIN","ODOO_FINANCE_API_KEY"]',
        ]
    if tenant.get('browserEnabled') is True:
        # Each stdio client gets its own in-memory Chrome context. No host CDP
        # port, shared profile, or extra filesystem mount crosses the boundary.
        # Nested Chromium namespaces are unavailable inside this bwrap; the
        # existing outer company sandbox remains the confinement boundary.
        browser_args = [
            '/opt/crew-browser/node_modules/@playwright/mcp/cli.js',
            '--browser', 'chrome', '--executable-path', '/usr/bin/google-chrome',
            '--headless', '--isolated', '--no-sandbox', '--no-webmcp',
            '--output-dir', str(workspace / 'browser-artifacts'),
        ]
        overrides += [
            '-c', 'mcp_servers.crew_browser.enabled=true',
            '-c', 'mcp_servers.crew_browser.command="node"',
            '-c', 'mcp_servers.crew_browser.args=' + json.dumps(browser_args),
            '-c', 'mcp_servers.crew_browser.startup_timeout_sec=30',
            '-c', 'mcp_servers.crew_browser.tool_timeout_sec=90',
        ]
    return cmd + ['/usr/local/bin/codex'] + args + overrides


if __name__ == '__main__':
    try:
        # Version/help probes do not run agent code or expose data.
        if sys.argv[1:] in (['--version'], ['--help']):
            os.execv('/usr/local/bin/codex', ['/usr/local/bin/codex'] + sys.argv[1:])
        policy = json.loads(Path('/etc/crew-company-memory/runtime.json').read_text())
        command = build_command(policy, os.environ, os.getcwd(), sys.argv[1:])
        os.execv(command[0], command)
    except (ValueError, OSError) as error:
        print(f'Crew company sandbox refused launch: {error}', file=sys.stderr)
        sys.exit(78)
