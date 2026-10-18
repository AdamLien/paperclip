# Taiwan Traditional Chinese localization

Status: translation draft, not deployed.

Based on the deployed public revision bba6a45f0d364cfd962ac59b3bdf2426a8222adb to avoid combining localization with a server upgrade.

Completed: reuse existing i18next; import community static UI localization with attribution; create Taiwan catalogs and terminology overrides; language selector and persistence; focused tests; production UI build; typecheck and token gates; local login-page preview.

Completed follow-up: accounted for all 2,885 original missing candidates (2,843 translations and 42 reviewed technical/brand literals preserved). Fresh source scan: 13,176 catalog-matched positions, 45 preserved positions, zero missing static candidates. Runtime checks cover every added translation and preserved literal.

Remaining: review the converted catalog for meaning and Taiwan usage; connect labels outside static UI output positions; validate authenticated page journeys and server error messages; full repository verification; independent review; deployment with rollback; actual mobile acceptance.

Keep deployment branding and internal configuration outside any upstream contribution. Do not submit this draft as complete localization. Coordinate with the existing upstream i18n contributors before opening a competing upstream PR.
