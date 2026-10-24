import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { pushDeviceRegistrationSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { pushNotificationService } from "../services/push-notifications.js";
import { listNotificationInbox } from "../services/notification-inbox.js";

export function pushDeviceRoutes(db: Db) {
  const router = Router();
  const validateInstallationId = (req: Request, _res: Response, next: NextFunction) => {
    const result = z.object({ installationId: z.string().uuid() }).safeParse(req.params);
    if (!result.success) throw badRequest("Invalid installationId", result.error.issues);
    next();
  };
  const service = pushNotificationService(db);
  const ownUser = (req: Parameters<typeof assertBoard>[0]) => {
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("Authenticated board user required");
    return req.actor.userId;
  };

  router.get("/notifications", async (req, res) => {
    const userId=ownUser(req);
    if(req.query.cursor!==undefined && typeof req.query.cursor!=="string") throw badRequest("Invalid notification cursor");
    res.setHeader("Cache-Control","no-store");
    res.json(await listNotificationInbox(db,userId,req.query.cursor as string|undefined));
  });

  router.get("/companies/:companyId/push-devices", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await service.list(companyId, ownUser(req)));
  });

  router.post("/companies/:companyId/push-devices", validate(pushDeviceRegistrationSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await service.register(companyId, ownUser(req), req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "push_device.registered",
      entityType: "push_device",
      entityId: result.id,
      details: { installationId: result.installationId, platform: result.platform, appId: result.appId, environment: result.environment },
    });
    res.status(200).json(result);
  });

  router.delete("/companies/:companyId/push-devices/:installationId", validateInstallationId, async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const revoked = await service.revoke(ownUser(req), req.params.installationId as string, companyId);
    const actor = getActorInfo(req);
    for (const device of revoked) await logActivity(db, {
      companyId: device.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "push_device.revoked",
      entityType: "push_device",
      entityId: device.id,
      details: { installationId: device.installationId },
    });
    res.status(204).end();
  });

  router.delete("/push-devices/:installationId", validateInstallationId, async (req, res) => {
    const revoked = await service.revoke(ownUser(req), req.params.installationId as string);
    const actor = getActorInfo(req);
    for (const device of revoked) await logActivity(db, {
      companyId: device.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "push_device.revoked",
      entityType: "push_device",
      entityId: device.id,
      details: { installationId: device.installationId },
    });
    res.status(204).end();
  });
  return { router, service };
}
