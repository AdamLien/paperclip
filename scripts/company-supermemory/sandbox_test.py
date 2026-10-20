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
        self.assertIn('mcp_servers."host".enabled=false', cmd)
        self.assertIn('mcp_servers.supermemory.env_vars=["SUPERMEMORY_CONFIG_PATH"]', cmd)

    def test_cross_company_home_denied(self):
        self.env['CODEX_HOME'] = str(self.root / 'companies' / 'other' / 'codex-home')
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])

    def test_global_workspace_and_unprovisioned_tenant_denied(self):
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.root, [])
        self.env['PAPERCLIP_COMPANY_ID'] = 'unprovisioned'
        with self.assertRaises(ValueError):
            sandbox.build_command(self.policy, self.env, self.cwd, [])


if __name__ == '__main__':
    unittest.main()
