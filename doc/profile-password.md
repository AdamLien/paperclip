# Change password from Profile

The authenticated UI now offers **Settings → Profile → Change password**. This uses the existing Better Auth `/api/auth/change-password` endpoint; no new server endpoint, database migration or administrator permission is added.

## Behavior

- Enter the current password, the new password and confirmation. New passwords must be 8–128 characters, match the confirmation and differ from the current password. Whitespace is preserved.
- Inputs are masked and have `current-password` / `new-password` autocomplete hints.
- The request includes `revokeOtherSessions: true`. Other sessions are signed out; Better Auth retains the current session.
- Confirmation is not sent. Passwords are not stored in browser storage, React state or React Query mutation variables. Fields clear after a completed attempt, successful or unsuccessful.
- Submission is blocked while pending. There are no automatic retries.
- Wrong current password, expired session and rate limiting have actionable inline messages. Unknown/network failures warn that the outcome may be uncertain, rather than claiming success or blindly retrying.
- Password-change responses and network errors bypass the auth client's raw diagnostic logging. Server-provided error messages/bodies are not retained in the thrown error or displayed by the form. Successful auth response tokens are not returned to callers.
- The form has English and Traditional Chinese translations. Other supported languages use English for this new namespace.
- This is for email/password accounts; it does not change an external identity-provider password or add password recovery.

## Verification (2026-11-07)

Base: `4a8bd66392daf14e28900e9eab1183f4e7d5aca5` (the UAT/develop source at implementation time).

1. Red: the new component test failed because the form did not exist; three auth client tests failed because `changePassword` did not exist.
2. Green: 29 tests across `ChangePasswordForm.test.tsx`, `ProfileSettings.test.tsx`, `api/auth.test.ts` and `i18n/locale-validation.test.ts` passed.
3. UI TypeScript check and all three design-token commands passed.
4. Vite production build passed, with existing config/CSS/chunk warnings. Run using existing local dependencies on Node 22.22.0; the repository documents Node 24.11+ as its development prerequisite.
5. A local browser loaded the actual production UI at the Profile route, with a synthetic local API (no UAT proxy). Incorrect current password produced the Traditional Chinese error and cleared fields; a valid synthetic request produced the success message and cleared fields. At 375px, document width was 375px and all three fields were 343px wide.
6. An independent read-only review found no confirmed correctness or credential-leakage defect.

Expanded Taiwan locale tests: 5/6 passed; the pre-existing catalog-count assertion expects 2885 while unchanged HEAD catalogs total 2898. Those files were not modified for this feature. The focused locale-validation and form language-switch tests pass.

## Release limits

This evidence is local implementation/build/browser verification, not live UAT acceptance. The browser API was synthetic: it does not prove real password persistence, session-cookie rotation, other-session revocation or new-password login. No real account password was changed by this feature's verification. Those checks need a disposable authenticated account after normal feature → develop → fixed-source UAT promotion. The source was not merged or deployed, and PROD was not touched.

The full monorepo typecheck, full test suite and all-package build were not run; verification was scoped to the UI change. No dependency manifests or lockfiles changed.
