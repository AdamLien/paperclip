# Taiwan Traditional Chinese UI draft

This fork reuses the i18next foundation already in Paperclip. Static UI localization is adapted from jiazi009's MIT-licensed contribution, https://github.com/paperclipai/paperclip/pull/11251 (e7fddd1a47d43b42a4adc4572527b8bbc2ae4cc4), including earlier work credited there to convergentaru and cat9999aaa. The original keyed catalog is retained separately so existing locale validation contracts remain unchanged.

The initial zh-TW catalogs were converted from that contribution with OpenCC s2twp, then normalized for Taiwan terminology. Login, navigation, common actions and company settings have additional context-specific overrides. The complete catalog has NOT received a manual line-by-line translation review.

The Vite transform translates static source literals in UI output positions. It does not walk or mutate the DOM. Dynamic user/API values and protocol identifiers remain unchanged. Existing keyed translations continue through i18next. The compiler uses an explicit TypeScript 5 parser dependency because the project's TypeScript 7 package does not expose the same compiler API.

`UiLocaleSelect` provides English and Traditional Chinese (Taiwan) on login, company settings and the account menu. Language choices persist in browser storage. `VITE_PAPERCLIP_DEFAULT_LOCALE=zh-TW` selects the deployment default when there is no stored preference. English remains the fallback.

Current audit baseline: 13,221 static literal positions; 9,919 have catalog matches. There are 2,885 distinct missing literals in `pending-zh-TW.json`. These are coverage candidates, not a claim that the entire interface is translated. Dynamic label arrays, technical strings, new pages and server-originated errors need separate review. The production server has not been changed by this draft.

Verification: focused localization/transform tests; UI dependency build; UI typecheck; design token gates; local production-build browser login and EN/zh-TW switching. Full repository tests, authenticated production page journeys, deployment and mobile device acceptance remain pending.
