/**
 * Base URL that a run's managed MCP servers (Paperclip projects, Paperclip
 * connections) are advertised at.
 *
 * Runs on the server host use `PAPERCLIP_API_URL`. A remote execution target
 * (SSH host, sandbox) may sit on a private network whose egress cannot reach
 * that public origin; `PAPERCLIP_REMOTE_EXECUTION_API_URL` names an origin
 * those targets can reach instead (for example `http://server:3100` on a
 * shared container network). Unset, remote runs keep `PAPERCLIP_API_URL`.
 */
export function resolveRuntimeMcpBaseUrl(
  executionTarget: { kind: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const remote = executionTarget?.kind === "remote" ? normalizeBaseUrl(env.PAPERCLIP_REMOTE_EXECUTION_API_URL) : null;
  return remote ?? normalizeBaseUrl(env.PAPERCLIP_API_URL);
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "").replace(/\/api$/, "") : null;
}
