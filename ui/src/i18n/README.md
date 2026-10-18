# Taiwan Traditional Chinese UI draft

This fork reuses the i18next foundation already in Paperclip. Static UI localization is adapted from jiazi009's MIT-licensed contribution, https://github.com/paperclipai/paperclip/pull/11251 (e7fddd1a47d43b42a4adc4572527b8bbc2ae4cc4), including earlier work credited there to convergentaru and cat9999aaa. The original keyed catalog is retained separately so existing locale validation contracts remain unchanged.

The initial zh-TW catalogs were converted from that contribution with OpenCC s2twp, then normalized for Taiwan terminology. Login, navigation, common actions and company settings have additional context-specific overrides. The complete catalog has NOT received a manual line-by-line translation review.

The Vite transform translates static source literals in UI output positions. It does not walk or mutate the DOM. Dynamic user/API values and protocol identifiers remain unchanged. Existing keyed translations continue through i18next. The compiler uses an explicit TypeScript 5 parser dependency because the project's TypeScript 7 package does not expose the same compiler API.

`UiLocaleSelect` provides English and Traditional Chinese (Taiwan) on login, company settings and the account menu. Language choices persist in browser storage. `VITE_PAPERCLIP_DEFAULT_LOCALE=zh-TW` selects the deployment default when there is no stored preference. English remains the fallback.

Original audit baseline: 13,221 static literal positions; 9,919 had catalog matches. The original 2,885 distinct missing candidates are now accounted for: 2,843 translations in `completion-zh-TW.json` and 42 explicitly preserved technical/brand literals in `preserved-zh-TW.json`. A fresh source scan finds 13,176 catalog-matched positions and 45 preserved positions, with zero missing static candidates. `pending-zh-TW.json` retains the original inventory under `resolved` plus preservation reasons. These counts do not establish complete interface coverage. Dynamic label arrays, technical strings, new pages and server-originated errors need separate review. The production server has not been changed by this draft.

Verification: focused localization/transform tests; UI dependency build; UI typecheck; design token gates; local production-build browser login and EN/zh-TW switching. Full repository tests, authenticated production page journeys, deployment and mobile device acceptance remain pending.

Completion verification: all 2,843 added messages are exercised through the runtime translator with representative interpolated values; all 42 preserved literals are checked unchanged. This also guards against template rules translating product-name suffixes such as Microsoft Teams. Remaining acceptance includes authenticated UI journeys and contextual human review.

## Display-boundary follow-up

The settings navigation, mobile navigation, governance choices, deployment status, backup units and feedback choices now translate their fixed display labels explicitly. `clarity-zh-TW.json` provides reviewed wording overrides after the original catalogs. Labels are translated at render time so saved locale changes do not require recreating module-level option arrays. Routes, option values, policy keys and user-authored names remain unchanged. Settings breadcrumb literals are translated at their source, leaving the organization name intact. The governance introduction is a complete sentence resource instead of separately translated fragments.

Focused integration tests exercise language switching, unchanged routes and policy values, and the new-task callback. This follow-up does not establish full application translation coverage or server-error localization.
