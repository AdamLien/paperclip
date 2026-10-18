import { z } from "zod";

export const pushDeviceRegistrationSchema = z.object({
  installationId: z.uuid(),
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(["ios", "android"]),
  appId: z.enum(["work.metabiz.crew.uat", "work.metabiz.crew"]),
  environment: z.enum(["uat", "production"]),
}).strict();

export type PushDeviceRegistration = z.infer<typeof pushDeviceRegistrationSchema>;
