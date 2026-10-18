CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" uuid NOT NULL,
	"token" text NOT NULL,
	"binding_generation" integer DEFAULT 1 NOT NULL,
	"platform" text NOT NULL,
	"app_id" text NOT NULL,
	"environment" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_company_installation_uq" UNIQUE("company_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "push_completion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_log_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_completion_events_activity_uq" UNIQUE("activity_log_id")
);
--> statement-breakpoint
CREATE TABLE "push_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_binding_generation" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notification_deliveries_event_device_uq" UNIQUE("event_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_completion_events" ADD CONSTRAINT "push_completion_events_activity_log_id_activity_log_id_fk" FOREIGN KEY ("activity_log_id") REFERENCES "public"."activity_log"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_completion_events" ADD CONSTRAINT "push_completion_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_event_id_push_completion_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."push_completion_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_device_id_push_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."push_devices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "push_devices_company_user_idx" ON "push_devices" USING btree ("company_id","user_id");
--> statement-breakpoint
CREATE INDEX "push_devices_active_idx" ON "push_devices" USING btree ("company_id","revoked_at");
--> statement-breakpoint
CREATE INDEX "push_completion_events_status_idx" ON "push_completion_events" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "push_notification_deliveries_pending_idx" ON "push_notification_deliveries" USING btree ("status","next_attempt_at");
