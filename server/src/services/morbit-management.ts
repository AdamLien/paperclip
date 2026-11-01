import { readFile } from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { accessService } from "./access.js";
import { companyService } from "./companies.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { logActivity } from "./activity-log.js";
import { getActorInfo } from "../routes/authz.js";
import { HttpError } from "../errors.js";
import type { ManagementDependencies } from "../routes/morbit-management.js";
import { createMorbitModelAdapter } from "./morbit-base.js";
import { createMbasePartnerModelService } from "./mbase-partner-model.js";
import { createMorbitConsoleProxy, readMorbitNativeEntry } from "./morbit-native-entry.js";
import { createMorbitCompanyConnectionService } from "./morbit-company-connection.js";

/** Bridge to existing services, with no separate users, storage, OAuth or credential copies. */
export function managementDependencies(db: Db, workers: PluginWorkerManager): ManagementDependencies {
  const companies = companyService(db);
  const access = accessService(db);
  const registry = pluginRegistryService(db);
  const partnerModels = createMbasePartnerModelService();
  const model = createMorbitModelAdapter({
    endpoint: process.env.MORBIT_UAT_OCX_URL,
    model: process.env.MORBIT_UAT_OCX_MODEL,
    listAnthropicModels: partnerModels.configured ? () => partnerModels.listModels() : undefined,
    readToken: process.env.MORBIT_UAT_OCX_TOKEN_FILE
      ? () => readFile(process.env.MORBIT_UAT_OCX_TOKEN_FILE!, "utf8") : undefined,
    readAdminToken: process.env.MORBIT_UAT_OCX_ADMIN_TOKEN_FILE
      ? () => readFile(process.env.MORBIT_UAT_OCX_ADMIN_TOKEN_FILE!, "utf8") : undefined,
  });
  const consoleProxy = createMorbitConsoleProxy({
    upstream: process.env.MORBIT_UAT_OCX_URL,
    adminTokenFile: process.env.MORBIT_UAT_OCX_ADMIN_TOKEN_FILE || "/run/secrets/ocx_admin",
    bridgeOrigin: process.env.PAPERCLIP_PUBLIC_URL,
  });
  return {
    companies: () => companies.list(),
    company: id => companies.getById(id),
    canManage: (companyId, userId) => access.hasPermission(companyId, "user", userId, "users:manage_permissions"),
    wiki: async () => {
      const plugin = await registry.getByKey("paperclipai.plugin-llm-wiki");
      return plugin ? { id: plugin.id, status: plugin.status, version: plugin.version } : null;
    },
    modelStatus: model.status,
    modelTest: model.test,
    wikiCall: async (key, params, action, pluginId, req) => {
      try {
        if (!action) return await workers.call(pluginId, "getData", { key, params, companyId: String(params.companyId), renderEnvironment: null }, 30_000);
        return await workers.call(pluginId, "performAction", {
          key, params, renderEnvironment: null,
          actorContext: { type: "user", userId: req.actor.userId ?? null, agentId: null,
            runId: req.actor.runId ?? null, companyId: String(params.companyId) },
        }, 30_000);
      } catch { throw new HttpError(502, "Wiki operation failed; inspect service diagnostics"); }
    },
    audit: async (req, companyId, action, details) => {
      const actor = getActorInfo(req);
      await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId,
        action, entityType: "company", entityId: companyId, details });
    },
    companyConnection: createMorbitCompanyConnectionService(),
    nativeEntry: () => readMorbitNativeEntry(),
    consoleProxy,
  };
}
