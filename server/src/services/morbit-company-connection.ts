import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "@paperclipai/shared/home-paths";

export const accessMethods = ["direct", "vpn", "tunnel"] as const;
export const providers = ["none", "tailscale", "wireguard", "openvpn", "cloudflare", "other"] as const;

export type MorbitAccessMethod = (typeof accessMethods)[number];
export type MorbitProvider = (typeof providers)[number];

export type MorbitCompanyConnection = {
  revision: number;
  companyUrl: string | null;
  accessMethod: MorbitAccessMethod;
  provider: MorbitProvider;
  instructions: string;
  updatedAt: string | null;
};

export type MorbitCompanyConnectionUpdate = Omit<MorbitCompanyConnection, "revision" | "updatedAt"> & {
  expectedRevision: number;
};

export class MorbitCompanyConnectionRevisionConflict extends Error {
  readonly status = 409;

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super("Company connection revision is stale");
  }
}

type ServiceOptions = {
  instanceRoot?: string;
  now?: () => Date;
};

const defaultConnection: MorbitCompanyConnection = {
  revision: 0,
  companyUrl: null,
  accessMethod: "direct",
  provider: "none",
  instructions: "",
  updatedAt: null,
};

let writeTail = Promise.resolve();

function connectionPath(options: ServiceOptions): string {
  const instanceRoot = options.instanceRoot ?? resolvePaperclipInstanceRoot();
  return path.join(instanceRoot, "data", "morbit", "company-connection.json");
}

async function readStored(filePath: string): Promise<MorbitCompanyConnection> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<MorbitCompanyConnection>;
    return {
      ...defaultConnection,
      ...parsed,
    } as MorbitCompanyConnection;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return defaultConnection;
    throw error;
  }
}

async function writeAtomically(filePath: string, value: MorbitCompanyConnection): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeTail.then(operation, operation);
  writeTail = next.then(() => undefined, () => undefined);
  return next;
}

export function createMorbitCompanyConnectionService(options: ServiceOptions = {}) {
  const filePath = connectionPath(options);
  const now = options.now ?? (() => new Date());

  return {
    get: () => readStored(filePath),
    update: (input: MorbitCompanyConnectionUpdate) => withWriteLock(async () => {
      const current = await readStored(filePath);
      if (current.revision !== input.expectedRevision) {
        throw new MorbitCompanyConnectionRevisionConflict(input.expectedRevision, current.revision);
      }
      const next: MorbitCompanyConnection = {
        revision: current.revision + 1,
        companyUrl: input.companyUrl,
        accessMethod: input.accessMethod,
        provider: input.provider,
        instructions: input.instructions,
        updatedAt: now().toISOString(),
      };
      await writeAtomically(filePath, next);
      return next;
    }),
  };
}

export function defaultMorbitCompanyConnection(): MorbitCompanyConnection {
  return { ...defaultConnection };
}

