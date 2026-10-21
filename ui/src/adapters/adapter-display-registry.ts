/**
 * Single source of truth for adapter display metadata.
 *
 * Built-in adapters have entries in `adapterDisplayMap`. External (plugin)
 * adapters get sensible defaults derived from their type string via
 * `getAdapterDisplay()`.
 */
import type { ComponentType } from "react";
import type { Agent } from "@paperclipai/shared";
import {
  Bot,
  Code,
  Gem,
  Moon,
  MousePointer2,
  Sparkles,
  Terminal,
  Cpu,
} from "lucide-react";
import { OpenCodeLogoIcon } from "@/components/OpenCodeLogoIcon";

// ---------------------------------------------------------------------------
// Type suffix parsing
// ---------------------------------------------------------------------------

// Suffixes stripped from type ids when deriving a human-readable label for
// unknown (plugin) adapter types. "_local" is a legacy qualifier from before
// first-class Environments and is never displayed; "_gateway" is re-appended
// as " (gateway)" to disambiguate gateway variants. Known adapters in
// `adapterDisplayMap` have final labels and never get a derived suffix.
const STRIPPED_TYPE_SUFFIXES = ["_local", "_gateway"] as const;

const DISPLAY_SUFFIXES: Record<string, string> = {
  _gateway: "gateway",
};

function getTypeSuffix(type: string): string | null {
  for (const [suffix, mode] of Object.entries(DISPLAY_SUFFIXES)) {
    if (type.endsWith(suffix)) return mode;
  }
  return null;
}

function withSuffix(label: string, suffix: string | null): string {
  return suffix ? `${label} (${suffix})` : label;
}

// ---------------------------------------------------------------------------
// Display metadata per adapter type
// ---------------------------------------------------------------------------

export interface AdapterDisplayInfo {
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  recommended?: boolean;
  comingSoon?: boolean;
  disabledLabel?: string;
  experimental?: boolean;
  hideFromVisualSelection?: boolean;
}

const adapterDisplayMap: Record<string, AdapterDisplayInfo> = {
  acpx_local: {
    label: "ACPX (retired)",
    description: "Retired standalone ACPX adapter",
    icon: Bot,
    comingSoon: true,
    disabledLabel: "Use Claude Code or Codex with the ACP engine",
    hideFromVisualSelection: true,
  },
  claude_local: {
    label: "Claude Code",
    description: "Claude Code CLI harness",
    icon: Sparkles,
    recommended: true,
  },
  codex_local: {
    label: "Codex",
    description: "Codex CLI harness",
    icon: Code,
    recommended: true,
  },
  paperclip_runner: {
    label: "Paperclip Runner",
    description: "Experimental Rust runner with a Codex provider",
    icon: Cpu,
    experimental: true,
  },
  gemini_local: {
    label: "Gemini CLI",
    description: "Gemini CLI harness",
    icon: Gem,
  },
  grok_local: {
    label: "Grok Build",
    description: "Grok Build harness",
    icon: Bot,
  },
  kimi_local: {
    label: "Kimi Code",
    description: "Kimi Code CLI harness",
    icon: Moon,
  },
  hermes_gateway: {
    label: "Hermes Gateway",
    description: "Remote Hermes API server",
    icon: Bot,
    hideFromVisualSelection: true,
  },
  hermes_local: {
    label: "Hermes",
    description: "Hermes harness",
    icon: Bot,
  },
  opencode_local: {
    label: "OpenCode",
    description: "OpenCode multi-provider harness",
    icon: OpenCodeLogoIcon,
  },
  pi_local: {
    label: "Pi",
    description: "Pi harness",
    icon: Terminal,
  },
  cursor: {
    label: "Cursor",
    description: "Cursor CLI harness",
    icon: MousePointer2,
  },
  cursor_cloud: {
    label: "Cursor Cloud",
    description: "Managed remote Cursor agent",
    icon: MousePointer2,
  },
  openclaw_gateway: {
    label: "OpenClaw Gateway",
    description: "External gateway adapter",
    icon: Bot,
    comingSoon: true,
    disabledLabel: "Invite external agents from the add-agent modal",
    hideFromVisualSelection: true,
  },
  process: {
    label: "Process",
    description: "Internal process adapter",
    icon: Cpu,
    comingSoon: true,
  },
  http: {
    label: "HTTP",
    description: "Internal HTTP adapter",
    icon: Cpu,
    comingSoon: true,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function humanizeType(type: string): string {
  // Strip known type suffixes so "droid_local" → "Droid", not "Droid Local"
  let base = type;
  for (const suffix of STRIPPED_TYPE_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return base.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getAdapterLabel(type: string): string {
  // Known labels are final — only unknown (plugin) types get a derived
  // suffix, so labels like "OpenClaw Gateway" don't become
  // "OpenClaw Gateway (gateway)".
  const known = adapterDisplayMap[type];
  if (known) return known.label;
  return withSuffix(humanizeType(type), getTypeSuffix(type));
}

export function getAdapterLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [type, info] of Object.entries(adapterDisplayMap)) {
    labels[type] = info.label;
  }
  return labels;
}

/** Describe the configured model connection separately from its execution harness.
 * Inspect binding presence only: never include keys, secret references or endpoints. */
export function getAgentExecutionLabel(agent: Pick<Agent, "adapterType" | "adapterConfig">): string {
  if (agent.adapterType !== "codex_local") return getAdapterLabel(agent.adapterType);
  const env = agent.adapterConfig?.env;
  const hasBinding = (key: string) => {
    if (!env || typeof env !== "object" || Array.isArray(env)) return false;
    const value = (env as Record<string, unknown>)[key];
    if (typeof value === "string") return value.trim().length > 0;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const binding = value as Record<string, unknown>;
    if (binding.type === "plain") return typeof binding.value === "string" && binding.value.trim().length > 0;
    if (binding.type === "secret_ref") return typeof binding.secretId === "string" && binding.secretId.trim().length > 0;
    if (binding.type === "user_secret_ref") return typeof binding.key === "string" && binding.key.trim().length > 0;
    return false;
  };
  if (hasBinding("OCX_API_KEY")) return "OCX API · Codex CLI";
  if (hasBinding("OPENAI_API_KEY")) return "API key · Codex CLI";
  return "Codex CLI";
}

export function getAdapterDisplay(type: string): AdapterDisplayInfo {
  const known = adapterDisplayMap[type];
  if (known) return known;

  const suffix = getTypeSuffix(type);
  const label = withSuffix(humanizeType(type), suffix);
  return {
    label,
    description: suffix ? `External ${suffix} adapter` : "External adapter",
    icon: Cpu,
  };
}

export function isKnownAdapterType(type: string): boolean {
  return type in adapterDisplayMap;
}
