# Taiwan Traditional Chinese UI

This fork reuses the i18next foundation already in Paperclip. Static UI localization is adapted from jiazi009's MIT-licensed contribution, https://github.com/paperclipai/paperclip/pull/11251 (e7fddd1a47d43b42a4adc4572527b8bbc2ae4cc4), including earlier work credited there to convergentaru and cat9999aaa. The original keyed catalog is retained separately so existing locale validation contracts remain unchanged.

The initial zh-TW catalogs were converted from that contribution with OpenCC s2twp, then normalized for Taiwan terminology. Login, navigation, common actions and company settings have additional context-specific overrides. The complete catalog has NOT received a manual line-by-line translation review.

The Vite transform translates static source literals in UI output positions. It does not walk or mutate the DOM. Dynamic user/API values and protocol identifiers remain unchanged. Existing keyed translations continue through i18next. The compiler uses an explicit TypeScript 5 parser dependency because the project's TypeScript 7 package does not expose the same compiler API.

`UiLocaleSelect` provides English and Traditional Chinese (Taiwan) on login, company settings and the account menu. Language choices persist in browser storage. `VITE_PAPERCLIP_DEFAULT_LOCALE=zh-TW` selects the deployment default when there is no stored preference. English remains the fallback.

Original audit baseline: 13,221 static literal positions; 9,919 had catalog matches. The original 2,885 distinct missing candidates are now accounted for: 2,843 translations in `completion-zh-TW.json` and 42 explicitly preserved technical/brand literals in `preserved-zh-TW.json`. The original baseline scan found 13,176 catalog-matched positions and 45 preserved positions, with zero missing static candidates. This inventory has not been refreshed for newer upstream pages. `pending-zh-TW.json` retains the original inventory under `resolved` plus preservation reasons. These counts do not establish complete interface coverage. Dynamic label arrays, technical strings, new pages and server-originated errors need separate review. This contribution does not change the server or database.

Verification: focused localization/transform tests; UI dependency build; UI typecheck; design token gates; local production-build browser login and EN/zh-TW switching. These results apply to the original source baseline. Full repository tests, authenticated page journeys and mobile device acceptance on the upstream integration branch remain pending.

Completion verification: all 2,843 added messages are exercised through the runtime translator with representative interpolated values; all 42 preserved literals are checked unchanged. This also guards against template rules translating product-name suffixes such as Microsoft Teams. Remaining acceptance includes authenticated UI journeys and contextual human review.

## Display-boundary follow-up

The settings navigation, mobile navigation, governance choices, deployment status, backup units and feedback choices now translate their fixed display labels explicitly. `clarity-zh-TW.json` provides reviewed wording overrides after the original catalogs. Labels are translated at render time so saved locale changes do not require recreating module-level option arrays. Routes, option values, policy keys and user-authored names remain unchanged. Settings breadcrumb literals are translated at their source, leaving the organization name intact. The governance introduction is a complete sentence resource instead of separately translated fragments.

Focused integration tests exercise language switching, unchanged routes and policy values, and the new-task callback. This follow-up does not establish full application translation coverage or server-error localization.


## Dynamic workflow and API connection follow-up

Chat placeholders, agent counts, empty states, connector actions/statuses and breadcrumb labels now use explicit display boundaries. Shipped connector descriptions and curated app-gallery copy have reviewed Taiwan translations; custom connector names, descriptions and conversation content remain user-authored. Numeric `N of M` counters use a count-only rule rather than the unsafe arbitrary-prose template.

Agent labels distinguish the configured model connection from the execution harness: an OCX key binding displays `OCX API · Codex CLI`, another API key binding displays `API key · Codex CLI`, and an unspecified connection displays only `Codex CLI`. This reports configured bindings, not a live authentication or billing check. It never renders a key, reference ID or endpoint, and does not infer a provider from a model name.

The connector-description audit checks every shipped first-party connector description. The full static-source audit was run against the deployed fork revision; newer upstream-only UI features have not all received translation review. User content, external tool catalogs and arbitrary server errors are outside that audit. Focused integration tests also cover locale switching, preserved names/model IDs and the real composer picker.
