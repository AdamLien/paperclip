#!/usr/bin/python3
"""Read-only, single-company Odoo finance MCP over stdio; no browser session."""
import datetime
import json
import os
import socket
import sys
import xmlrpc.client

URL = 'https://erp.metabiz.work'
DATABASE = 'odoo16'
COMPANY = 1
MODELS = {
    'account.move': ('date', ['id', 'name', 'date', 'invoice_date', 'invoice_date_due',
                            'move_type', 'state', 'partner_id', 'currency_id',
                            'amount_total', 'amount_residual', 'payment_state', 'company_id']),
    'account.move.line': ('date', ['id', 'move_id', 'date', 'date_maturity', 'account_id',
                                 'partner_id', 'debit', 'credit', 'balance',
                                 'amount_residual', 'currency_id', 'reconciled', 'company_id']),
    'account.payment': ('date', ['id', 'name', 'date', 'state', 'payment_type',
                               'partner_type', 'partner_id', 'amount', 'currency_id', 'company_id']),
    'account.bank.statement.line': ('date', ['id', 'date', 'payment_ref', 'amount',
                                           'journal_id', 'partner_id', 'company_id']),
}
TOOLS = [
    {'name': 'finance_health', 'description': 'Verify dedicated read-only account and company scope. No accounting writes.',
     'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
    {'name': 'finance_read', 'description': 'Read a bounded page of company 1 accounting records by accounting date. Paginate until total is covered; unavailable models mean incomplete coverage.',
     'inputSchema': {'type': 'object', 'properties': {
         'model': {'type': 'string', 'enum': list(MODELS)},
         'start_date': {'type': 'string', 'format': 'date'},
         'end_date': {'type': 'string', 'format': 'date'},
         'offset': {'type': 'integer', 'minimum': 0},
         'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100}},
         'required': ['model', 'start_date', 'end_date'], 'additionalProperties': False}},
]


class FinanceError(Exception):
    pass


class Finance:
    def __init__(self, env=None, proxy=xmlrpc.client.ServerProxy):
        env = os.environ if env is None else env
        self.login = env.get('ODOO_FINANCE_LOGIN', '')
        self.key = env.get('ODOO_FINANCE_API_KEY', '')
        self.proxy = proxy
        self.context = {'allowed_company_ids': [COMPANY], 'force_company': COMPANY,
                        'active_test': False, 'lang': 'zh_TW'}

    def rpc(self, model, method, args, kwargs=None):
        # There is deliberately no arbitrary model/method RPC tool.
        allowed = {'read'} if model == 'res.users' else {'check_access_rights', 'search_read', 'search_count'}
        if model not in MODELS and model != 'res.users' or method not in allowed:
            raise FinanceError('Model or method is not permitted')
        return self.object.execute_kw(DATABASE, self.uid, self.key, model, method, args,
                                      {**(kwargs or {}), 'context': self.context})

    def verify(self):
        if not self.login or not self.key:
            raise FinanceError('blocked_connection: dedicated read-only Odoo login/API key not configured')
        common = self.proxy(URL + '/xmlrpc/2/common', allow_none=True)
        self.uid = common.authenticate(DATABASE, self.login, self.key, {})
        if not self.uid:
            raise FinanceError('blocked_connection: Odoo authentication failed')
        self.object = self.proxy(URL + '/xmlrpc/2/object', allow_none=True)
        users = self.rpc('res.users', 'read', [[self.uid]], {'fields': ['company_ids', 'company_id']})
        if len(users) != 1 or users[0]['company_ids'] != [COMPANY] or users[0]['company_id'][0] != COMPANY:
            raise FinanceError('blocked_connection: account must belong exclusively to company 1')
        readable = []
        for model in MODELS:
            # ACL checks do not attempt writes; broad accounts fail closed.
            for operation in ('create', 'write', 'unlink'):
                if self.rpc(model, 'check_access_rights', [operation], {'raise_exception': False}):
                    raise FinanceError('blocked_connection: account has financial write permissions')
            if self.rpc(model, 'check_access_rights', ['read'], {'raise_exception': False}):
                readable.append(model)
        if not {'account.move', 'account.move.line'}.issubset(readable):
            raise FinanceError('blocked_connection: required accounting read access missing')
        return readable

    def call(self, name, arguments):
        if name not in ('finance_health', 'finance_read'):
            raise FinanceError('Unknown tool; financial mutations are not supported')
        if not isinstance(arguments, dict):
            raise FinanceError('Arguments must be an object')
        allowed = set() if name == 'finance_health' else {'model', 'start_date', 'end_date', 'offset', 'limit'}
        if set(arguments) - allowed:
            raise FinanceError('Unsupported arguments')
        if name == 'finance_read':
            model = arguments.get('model')
            if model not in MODELS:
                raise FinanceError('Unsupported accounting model')
            try:
                start = datetime.date.fromisoformat(arguments['start_date'])
                end = datetime.date.fromisoformat(arguments['end_date'])
            except (KeyError, ValueError, TypeError):
                raise FinanceError('Both dates must be valid ISO calendar dates') from None
            offset, limit = arguments.get('offset', 0), arguments.get('limit', 100)
            if start > end or type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
                raise FinanceError('Invalid date range or pagination')
        readable = self.verify()
        if name == 'finance_health':
            return {'authenticated': True, 'company_id': COMPANY, 'read_only': True,
                    'readable_models': readable,
                    'unavailable_models': [m for m in MODELS if m not in readable]}
        if model not in readable:
            raise FinanceError('Accounting model unavailable; coverage is incomplete')
        date_field, fields = MODELS[model]
        domain = [['company_id', '=', COMPANY], [date_field, '>=', start.isoformat()],
                  [date_field, '<=', end.isoformat()]]
        total = self.rpc(model, 'search_count', [domain])
        records = self.rpc(model, 'search_read', [domain], {'fields': fields, 'offset': offset,
                           'limit': limit, 'order': 'id asc'})
        if any(record.get('company_id', [None])[0] != COMPANY for record in records):
            raise FinanceError('Cross-company result rejected')
        return {'company_id': COMPANY, 'model': model, 'total': total, 'offset': offset,
                'records': records, 'fetched_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}


def dispatch(request, finance):
    method = request.get('method')
    if method == 'initialize':
        return {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                'serverInfo': {'name': 'crew-odoo-finance-readonly', 'version': '1.0.0'}}
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return {'tools': TOOLS}
    if method == 'tools/call':
        params = request.get('params', {})
        try:
            value = finance.call(params.get('name'), params.get('arguments', {}))
            return {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}]}
        except FinanceError as error:
            message = str(error)
        except Exception:
            # Odoo faults/transport errors may include credentials or financial data.
            message = 'blocked_connection: Odoo request failed; check server-side access and connectivity'
        return {'isError': True, 'content': [{'type': 'text', 'text': message}]}
    return None


def main():
    socket.setdefaulttimeout(30)
    finance = Finance()
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if 'id' not in request:
                continue
            result = dispatch(request, finance)
            response = {'jsonrpc': '2.0', 'id': request['id']}
            if result is None:
                response['error'] = {'code': -32601, 'message': 'Method not found'}
            else:
                response['result'] = result
        except (ValueError, TypeError, AttributeError):
            response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Invalid request'}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
