import importlib.util
import os
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
