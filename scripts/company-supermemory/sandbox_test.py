import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sandbox', Path(__file__).with_name('codex-sandbox.py'))
sandbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sandbox)


class CompanySandboxTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.company = '0802115b-f3cd-4363-a629-9f857a315f20'
        self.agent = 'agent-one'
        self.home = self.root / 'companies' / self.company / 'codex-home'
        self.home.mkdir(parents=True)
        (self.home / 'config.toml').write_text('[mcp_servers.host]\ncommand="sh"\n')
        self.cwd = self.root / 'workspaces' / self.agent
        self.cwd.mkdir(parents=True)
        self.env = {'PAPERCLIP_COMPANY_ID': self.company, 'PAPERCLIP_AGENT_ID': self.agent,
                    'CODEX_HOME': str(self.home), 'PAPERCLIP_AGENT_JWT_SECRET': 'must-not-inherit'}
        self.policy = {'instanceRoot': str(self.root), 'emptyAuth': '/empty-auth.json',
                       'tenants': {self.company: {'clientConfig': '/client.json', 'containerTag': 'own'}}}

    def test_only_company_paths_and_allowlisted_environment(self):
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, ['exec', 'hello'])
        self.assertIn('--unshare-all', cmd)
        self.assertIn('--disable-userns', cmd)
        self.assertIn('--clearenv', cmd)
        self.assertNotIn('must-not-inherit', cmd)
        self.assertNotIn('--ro-bind / /', ' '.join(cmd))
        self.assertIn('mcp_servers.host.enabled=false', cmd)
        self.assertIn('mcp_servers.supermemory.env_vars=["SUPERMEMORY_CONFIG_PATH"]', cmd)
        self.assertIn('features.apps=false', cmd)

    def test_cross_company_home_denied(self):
        self.env['CODEX_HOME'] = str(self.root / 'companies' / 'other' / 'codex-home')
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])

    def test_governed_mcp_uses_local_transport_without_replacing_credentials(self):
        config = ('[mcp_servers.paperclip-connections]\n'
                  'url="https://crew.metabiz.work/mcp/runtime-tools"\n'
                  'http_headers={Authorization="Bearer company-run-fixture"}\n'
                  '[mcp_servers.paperclip-projects]\n'
                  'url="https://crew.metabiz.work/api/mcp/project-tools"\n')
        (self.home / 'config.toml').write_text(config)
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertIn('mcp_servers.paperclip-connections.url="http://127.0.0.1:3100/mcp/runtime-tools"', cmd)
        self.assertIn('mcp_servers.paperclip-projects.url="http://127.0.0.1:3100/api/mcp/project-tools"', cmd)
        self.assertNotIn('company-run-fixture', cmd)
        self.assertEqual((self.home / 'config.toml').read_text(), config)

    def test_mcp_transport_does_not_add_servers_or_redirect_external_services(self):
        (self.home / 'config.toml').write_text(
            '[mcp_servers.paperclip-connections]\nurl="https://example.com/mcp"\n')
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertFalse(any('mcp_servers.paperclip-connections.url=' in value for value in cmd))
        self.assertFalse(any('mcp_servers.paperclip-projects.url=' in value for value in cmd))

    def test_assigned_gateway_uses_local_transport_with_original_run_credentials(self):
        endpoint = '/mcp/gateways/gw_61b65f90dce54da0a8e65d16511435e8'
        config = ('[mcp_servers.paperclip-assigned]\n'
                  f'url="https://crew.metabiz.work{endpoint}"\n'
                  'http_headers={Authorization="Bearer assigned-run-fixture"}\n')
        (self.home / 'config.toml').write_text(config)
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertIn(f'mcp_servers.paperclip-assigned.url="http://127.0.0.1:3100{endpoint}"', cmd)
        self.assertNotIn('assigned-run-fixture', cmd)
        self.assertEqual((self.home / 'config.toml').read_text(), config)

    def test_assigned_gateway_rejects_unrelated_origins_paths_and_commands(self):
        for url in ['https://example.com/mcp/gateways/gw_abc',
                    'https://crew.metabiz.work/api/admin',
                    'https://crew.metabiz.work/mcp/gateways/gw_abc?scope=other',
                    'https://crew.metabiz.work.evil.test/mcp/gateways/gw_abc']:
            with self.subTest(url=url):
                (self.home / 'config.toml').write_text(
                    f'[mcp_servers.paperclip-assigned]\nurl="{url}"\n')
                cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
                self.assertFalse(any('mcp_servers.paperclip-assigned.url=' in value for value in cmd))

    def test_finance_mcp_and_credentials_only_for_provisioned_agent(self):
        self.env.update({'ODOO_FINANCE_LOGIN': 'finance-fixture', 'ODOO_FINANCE_API_KEY': 'finance-secret'})
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertNotIn('finance-secret', cmd)
        self.assertNotIn('mcp_servers.odoo_finance.enabled=true', cmd)
        self.policy['tenants'][self.company]['odooFinanceAgents'] = [self.agent]
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertIn('finance-secret', cmd)
        self.assertIn('mcp_servers.odoo_finance.enabled=true', cmd)

    def test_global_workspace_and_unprovisioned_tenant_denied(self):
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.root, [])
        self.env['PAPERCLIP_COMPANY_ID'] = 'unprovisioned'
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])

    def test_google_credentials_only_mounted_for_provisioned_agent(self):
        root = self.root / 'agent-secrets' / self.company / self.agent
        store = root / 'gog'
        store.mkdir(parents=True)
        (root / 'keyring-password').write_text('google-test-key')
        self.env.update({'GOG_HOME': '/host/google', 'GOG_KEYRING_PASSWORD': 'host-key'})
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertNotIn(str(store), cmd)
        self.assertNotIn('host-key', cmd)
        self.policy['tenants'][self.company]['gogAgents'] = [self.agent]
        cmd = sandbox.build_command(self.policy, self.env, self.cwd, [])
        self.assertIn(str(store), cmd)
        self.assertIn('/run/crew-gog', cmd)
        self.assertIn('google-test-key', cmd)
        self.assertNotIn(str(root / 'keyring-password'), cmd)
        self.env['PAPERCLIP_AGENT_ID'] = 'other-agent'
        other = self.root / 'workspaces' / 'other-agent'
        other.mkdir()
        cmd = sandbox.build_command(self.policy, self.env, other, [])
        self.assertNotIn(str(store), cmd)
        self.assertNotIn('google-test-key', cmd)

    def test_google_store_fails_closed_when_missing_or_symlinked(self):
        self.policy['tenants'][self.company]['gogAgents'] = [self.agent]
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])
        root = self.root / 'agent-secrets' / self.company / self.agent
        root.mkdir(parents=True)
        (root / 'gog').symlink_to(self.home, target_is_directory=True)
        (root / 'keyring-password').write_text('test-key')
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])

    @unittest.skipUnless(Path('/usr/bin/bwrap').exists(), 'Linux bubblewrap integration')
    def test_librarian_writes_compiled_pages_only_and_tenant_isolation(self):
        wiki = self.root / 'wiki'
        compiled = wiki / '07 Ops'
        evidence = compiled / '_assets'
        control = wiki / '99 Meta'
        evidence.mkdir(parents=True)
        control.mkdir()
        files = [compiled / 'page.md', evidence / 'source.md', control / 'rules.md']
        for file in files:
            file.write_text('original')
        tenant = self.policy['tenants'][self.company]
        tenant['readOnlyWiki'] = [str(wiki)]
        tenant['wikiWriterAgents'] = [self.agent]
        for key in ['emptyAuth', 'clientConfig']:
            file = self.root / key
            file.write_text('{}')
            (self.policy if key == 'emptyAuth' else tenant)[key] = str(file)
        other_company = 'other-company'
        self.policy['tenants'][other_company] = dict(tenant, readOnlyWiki=[], wikiWriterAgents=[])
        other_home = self.root / 'companies' / other_company / 'codex-home'
        other_home.mkdir(parents=True)
        probe = ('import json,pathlib\nresults=[]\n'
                 f'for name in {list(map(str, files))!r}:\n'
                 ' try: pathlib.Path(name).write_text("updated"); results.append(True)\n'
                 ' except OSError: results.append(False)\n'
                 'print(json.dumps(results))')
        for company, agent, home, expected in [
                (self.company, self.agent, self.home, [True, False, False]),
                (self.company, 'reader', self.home, [False, False, False]),
                (other_company, 'customer', other_home, [False, False, False])]:
            cwd = self.root / 'workspaces' / agent
            cwd.mkdir(exist_ok=True)
            env = dict(self.env, PAPERCLIP_COMPANY_ID=company,
                       PAPERCLIP_AGENT_ID=agent, CODEX_HOME=str(home))
            cmd = sandbox.build_command(self.policy, env, cwd, [])
            cmd = cmd[:cmd.index('/usr/local/bin/codex')]
            result = subprocess.run(cmd + ['/usr/bin/python3', '-c', probe],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), expected)
        self.assertEqual(files[1].read_text(), 'original')
        self.assertEqual(files[2].read_text(), 'original')

    def test_librarian_rejects_symlinked_writable_folders(self):
        wiki = self.root / 'wiki'
        wiki.mkdir()
        (wiki / 'Company').symlink_to(self.home, target_is_directory=True)
        tenant = self.policy['tenants'][self.company]
        tenant.update(readOnlyWiki=[str(wiki)], wikiWriterAgents=[self.agent])
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])

    @unittest.skipUnless(Path('/usr/bin/bwrap').exists(), 'Linux bubblewrap integration')
    def test_google_store_isolation_in_real_sandbox(self):
        root = self.root / 'agent-secrets' / self.company / self.agent
        store = root / 'gog'
        store.mkdir(parents=True)
        (store / 'fixture').write_text('private fixture')
        (root / 'keyring-password').write_text('integration-key')
        for key in ['emptyAuth', 'clientConfig']:
            file = self.root / key
            file.write_text('{}')
            if key == 'emptyAuth':
                self.policy[key] = str(file)
            else:
                self.policy['tenants'][self.company][key] = str(file)
        self.policy['tenants'][self.company]['gogAgents'] = [self.agent]
        probe = ('import json,os,pathlib;print(json.dumps(['
                 'pathlib.Path("/run/crew-gog/fixture").is_file(),'
                 'bool(os.getenv("GOG_KEYRING_PASSWORD")),'
                 'pathlib.Path("/etc/resolv.conf").is_file()]))')
        for agent, expected in [(self.agent, [True, True, True]), ('other-agent', [False, False, True])]:
            cwd = self.root / 'workspaces' / agent
            cwd.mkdir(exist_ok=True)
            env = dict(self.env, PAPERCLIP_AGENT_ID=agent)
            cmd = sandbox.build_command(self.policy, env, cwd, [])
            cmd = cmd[:cmd.index('/usr/local/bin/codex')]
            result = subprocess.run(cmd + ['/usr/bin/python3', '-c', probe],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), expected)


if __name__ == '__main__':
    unittest.main()
