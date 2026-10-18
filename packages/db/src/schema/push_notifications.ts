import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { activityLog } from "./activity_log.js";
import { companies } from "./companies.js";

export const pushDevices = pgTable("push_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  installationId: uuid("installation_id").notNull(),
  token: text("token").notNull(),
  bindingGeneration: integer("binding_generation").notNull().default(1),
  platform: text("platform").notNull(),
  appId: text("app_id").notNull(),
  environment: text("environment").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("push_devices_company_installation_uq").on(table.companyId, table.installationId),
  index("push_devices_company_user_idx").on(table.companyId, table.userId),
  index("push_devices_active_idx").on(table.companyId, table.revokedAt),
]);

export const pushCompletionEvents = pgTable("push_completion_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityLogId: uuid("activity_log_id").notNull().references(() => activityLog.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  issueId: text("issue_id").notNull(),
  recipientUserId: text("recipient_user_id").notNull(),
  status: text("status").$type<"pending" | "processed">().notNull().default("pending"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("push_completion_events_activity_uq").on(table.activityLogId),
  index("push_completion_events_status_idx").on(table.status, table.createdAt),
]);

export const pushNotificationDeliveries = pgTable("push_notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => pushCompletionEvents.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => pushDevices.id, { onDelete: "cascade" }),
  deviceBindingGeneration: integer("device_binding_generation").notNull(),
  status: text("status").$type<"pending" | "processing" | "sent" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("push_notification_deliveries_event_device_uq").on(table.eventId, table.deviceId),
  index("push_notification_deliveries_pending_idx").on(table.status, table.nextAttemptAt),
]);
