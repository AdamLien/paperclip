# Taiwan Traditional Chinese localization

Status: upstream integration draft.

Scope: Taiwan Traditional Chinese catalogs, static UI literal localization, language selection and persisted locale preference. English remains the fallback. User-authored and API data remain unchanged.

The source changes were ported onto upstream master on 2026-10-18. Preserve upstream dependency versions when applying the localization changes. No deployment branding, server configuration or release tooling is part of this contribution.

The original audit resolved 2,885 distinct candidates: 2,843 translated and 42 preserved technical or brand literals. The inventory describes the original source baseline. It is not a coverage claim for later upstream pages.

Remaining: contextual human review of converted catalogs; dynamic label and server-error coverage; full repository checks; authenticated and mobile acceptance on the upstream integration branch. Existing localization PRs overlap this implementation and require maintainer direction before merge. No prior Discord design agreement is claimed.

Attribution and implementation details are in ui/src/i18n/README.md.
