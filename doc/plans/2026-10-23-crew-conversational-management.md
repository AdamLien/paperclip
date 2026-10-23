# mCrew conversational management

Adam authorized implementation of the previously discussed management workflow.
Use sammi as the conversation entry point, preserve company isolation, reuse
native authorization/skill revisions/connection grants, and deliver real results.

## Contract

- Add a company-scoped capability/settings overview with agents, assigned skills,
  connectors, authorization identities, audiences, successful-call evidence and
  management history. Never equate installed, authorized and business-verified.
- Add authenticated run-bound management tools. Discoverable reads stay scoped;
  mutations require the native permission evaluator and a responsible user.
  Calls go through native validated APIs, not a forged board identity.
- Support native agent profile/model changes, skill import/assignment/version
  rollback, environment checks and connector authorization handoff. Native
  board-only operations retain their owner handoff and visible setting link.
- Provide pinned runtime recipes installed within the existing company sandbox,
  versioned directories and an atomic active pointer with rollback.
  No arbitrary host commands, sudo, cross-company credentials or host mounts.
- Expose only safe metadata. OAuth claims and completed tool-call evidence are
  separate; unknown external tenant IDs remain visibly unknown.
- Existing project tools remain responsible for project creation, task ownership,
  Git workspaces and deployment. Mac control and mCrew self-update are later work.

## Verification

Test tenant/run/mode/permission denials, protected configuration fields, API error
propagation, recipe containment/rollback and metadata redaction. Verify a live
sammi management operation, an assigned agent's actual runtime check, the rendered
settings page and the existing company isolation probes. Record deployment and
rollback paths separately from source commits.

## Verified on 2026-10-23

- The live secretary used the new MCP tools to inspect another agent, create a
  company skill, and add it without replacing the agent's other selections.
- The secretary installed recipe revision `146063874fe1de7d` inside its existing
  company sandbox. The assigned agent used that recipe to generate a short MP3
  and a verification record. The app loaded the audio and downloaded 21,024 bytes.
- A request for an agent in the other company returned only `Resource not found`.
  An inspection of the caller in its own company succeeded.
- The 390-pixel settings page had no horizontal overflow or console errors.
- Core management/HTTP tests, runtime tests, UI typecheck/build, and staged-release
  preservation test pass. Server-wide typecheck remains blocked by existing
  missing runner declarations and unrelated diagnostics; new management files
  had no diagnostics in the scoped check.

## Explicit limits

- Native owner-only operations keep their permission gates. They return an owner
  handoff instead of silently applying a change.
- New-agent runtime inheritance requires the native `paperclip_runner` adapter.
  Existing `codex_local` agents are not silently migrated.
- Generic connector success cannot establish an external tenant identity. This
  overview reports missing tenant evidence instead of inferring it from a name.
- Runtime recipes are operator-pinned. The initial recipe is media. There is no
  generic root installer, automatic self-deployment, Mac pairing, or Voicebox
  integration in this release.
