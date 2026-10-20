# Crew company-scoped Supermemory

Keep the existing self-hosted Supermemory on port 6767. A loopback gateway on
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
restore its previous command/config through that API. Do not stop the existing
Supermemory service or delete its original data.

## Verification

Run `node --test scripts/company-supermemory/gateway.test.mjs` for both tenants'
write/search/profile isolation and rejected alternate-scope requests. Run
`python3 -m unittest discover -s scripts/company-supermemory -p '*_test.py'`
for sandbox policy checks. All test commands must use the repository RTK prefix.

On Linux, launch `crew-company-codex --company-memory-probe` with each agent's
real company ID, agent ID, managed CODEX_HOME and workspace. This tests own-scope
HTTP 200, cross-company HTTP 403, direct upstream HTTP 401 with the company key,
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
