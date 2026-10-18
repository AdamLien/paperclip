# Automatic task recovery — 2026-10-17

Outcome: normal execution and recoverable interruptions continue without a task
user certifying infrastructure facts. Deliver a reviewed PR and runnable
Storybooks from `codex/automatic-task-recovery`. The observed staging incident
does not authorize replaying its completed GitHub writes or approving
its maintainer completion decision.

## Acceptance

| Case | Expected behavior | Evidence |
| --- | --- | --- |
| Yield after saving an eligible task monitor | Omitted continuation resolves from current server state; the original monitor remains the wake path. | Real tool-boundary regression and server admission tests. |
| Yield without a valid wait, stale owner, or invalid explicit continuation | No invented passive wait or successful completion; useful correction feedback. | Refusal controls. |
| Provider-pack timeout or unavailable command result | Bounded infrastructure retry, with a diagnostic distinct from a proved integrity mismatch. | Command-boundary fault tests and existing recovery bounds. |
| Actual provider-pack mismatch | Preserve exact source work and existing ownership/integrity holds; no speculative replay. | Failure classification and retention controls. |
| Automatic recovery, then restored execution | No task repair form or recovery-needed warning; retain ordinary Working/finishing presentation. | Shared production components in Storybook and a running-app walkthrough. |
| Recovery cannot safely continue | Concise truthful blocker with inspection; technical repair stays with the operator. | Existing native/legacy holds, saved messages, retry refusal, mobile and keyboard coverage. |

## Delivery slices and ownership

The current chat owns implementation and integration. First resolve completion
defaults at the shared provider boundary, then classify runtime verification
failures, then simplify the shared task recovery notice and its stories. Keep
the existing retry budgets and ownership, approval, pause, dependency and archive
confinement gates. Do not create a parallel recovery scheduler.

The first experiment is a missing-continuation tool call against a current saved
monitor. Use focused local tests before broader required typecheck/test/build.
Storybook uses real production components with simulated API data; it is UI
evidence, not proof of provider recovery. Preserve story IDs and update authored
map recipes where behavior changes.

## State

- Baseline: `cfa9dce295`; incident diagnosis and October 13 chat located.
- Observed incident: six rejected finish calls, then graceful interruption and failed
  reattachment. Published PR #16639 head `d99284b` is preserved.
- The runtime verifier currently conflates timeout and nonzero exit as permanent
  artifact incompatibility. Its empty stderr does not establish a digest mismatch.
- Dependencies installed with pinned pnpm 9.15.4. Storybook target: localhost:6195.
- Safe monitor inference passes canonical/provider contract, real Codex tool,
  and persisted server monitor tests. Missing/consumed/cleared schedules cannot
  create a wait.
- The task form is removed. Production-component stories demonstrate quiet
  automatic recovery, unresolved/expired holds, reader access, and mobile.
- Provider verification now retries interrupted reads once, distinguishes
  incomplete checks from incompatible artifacts, and holds after its own read
  budget is exhausted. Reattachment cannot renew that budget through an
  unchanged provider-attempt counter.
- Next: finish OpenCode process-boundary and full workspace checks, then review
  and publish the PR. The source incident remains held pending safe operator
  inspection; this branch has not been deployed.
