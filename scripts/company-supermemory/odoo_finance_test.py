import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).with_name('odoo-finance-mcp.py')
spec = importlib.util.spec_from_file_location('finance', SCRIPT)
finance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finance)


class FakeOdoo:
    def __init__(self):
        self.calls = []
        self.companies = [1]
        self.writable = False
        self.unreadable = set()
        self.records = [{'id': 1, 'company_id': [1, 'metabiz']}]

    def authenticate(self, *args):
        return 42

    def execute_kw(self, database, uid, key, model, method, args, kwargs):
        self.calls.append((model, method, args, kwargs))
        if model == 'res.users':
            return [{'company_ids': self.companies, 'company_id': [1, 'metabiz']}]
        if method == 'check_access_rights':
            return model not in self.unreadable if args == ['read'] else self.writable
        if method == 'search_count':
            return 101
        if method == 'search_read':
            return self.records
        raise AssertionError('Unexpected RPC')


class FinanceTest(unittest.TestCase):
    def setUp(self):
        self.odoo = FakeOdoo()
        self.client = finance.Finance({'ODOO_FINANCE_LOGIN': 'fixture', 'ODOO_FINANCE_API_KEY': 'secret'},
                                      proxy=lambda *args, **kw: self.odoo)
        self.args = {'model': 'account.move', 'start_date': '2026-10-01', 'end_date': '2026-10-20'}

    def test_pagination_and_company_domain_cannot_be_overridden(self):
        result = self.client.call('finance_read', {**self.args, 'offset': 100, 'limit': 1})
        self.assertEqual(result['total'], 101)
        for model, method, args, kwargs in self.odoo.calls:
            self.assertEqual(kwargs['context']['allowed_company_ids'], [1])
            if method in ('search_read', 'search_count'):
                self.assertEqual(args[0][0], ['company_id', '=', 1])
        self.assertEqual(self.odoo.calls[-1][3]['offset'], 100)

    def test_invalid_tools_models_and_override_arguments_never_call_odoo(self):
        cases = [('write', {}), ('finance_read', {**self.args, 'model': 'res.users'}),
                 ('finance_read', {**self.args, 'domain': ['|', ['company_id', '=', 2]]}),
                 ('finance_read', {**self.args, 'context': {'allowed_company_ids': [2]}}),
                 ('finance_read', {**self.args, 'limit': 101}),
                 ('finance_read', {**self.args, 'offset': True}),
                 ('finance_read', {**self.args, 'start_date': 'invalid'})]
        for name, args in cases:
            with self.subTest(name=name, args=args), self.assertRaises(finance.FinanceError):
                self.client.call(name, args)
        self.assertEqual(self.odoo.calls, [])

    def test_missing_key_and_broad_accounts_fail_closed(self):
        with self.assertRaises(finance.FinanceError):
            finance.Finance({}).call('finance_health', {})
        self.odoo.companies = [1, 2]
        with self.assertRaises(finance.FinanceError):
            self.client.call('finance_read', self.args)
        self.odoo.companies = [1]
        self.odoo.writable = True
        with self.assertRaises(finance.FinanceError):
            self.client.call('finance_read', self.args)
        self.assertFalse(any(c[1] == 'search_read' for c in self.odoo.calls))

    def test_model_coverage_and_cross_company_results(self):
        self.odoo.unreadable.add('account.payment')
        self.assertEqual(self.client.call('finance_health', {})['unavailable_models'], ['account.payment'])
        self.odoo.records = [{'id': 2, 'company_id': [2, 'other']}]
        with self.assertRaises(finance.FinanceError):
            self.client.call('finance_read', self.args)
        self.odoo.unreadable.add('account.move.line')
        with self.assertRaises(finance.FinanceError):
            self.client.call('finance_health', {})

    def test_direct_mutation_methods_refused_before_rpc(self):
        for model, method in [('account.move', 'write'), ('account.move', 'action_post'),
                              ('account.move.line', 'reconcile'), ('sale.order', 'search_read')]:
            with self.assertRaises(finance.FinanceError):
                self.client.rpc(model, method, [])
        self.assertEqual(self.odoo.calls, [])

    def test_faults_do_not_leak_credentials(self):
        def broken(*args, **kwargs):
            raise RuntimeError('secret financial records')
        self.client.proxy = broken
        result = finance.dispatch({'method': 'tools/call', 'params': {'name': 'finance_health'}}, self.client)
        self.assertTrue(result['isError'])
        self.assertNotIn('secret', json.dumps(result))

    def test_stdio_mcp_protocol_without_credentials(self):
        requests = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'},
                    {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'finance_health'}}]
        env = {k: v for k, v in os.environ.items() if not k.startswith('ODOO_FINANCE_')}
        result = subprocess.run([sys.executable, str(SCRIPT)], input=''.join(json.dumps(r)+'\n' for r in requests),
                                text=True, capture_output=True, check=True, env=env, timeout=5)
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [1, 2, 3])
        self.assertEqual([t['name'] for t in replies[1]['result']['tools']], ['finance_health', 'finance_read'])
        self.assertTrue(replies[2]['result']['isError'])
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
