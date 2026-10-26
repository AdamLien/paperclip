import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolvePaperclipInstanceRoot } from "@paperclipai/shared/home-paths";

export const accessMethods = ["direct", "vpn", "tunnel"] as const;
export const providers = ["none", "tailscale", "wireguard", "openvpn", "cloudflare", "other"] as const;
export type MorbitAccessMethod = (typeof accessMethods)[number];
export type MorbitProvider = (typeof providers)[number];

export type MorbitCompanyConnection = {
  revision: number; companyUrl: string | null; accessMethod: MorbitAccessMethod;
  provider: MorbitProvider; instructions: string; updatedAt: string | null;
};
export type MorbitCompanyConnectionAudit = { actorType: "user" | "agent"; actorId: string; actorSource: string };
export type MorbitCompanyConnectionUpdate = Omit<MorbitCompanyConnection, "revision" | "updatedAt"> & { expectedRevision: number };

export class MorbitCompanyConnectionRevisionConflict extends Error {
  readonly status = 409;
  constructor(readonly expectedRevision: number, readonly actualRevision: number) { super("Company connection revision is stale"); }
}

type ServiceOptions = { instanceRoot?: string; now?: () => Date; lockTimeoutMs?: number };
type PersistedChange = MorbitCompanyConnectionAudit & { revision: number; recordedAt: string; accessMethod: MorbitAccessMethod; provider: MorbitProvider };
type PersistedConnection = MorbitCompanyConnection & { lastChanges: PersistedChange[] };
const MAX_HISTORY = 20;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const defaultConnection: MorbitCompanyConnection = { revision: 0, companyUrl: null, accessMethod: "direct", provider: "none", instructions: "", updatedAt: null };

function connectionPath(options: ServiceOptions): string {
  return path.join(options.instanceRoot ?? resolvePaperclipInstanceRoot(), "data", "morbit", "company-connection.json");
}
function publicConnection(value: PersistedConnection): MorbitCompanyConnection {
  const { lastChanges: _lastChanges, ...publicFields } = value;
  return publicFields;
}
async function readStored(filePath: string): Promise<PersistedConnection> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<PersistedConnection>;
    const { lastChanges, ...publicFields } = parsed;
    return { ...defaultConnection, ...publicFields, lastChanges: Array.isArray(lastChanges) ? lastChanges.slice(-MAX_HISTORY) : [] } as PersistedConnection;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ...defaultConnection, lastChanges: [] };
    throw error;
  }
}
async function acquireFileLock(filePath: string, timeoutMs: number): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`; const deadline = Date.now() + timeoutMs;
  await mkdir(path.dirname(filePath), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return async () => { await rm(lockPath, { recursive: true, force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Lock recovery is manual: only remove this lock after verifying no live writer owns it.
      if (Date.now() >= deadline) throw new Error("Timed out waiting for company connection lock");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
async function writeAtomically(filePath: string, value: PersistedConnection): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { await rename(temporaryPath, filePath); } catch (error) { await rm(temporaryPath, { force: true }).catch(() => undefined); throw error; }
}
export function createMorbitCompanyConnectionService(options: ServiceOptions = {}) {
  const filePath = connectionPath(options); const now = options.now ?? (() => new Date()); const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  return {
    get: async () => publicConnection(await readStored(filePath)),
    update: async (input: MorbitCompanyConnectionUpdate, audit: MorbitCompanyConnectionAudit) => {
      const release = await acquireFileLock(filePath, lockTimeoutMs);
      try {
        const current = await readStored(filePath);
        if (current.revision !== input.expectedRevision) throw new MorbitCompanyConnectionRevisionConflict(input.expectedRevision, current.revision);
        const recordedAt = now().toISOString();
        const next: PersistedConnection = { revision: current.revision + 1, companyUrl: input.companyUrl, accessMethod: input.accessMethod, provider: input.provider, instructions: input.instructions, updatedAt: recordedAt,
          lastChanges: [...current.lastChanges, { ...audit, revision: current.revision + 1, recordedAt, accessMethod: input.accessMethod, provider: input.provider }].slice(-MAX_HISTORY) };
        await writeAtomically(filePath, next); return publicConnection(next);
      } finally { await release(); }
    },
  };
}
export function defaultMorbitCompanyConnection(): MorbitCompanyConnection { return { ...defaultConnection }; }
