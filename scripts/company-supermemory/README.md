# Crew company-scoped Supermemory

Keep the existing self-hosted Supermemory data and move its legacy backend to
port 6770. The v0.0.8 API implicitly trusts localhost, so `network-guard.sh`
blocks the agent host UID from this private port and blocks external ingress.
An authenticated front retains the administrator's original port 6767 and key.
A loopback gateway on
6768 authenticates different random company credentials and only permits
`context`, `recall`, and `memory` operations in the credential's exact
`crew_company_<company UUID>` container. No global search, arbitrary memory IDs,
bulk operations, redirects, additional filters, or caller-selected scopes.

`mcp.cjs` reuses the existing local stdio MCP bridge. Its only credential is the
company-scoped client configuration mounted at `/run/crew-memory/client.json`.
The upstream administrative credential stays in a root-only server config.

`codex-sandbox.py` replaces the existing OCX command while retaining the model
endpoint and native Paperclip HTTP MCP gateways. Bubblewrap starts with an
empty mount tree and exposes only system binaries, the current company Codex
home, the current agent workspace/instructions, its company skills and selected
read-only Wiki. Host home directories, other company homes, instance database,
secret store, automation registry and administrative credentials are absent.
Unmanaged host stdio MCP servers are disabled; Supermemory uses the company
bridge instead. Unknown companies or unexpected workspace/home paths fail
closed. No host-shell fallback is allowed if the sandbox cannot start.
The outer Bubblewrap boundary owns confinement; the nested Codex workspace
sandbox is disabled to avoid attempting prohibited nested user namespaces.
The public OCX model catalog is exposed read-only as one explicitly allowed
file, while its surrounding host Codex home remains hidden.

## Configuration (not committed)

- `/etc/crew-company-memory/server.json`: root-only upstream key and company
  tokens; systemd loads it using `LoadCredential`.
- `/etc/crew-company-memory/runtime.json`: public company-to-home/Wiki policy.
- `/var/lib/crew-company-memory/clients/<company UUID>.json`: separate client
  credentials. They are never copied between company homes.
- `/usr/local/lib/crew-company-memory`: Git-checkout-backed release symlink.
- `/usr/local/bin/crew-company-codex`: symlink to `codex-sandbox.py`.

Deploy code by fetching/checking out the exact Git commit, then install the
service and non-Git credential files on the target host. Never rsync runtime
state or commit keys. Back up old adapter configs/instruction bundles before
PATCHing through the authenticated Paperclip API. To roll back an agent,
restore its previous command/config through that API. Preserve the original
data and service definition. The old user service is disabled after a graceful
stop; `crew-supermemory-storage.service` runs the same binary/data as
`metabiz-admin` with the dedicated primary group `crew-memory-store`. That
group is not assigned to agent processes. The firewall permits the storage
server's startup self-request while denying ordinary UID 1000 processes.
The storage unit requires the network guard; the gateway does too. On rollback,
stop the new services before restoring the user service and its original port.

## Verification

### Company Wiki librarian

`runtime.json` may name `wikiWriterAgents` inside a tenant. Only those agent
UUIDs receive writable overlays for existing compiled Wiki directories and
`INDEX`; the vault root, `99 Meta`, `Observations`, and each compiled directory's
`_assets` stay read-only. Other agents keep the original read-only mount, and
a tenant with no `readOnlyWiki` receives no Wiki mount. Writable folders must
be real directories, never symlinks. These mounts do not grant other tenants'
workspaces, personal Google credentials, or personal Wikis.

On 2026-10-22, metabiz provisioned its Wiki librarian with the existing OCX API
secret reference, `gpt-6.1-sol`, on-demand execution and concurrency one. It has
no agent/skill creation permission and no finance/Google secrets. Runtime
instructions require pre-change workspace backups and hash checks, source
links, existing-page reuse, index/log updates, and readback. These workflow
requirements are instructions; the mount boundary does not prevent an
authorized writer from deleting a compiled page. Deletion still requires Adam.

The Linux integration test verifies real writes succeed only in compiled
directories for the librarian, fail for a normal agent, and remain inaccessible
to a customer tenant. It also checks evidence/control protection. Live probes
verified the same mounts, a backed-up SOP/index/log write succeeded inside the
librarian sandbox, and the first actual Crew model run succeeded. A taskless
manual run can emit the existing connector gateway's task-bound-run 422; it is
not a Wiki file permission failure and does not validate connector access.

The Mac iCloud and Linux NAS Wikis had different existing index hashes. Do not
describe their mount as verified bidirectional synchronization or overwrite one
with the other. This provisioning preserved both histories independently.

Run `node --test scripts/company-supermemory/gateway.test.mjs` for both tenants'
write/search/profile isolation and rejected alternate-scope requests. Run
`python3 -m unittest discover -s scripts/company-supermemory -p '*_test.py'`
for sandbox policy checks. All test commands must use the repository RTK prefix.

On Linux, launch `crew-company-codex --company-memory-probe` with each agent's
real company ID, agent ID, managed CODEX_HOME and workspace. This tests own-scope
HTTP 200, cross-company HTTP 403 (including through the administrator front),
direct upstream network rejection,
hidden host credentials and isolated `/proc`. A customer fixture must additionally
prove the metabiz Wiki is absent. Then run the actual Codex MCP client inside
the same boundary and verify the three tools; a real agent run is required to
claim the agent has actually used memory. API connectivity alone is insufficient.

The company boundary is for agent execution and company-scoped credentials;
the trusted host administrator can manage both tenants. This does not claim
hardening of every Paperclip management endpoint, model-provider billing,
customer mCRM credentials, or a complete commercial tenant-security audit.
Customer data remains disabled until the customer runtime is provisioned and
verified. Agents must not create alternative unconfined runners or change the
memory connection. The control plane must retain operator control over runtime
configuration and agent provisioning before untrusted customer access.

## Verified deployment, 2026-10-20

All five existing metabiz agents use `/usr/local/bin/crew-company-codex` and
have a company-memory instruction section. Their previous adapter settings
and instructions are saved in the host-only rollback directory; native API
changes also retain Paperclip revisions. Existing role/skill/provider settings
were retained. The new customer company exists but has no customer agent,
member invitation, mCRM grant, or imported business data yet. Provision any
future agent through this runner and re-run the company probe before use;
the company-creation wizard alone does not enforce a runner for future agents.

Live probes passed for all five metabiz agents and the isolated customer
fixture: MCP context succeeds, own-scope HTTP 200, cross-scope 403, direct
backend blocked, host credentials absent. Customer fixture cannot see the
metabiz Wiki. Each company's durable boundary policy was written and read back
without the other company's policy appearing. The existing Mac context call
continues to work; incorrect keys on the legacy API now return 401.

Steve's native Crew run `ddb225be-c220-4241-8ee1-b093c350c40f` succeeded and its
event log records `supermemory.context` completed without error. The temporary
verification prompt was removed afterward. Other agents passed their actual
sandbox MCP probes; they were not assigned duplicate business tasks to test
connectivity. Earlier compatibility probes failed before the final fixes;
those native run records are retained for audit.

## Odoo finance MCP (opt-in per agent)

`odoo-finance-mcp.py` is a separate stdio MCP for the CFO. It uses the Odoo
external XML-RPC API at the fixed company ERP, database `odoo16`, company 1.
It does not reuse a browser session or the writable CRM/quotation connector.
The only tools are `finance_health` and `finance_read`. Accounting dates,
allowlisted models/fields, bounded pagination, and a fixed company domain are
enforced by code. No caller-selected RPC method, domain, fields or context.

Add only the CFO agent UUID to its tenant's `odooFinanceAgents` runtime policy.
The runner then registers `odoo_finance` and forwards only that agent's
`ODOO_FINANCE_LOGIN` and `ODOO_FINANCE_API_KEY` environment bindings. Provision
the API key through Crew's encrypted secret store, not config files, Git,
task comments, chat, or shell command text. Other agents do not inherit it.

Use a dedicated service account limited to company 1 and read-only accounting
ACLs. Every tool call rechecks its company membership and accounting ACLs;
create/write/unlink permission on any supported accounting model fails closed.
Account moves and journal lines must be readable; missing optional payment or
bank-statement access is reported as incomplete coverage. Checks do not attempt
actual financial writes. Odoo faults are redacted before returning to agents.

Leave the daily Crew routine paused and its trigger disabled until a real key
passes health, model reads, company-scope and account-permission checks. A
successful protocol handshake without credentials only verifies installation.
Read the full necessary history for opening balances/overdue items and paginate
to the returned total before claiming coverage. A missing model or failed call
must never produce an "all clear" report. Deduplicate exception notifications
to Adam; do not send daily messages for unchanged results.

Tests cover the stdio MCP handshake/tool calls, scope/argument/mutation denial,
broad-account rejection, pagination, redaction, and per-agent sandbox opt-in.
