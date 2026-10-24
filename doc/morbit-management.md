# mDeck management adapter

The custom UI belongs to `metabiz-web/apps/mdeck-admin`. The host serves its
static export at `/management/` using `PAPERCLIP_MDECK_ADMIN_DIR`. Every HTML,
asset and API request reuses the existing board session and workspace authority.
This adds no identity store or duplicate Agents/Skills/Connector editor.

## New same-origin contract

- `GET /api/morbit/workspaces`: workspaces the current board user can manage.
- `GET /api/companies/:companyId/morbit/access`: active membership and management capabilities.
- `GET /api/companies/:companyId/morbit/management`: native links and observed service state.
- `POST /api/companies/:companyId/morbit/base/test`: instance administrator only, empty JSON body.
- `POST /api/companies/:companyId/morbit/brain/read`: allowlisted Wiki data operation.
- `POST /api/companies/:companyId/morbit/brain/action`: manager-only writes; member queries retain their existing scope.

Successful responses use `{code:"SUCCESS",message:"",data:...}` and no-store.
Existing host authentication, CSRF and error middleware remain authoritative.
Owner/admin membership or `users:manage_permissions` permits workspace management;
instance management is separate. Viewer membership never grants management.
Unknown or inactive workspaces are rejected before any upstream call.

## OCX boundary

Only the server operator supplies these UAT-specific environment references:

| Variable | Meaning |
| --- | --- |
| `MORBIT_UAT_OCX_URL` | Operator-owned OCX model API base, ending in `/v1/` |
| `MORBIT_UAT_OCX_MODEL` | Fixed model for the harmless connection test |
| `MORBIT_UAT_OCX_TOKEN_FILE` | Private file containing the OCX model-admission token |
| `MORBIT_UAT_OCX_ADMIN_TOKEN_FILE` | Separate private OCX management token file |

The adapter first authenticates `GET /api/system/health` on that origin and
checks OCX identity plus semantic version. It then sends a fixed, non-private
prompt through `/v1/chat/completions`. Credentials never enter browser payloads.
Only model, OCX version and verification time are returned; successful evidence
expires after five minutes. Missing credentials, authorization failures and
outages remain distinct. Configuration alone is not readiness.

This is an adapter foundation, not provider-account management. OCX retains its
native OAuth callbacks, account selection and token refresh. Real UAT provider
login, account/scope evidence and model acceptance are still required. Do not
copy production provider credentials into UAT.

## Wiki boundary

The adapter resolves the installed `paperclipai.plugin-llm-wiki` UUID server-side,
forces the authorized company and propagates the user actor for actions. Browser
parameters cannot choose a plugin, host root or another company. Native Wiki write
routes also pass the management guard; agent calls retain their existing host/tool
authority. Importing a source does not prove indexing, citations or retrieval ACL.

AD/LDAP, service installation automation, backup/update commands and the full
Wiki source → index → cited-answer acceptance remain unfinished. The UI must
continue showing these limitations rather than synthetic ready indicators.

## Verification

Run the management/base server integration suites and the server/UI typechecks.
The UI repository separately owns its client, role/error integration tests and
static build. Deployment additionally requires fixed commits for both repos,
an immutable assembled image and authenticated manager/employee UAT acceptance.
