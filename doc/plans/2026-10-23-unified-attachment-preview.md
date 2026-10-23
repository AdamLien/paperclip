# Unified attachment preview implementation plan

**Goal:** Clicking an attachment opens an in-app preview; downloading remains an explicit separate action.

**Design:** Reuse the authorized task side panel and existing HTML/Markdown/Mermaid renderers. Add PDF.js page navigation for both original PDFs and PDF derivatives of Office documents. Convert Office documents locally with LibreOffice inside a networkless Bubblewrap sandbox; never give a document converter access to application credentials, company storage or host home directories. Preserve originals. No external document viewer.

**Tech stack:** Existing React/Vite/Express, PDF.js 6.4.299, existing Linux LibreOffice and Bubblewrap.

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
- [ ] Add Office recognition, isolated conversion and an authorized preview branch to the content route; test size/error/isolation cases and unauthorized requests.
- [ ] Add shared PDF/media viewer and preserve text preview; test Office classification, page navigation and attachment authorization.
- [ ] Run focused tests, type/build checks and Linux real conversion for synthetic PPTX/DOCX/XLSX.
- [ ] Publish reviewed Git changes and verify rendered desktop/mobile preview. Report deployment and physical-device acceptance separately.

## Observed baseline
- The live PPTX opens the task side panel but shows the unsupported-text-preview fallback.
- The 16:47 mCRM auth receipt identified `adamlien329` as an admin and returned ready; later consumption lookup failed independently.
- Opening the old SMS review URL now shows reconnect required. These are historical/current UI observations, not a new successful authorization or send.
