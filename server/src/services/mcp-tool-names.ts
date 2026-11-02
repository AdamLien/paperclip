import { createHash } from "node:crypto";

export const ASSIGNED_MCP_SERVER_NAME = "paperclip-assigned";
// Claude rejects a request whose prefixed MCP tool name exceeds 128 characters,
// and runs on UAT failed with names that left no headroom below that limit.
// OpenAI-compatible clients cap function names at 64, so keep gateway names
// there and leave the client room for its own prefix.
export const MAX_GATEWAY_TOOL_NAME_LENGTH = 64;

/** Preserve existing short names; aliases still resolve through gateway metadata. */
export function boundedMcpToolName(name: string, identity: readonly string[]): string {
  if (name.length <= MAX_GATEWAY_TOOL_NAME_LENGTH) return name;
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 12);
  const separator = name.indexOf(":");
  const namespace = name.slice(0, separator < 0 ? name.length : separator).slice(0, 16);
  const tool = separator < 0 ? "tool" : name.slice(separator + 1);
  const budget = MAX_GATEWAY_TOOL_NAME_LENGTH - namespace.length - hash.length - 2;
  return `${namespace}:${tool.slice(0, budget)}-${hash}`;
}
