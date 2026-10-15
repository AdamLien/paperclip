import { AsyncLocalStorage } from "node:async_hooks";
import { EXECUTION_PREPARATION_SPAN_ATTRS, runWithRuntimeParent } from "@paperclipai/adapter-utils/acpx-engine/startup-timing";
import { createHash } from "node:crypto";
import { isSpanContextValid, ROOT_CONTEXT, SpanStatusCode, trace, type Context } from "@opentelemetry/api";

type PreparationPhase = "environment_selection" | "execution_configuration" | "session"
  | "workspace" | "github_environment" | "github_launchers" | "run_output"
  | "workspace_validation" | "runtime_services" | "instructions" | "runtime_selection"
  | "configuration_mentions" | "configuration_github_identity" | "configuration_secrets"
  | "configuration_ai_runtime" | "configuration_skills" | "configuration_connector_assignments"
  | "configuration_connector_skills" | "configuration_connector_delivery"
  | "configuration_connection_instructions" | "configuration_agent_identity"
  | "workspace_source_resolution"
  | "workspace_provision_policy"
  | "workspace_base_validation"
  | "workspace_source_authorization"
  | "workspace_provision"
  | "workspace_source_retention"
  | "workspace_binding"
  | "workspace_record_update"
  | "workspace_record_create"
  | "workspace_operation_binding"
  | "workspace_config_recording"
  | "workspace_repository_admission"
  | "workspace_project_repositories"
  | "workspace_recovery_root"
  | "github_access" | "wake_binding" | "backend_setup" | "connector_assignments"
  | "assigned_mcp" | "tool_authority" | "companion_selection" | "runner_binary"
  | "github_stop" | "coordinator_release" | "instruction_checkpoint"
  | "instruction_changes" | "warm_release" | "instruction_collection";

export type ExecutionPhase =
  | "workspace.transaction" | "workspace.transaction.entry" | "workspace.transaction.commit" | "workspace.transaction.rollback"
  | "workspace.identity_read" | "workspace.row_lock" | "workspace.provenance" | "workspace.notification" | "workspace.write"
  | "workspace.sources" | "workspace.sources.canonicalize" | "workspace.sources.inventory" | "workspace.sources.alias_scan"
  | "workspace.sources.repository_scan" | "workspace.sources.project_scan" | "workspace.provenance_lock"
  | "workspace.readers" | "workspace.readers.identity" | "workspace.readers.trust" | "workspace.readers.projects" | "workspace.readers.sources"
  | "workspace.access" | "workspace.access.privacy" | "workspace.access.inventory" | "workspace.access.authorization"
  | "runtime_selection.review" | "runtime_selection.contract_read" | "runtime_selection.contract_ensure"
  | "runtime_selection.resume" | "runtime_selection.recovery_profile" | "runtime_selection.profile" | "runtime_selection.interactions"
  | "runtime_selection.provider_discovery" | "runtime_selection.bootstrap" | "runtime_selection.run_write" | "runtime_selection.finalization_write"
  | "runtime_selection.transaction" | "runtime_selection.transaction.entry" | "runtime_selection.transaction.commit" | "runtime_selection.transaction.rollback"
  | "runtime_selection.row_lock" | "runtime_selection.workspace_sync"
  | "runtime_context.instructions" | "runtime_context.skills" | "runtime_context.mcp"
  | "runtime_context.asset_read" | "runtime_context.asset_manifest" | "runtime_context.asset_cache" | "runtime_context.asset_materialize" | "runtime_context.asset_verify"
  | "workspace_sync.snapshot_git" | "workspace_sync.snapshot_baseline" | "workspace_sync.pack" | "workspace_sync.seed_verify" | "workspace_sync.stage_workspace" | "workspace_sync.restore"
  | "execution.runtime" | "execution.workspace_ownership" | "execution.workspace_finalize" | "execution.workspace_restore" | "execution.workspace_commit"
  | "execution.workspace_ownership_wait" | "execution.realtime"
  | "execution.usage" | "execution.native_finalize"
  | "completion.run" | "completion.output" | "completion.terminal_write" | "completion.cost" | "completion.liveness" | "completion.summary"
  | "response.transaction" | "response.transaction.entry" | "response.transaction.commit" | "response.transaction.rollback" | "response.row_lock" | "response.write"
  | "response.resolve" | "response.authorize" | "response.add_comment" | "response.activity" | "response.publish";

type RunScope = { runId: string; parent?: Context; ended: boolean; details: Map<string, number> };
const ownership = new AsyncLocalStorage<RunScope>();
const endpointEnabled = () => Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());

export function getRunExecutionTraceContext(runId: string): Context | undefined {
  const owned = ownership.getStore();
  return endpointEnabled() && owned?.runId === runId && !owned.ended ? owned.parent : undefined;
}

function measure<T>(runId: string, name: string, work: () => T | Promise<T>, independent = false, counts: { fileCount?: number; bytes?: number } = {}): Promise<T> {
  let operation: Promise<T> | undefined;
  const run = (span?: { setStatus(status: { code: number }): void; end(): void }, parent?: Context) => {
    if (operation) return operation;
    const previous = ownership.getStore();
    const owned: RunScope = { runId,
      parent: parent ?? (!independent && previous?.runId === runId && !previous.ended ? previous.parent : undefined),
      ended: false,
      details: !independent && previous?.runId === runId ? previous.details : new Map<string, number>(),
    };
    operation = Promise.resolve().then(() =>
      ownership.run(owned, () => runWithRuntimeParent(owned.parent, work))).then(value => {
        try { span?.end(); } catch {}
        owned.ended = true;
        return value;
      }, error => {
        try { span?.setStatus({ code: SpanStatusCode.ERROR }); } catch {}
        try { span?.end(); } catch {}
        owned.ended = true;
        throw error;
      });
    return operation;
  };
  if (!endpointEnabled()) return (async () => work())();
  try {
    const parent = independent ? undefined : getRunExecutionTraceContext(runId);
    const trigger = parent ? undefined : trace.getActiveSpan()?.spanContext();
    const traced = trace.getTracer(name.startsWith("heartbeat.prepare.") ? "paperclip.heartbeat-preparation"
      : name.startsWith("native.controller.") ? "paperclip.native-controller" : "paperclip.execution").startActiveSpan(name, {
      attributes: { [EXECUTION_PREPARATION_SPAN_ATTRS.runId]: createHash("sha256").update(runId).digest("hex").slice(0, 12),
        ...Object.fromEntries((["fileCount", "bytes"] as const).flatMap(key =>
          typeof counts[key] === "number" && Number.isSafeInteger(counts[key]) && counts[key]! >= 0
            ? [[EXECUTION_PREPARATION_SPAN_ATTRS[key], counts[key]!]] : [])),
      },
      ...(trigger && isSpanContextValid(trigger) ? { links: [{ context: trigger }] } : {}),
    }, parent ?? ROOT_CONTEXT, span => {
      let childContext: Context | undefined;
      try { childContext = trace.setSpan(parent ?? ROOT_CONTEXT, span); } catch {}
      return run(span, childContext);
    });
    void Promise.resolve(traced).catch(() => undefined);
  } catch {}
  return operation ?? run();
}

export function withRunExecutionTiming<T>(runId: string, work: () => T | Promise<T>): Promise<T> {
  return measure(runId, "task.execution_attempt", work, true);
}

export async function measureRunPhase<T>(phase: ExecutionPhase, work: () => T | Promise<T>, counts?: { fileCount?: number; bytes?: number }): Promise<T> {
  const owned = ownership.getStore();
  if (!endpointEnabled() || !owned || owned.ended) return work();
  const count = owned.details.get(phase) ?? 0;
  if (count >= 16) return work();
  owned.details.set(phase, count + 1);
  return measure(owned.runId, phase, work, false, counts);
}

export function beginRunPhase(phase: ExecutionPhase): (failed?: boolean) => void {
  const owned = ownership.getStore();
  if (!endpointEnabled() || !owned?.parent || owned.ended) return () => {};
  const count = owned.details.get(phase) ?? 0;
  if (count >= 16) return () => {};
  owned.details.set(phase, count + 1);
  try {
    const span = trace.getTracer("paperclip.execution").startSpan(phase, {
      attributes: { [EXECUTION_PREPARATION_SPAN_ATTRS.runId]: createHash("sha256").update(owned.runId).digest("hex").slice(0, 12) },
    }, owned.parent);
    let ended = false;
    return failed => {
      if (ended) return;
      ended = true;
      if (failed) { try { span.setStatus({ code: SpanStatusCode.ERROR }); } catch {} }
      try { span.end(); } catch {}
    };
  } catch { return () => {}; }
}

export function createRunPreparationTiming(runId: string, scope: "heartbeat.prepare" | "native.controller" = "heartbeat.prepare") {
  return <T>(phase: PreparationPhase, work: () => T | Promise<T>): Promise<T> => measure(runId, `${scope}.${phase}`, work);
}

export function measureWorkspaceSyncPhase<T>(name: string, work: () => Promise<T>): Promise<T> {
  const phases: Readonly<Record<string, ExecutionPhase>> = {
    "snapshot.git": "workspace_sync.snapshot_git", "snapshot.baseline": "workspace_sync.snapshot_baseline",
    pack: "workspace_sync.pack", "seed.verify": "workspace_sync.seed_verify",
    "stage.workspace": "workspace_sync.stage_workspace", "restore.workspace": "workspace_sync.restore",
    "workspace.restore": "execution.workspace_restore",
  };
  return Object.prototype.hasOwnProperty.call(phases, name) ? measureRunPhase(phases[name]!, work) : work();
}
