# Unified attachment preview implementation plan

**Goal:** Conversation attachments use consistent compact cards. Clicking opens a full-screen reader with filename, Download and Close; the original downloads only on an explicit action. This supersedes the earlier automatic inline-viewer design following device feedback.

**Design:** Reuse the authorized task side panel and existing HTML/Markdown/Mermaid renderers. Add PDF.js page navigation for both original PDFs and PDF derivatives of Office documents. Convert Office documents locally with LibreOffice inside a networkless Bubblewrap sandbox; never give a document converter access to application credentials, company storage or host home directories. Preserve originals. No external document viewer.

**Tech stack:** Existing React/Vite/Express, PDF.js 6.4.299, existing Linux LibreOffice and Bubblewrap.

## Full-screen reader revision

- One common attachment card and reader now serve message attachments, generated artifact cards, local attachment links and the image-gallery entry point. No automatically mounted inline document viewer or secondary tab/source toolbar.
- PDF and Office pagination remains inside the content area. HTML uses the existing offline sandbox; media controls remain native. Closing restores the conversation.
- 57 focused UI tests pass, including generated PPTX/HTML/image cards, six reader formats, authorization denial, explicit download, closing and embedded HTML image sanitization; direct UI TypeScript build passes.
- Native iOS download requests explicitly copy URL-matching WebView cookies to the request, keep cross-origin/redirect guards, and distinguish authorization, missing-file and redirect errors. Native suite: 17 Node tests and 2 Python tests pass; arm64 Simulator build passes.
- The screenshot alone does not establish the native failure's HTTP status. Physical iPhone download acceptance requires a new native binary and remains pending.
- Live 390 × 844 verification on production build `20261023004`: full-screen HTML, one header and explicit Download/Close, PPTX page 1 to page 2 of 12; explicit original download is a valid 5,253,174-byte PPTX. Native changes: [mobile PR #4](https://github.com/AdamLien/paperclip-mobile/pull/4), stacked on #3.
- Live HTML validation found embedded images stripped by the existing sanitizer. Preserve only base64 raster images on IMG elements; scripts, external URLs, SVG, srcset and network remain blocked. This follow-up is packaged as production build `20261023006` with the same Git/manifest staging process.

## Constraints and acceptance
- Re-resolve each attachment from the task's authorized list before fetching content.
- The existing content endpoint performs company and issue checks before conversion; preview cannot bypass them.
- Limit conversion input/output bytes, time, process concurrency and child resources; clean temporary files on all outcomes. Fail closed without sandbox dependencies.
- PDF rendering is paginated with bounded canvas dimensions and no embedded document scripting.
- Images, audio and video have native controls; HTML remains an opaque offline sandbox.
- Office preview has loading, retry and explicit error states; no automatic download. Original downloads preserve the filename and bytes.
- Git commit/build provenance for releases; no rsync or manual live patching.
- Existing SMS review is investigated separately. Do not execute or recreate an expired send proposal during preview work.

## Tasks
- [x] Add Office recognition, isolated conversion and an authorized preview branch to the content route; test size/error/isolation cases and unauthorized requests.
- [x] Add shared PDF/media viewer and preserve text preview; test Office classification, page navigation and attachment authorization.
- [x] Run focused tests, type/build checks and Linux real conversion for synthetic PPTX/DOCX/XLSX.
- [x] Publish Git changes and verify the live in-app browser at its actual 433px width. Report deployment and physical-device acceptance separately.
- [ ] Wide desktop breakpoint and physical iPhone/Android acceptance remain unverified; the in-app browser viewport override did not change its actual width.

## Verification — 2026-10-23

- Implementation Git revision: `afa873f3e2cb9a0722369575322e8daba34f25be`; draft PR [#9](https://github.com/AdamLien/paperclip/pull/9), based on the #8 management branch.
- 57 focused tests passed: 37 attachment route cases, 3 conversion service cases, 15 classification/panel cases, 2 PDF viewer cases. Includes company/parent issue denial, size/type guards, preserved downloads, page navigation, load errors and cleanup.
- Production UI build passed. UI typecheck and the new conversion service's targeted TypeScript check passed. Existing Vite/CSS/chunk warnings remain; this is not a whole-repository typecheck claim.
- Existing Linux LibreOffice, Bubblewrap and prlimit used; no host package installation or Docker configuration change.
- Synthetic Linux real conversions: PPTX 2 pages / 24,474 PDF bytes / 1,193 ms; DOCX 1 page / 19,108 bytes / 767 ms; XLSX 1 page / 17,077 bytes / 720 ms. Fixtures contain no customer data.
- Release staged using checked-in build/stage scripts, with Git revision and per-file SHA-256 manifest; the existing route was normalized and matched to the selected Git baseline before building, and its exact live hash was rechecked before staging.
- Activated release `attachment-preview-afa873f`; previous release `management-20261023-0121` retained for rollback. No migrations or dependency-tree replacement. Staged app import and service restart succeeded; service active.
- Live existing 12-page PPTX displayed inside the app and navigated from page 1 to page 2. At 433 × 675 CSS pixels, canvas rendered at 409 × 230. Browser error log empty during this check.
- Explicit original download returned a valid PPTX ZIP containing `ppt/presentation.xml`, 5,253,174 bytes. Preview did not trigger a download.
- Screenshot saved locally outside Git: `~/.codex/visualizations/2026/10/23/mcrew-attachment-preview.png`.

## Operational limits

- Office preview needs Linux Bubblewrap, prlimit, LibreOffice and fonts. It fails closed if dependencies/isolation are unavailable. Containers need an explicitly supported user-namespace configuration; there is no unsandboxed fallback.
- First open converts the document again; no derivative cache yet. Two conversions per server process, 20 MB input, 40 MB output, 60 seconds. Over-limit or encrypted/invalid documents show an error and retain explicit original download.
- Office previews are read-only PDFs. Spreadsheet cell editing, presentation animation and original Office layout parity are not provided.
- Physical mobile binary/WebView behavior remains a separate acceptance gate.

## Observed baseline
- The live PPTX opens the task side panel but shows the unsupported-text-preview fallback.
- The 16:47 mCRM auth receipt identified `adamlien329` as an admin and returned ready; later consumption lookup failed independently.
- Opening the old SMS review URL now shows reconnect required. These are historical/current UI observations, not a new successful authorization or send.
- Follow-up live verification: used the connector's native test dialog as sammi, with a single-call approval and no persistent policy change. Remote auth status succeeded in 1.9 seconds, selected operator role `admin`, state `ready`. This verifies the current connection; it does not repair the earlier consumption action or renew/send the old SMS proposal. No SMS was sent during this work.

### Final release verification

- Active source revision: `3fe656081580d6d03fbc83c3d0ccfdd91a0e2f53`; release `attachment-preview-3fe6560`. Versioned release activated atomically; user service restarted and confirmed active.
- Removed the obsolete PDF.js 6 `isEvalSupported` option. Direct UI `tsc -b` passed, PDF viewer tests passed again, and the production UI build passed.
- Reloaded the live sammi page against the final release: the existing 12-page PPTX rendered page 1, then page 2 after Next. Browser error log was empty. Final screenshot saved to `/Users/adamlien/.codex/visualizations/2026/10/23/mcrew-attachment-preview.png`.
- Native iPhone/Android acceptance remains unverified.

### In-conversation reading follow-up

- User confirmed automatic previews inside conversation messages, with expand and original download as separate actions. Reuse the same authorized attachment panel in a bounded embedded card; mount only near the viewport and destroy viewers offscreen. Unknown/unbound links retain the existing file path behavior.
- Release numbering: `YYYYMMDDNNN` using Asia/Taipei, UAT odd, production even. Build script validates format, date, environment and parity and records them in the hashed artifact manifest. Activated production build: `20261023002`, source `785184323cfb498a2ad6ae5d31b955674fa21731`. The Git-pinned, per-file hashed release was staged and activated atomically; paperclip.service confirmed active. Previous release retained for rollback.
- SMS operational acceptance: the original proposal was expired with `send_called=false`. A fresh proposal for the unchanged, previously authorized recipient/content was reviewed as the connected admin and executed once as sammi. Remote receipt returned HTTP 200, `api_accepted`, `send_called=true`, `delivery_verified=false`. Adam subsequently confirmed the SMS was received. This is human-confirmed delivery, distinct from the provider receipt field. No resend. Tenant/recipient identifiers and credentials omitted from Git.

- Current inline follow-up validation: 44 targeted tests passed (30 chat bubble, 13 attachment panel, 1 viewport lifecycle), direct UI TypeScript check and production build passed. Live chat automatically rendered the existing PPTX first page inside the message without opening the side panel. The subsequent final pagination/expand UI check was blocked when the background in-app browser reported a 0 by 0 viewport; it is not claimed as passed for the embedded variant. Earlier side-panel pagination remains separately verified above. Physical native App acceptance remains unverified.
