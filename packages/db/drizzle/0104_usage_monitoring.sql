-- Usage and free-limit monitoring (founder 2026-11-26; spec 08 "Usage & limits"). New tables, plus the notice
-- entity type `platform` (CHECK added NOT VALID, then validated: no long lock on notifications).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "usage_alert_config" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"warn_pct" integer DEFAULT 70 NOT NULL,
	"critical_pct" integer DEFAULT 90 NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"email_locale" text DEFAULT 'en' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_alert_config_single" CHECK ("usage_alert_config"."id" = 1),
	CONSTRAINT "usage_alert_config_thresholds" CHECK ("usage_alert_config"."warn_pct" between 1 and 100 and "usage_alert_config"."critical_pct" between 1 and 100 and "usage_alert_config"."warn_pct" < "usage_alert_config"."critical_pct"),
	CONSTRAINT "usage_alert_config_recipients" CHECK (cardinality("usage_alert_config"."recipients") <= 10),
	CONSTRAINT "usage_alert_config_locale" CHECK ("usage_alert_config"."email_locale" in ('en','hi'))
);
--> statement-breakpoint
CREATE TABLE "usage_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_code" text NOT NULL,
	"level" text NOT NULL,
	"period" text NOT NULL,
	"value" bigint NOT NULL,
	"limit_value" bigint NOT NULL,
	"percent_bp" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_alerts_once_uq" UNIQUE("metric_code","level","period"),
	CONSTRAINT "usage_alerts_metric_valid" CHECK ("usage_alerts"."metric_code" in ('r2_storage_bytes','r2_objects_count','r2_class_a_ops_month_count','r2_class_b_ops_month_count','supabase_db_bytes','supabase_storage_bytes','supabase_storage_objects_count','server_disk_used_bytes','server_memory_used_bytes','resend_emails_month_count','resend_emails_day_count')),
	CONSTRAINT "usage_alerts_level_valid" CHECK ("usage_alerts"."level" in ('warn','critical')),
	CONSTRAINT "usage_alerts_period_format" CHECK ("usage_alerts"."period" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "usage_alerts_numbers" CHECK ("usage_alerts"."value" >= 0 and "usage_alerts"."limit_value" > 0 and "usage_alerts"."percent_bp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"metric_code" text NOT NULL,
	"period" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_metric_code_period_pk" PRIMARY KEY("metric_code","period"),
	CONSTRAINT "usage_counters_metric_valid" CHECK ("usage_counters"."metric_code" in ('r2_storage_bytes','r2_objects_count','r2_class_a_ops_month_count','r2_class_b_ops_month_count','supabase_db_bytes','supabase_storage_bytes','supabase_storage_objects_count','server_disk_used_bytes','server_memory_used_bytes','resend_emails_month_count','resend_emails_day_count')),
	CONSTRAINT "usage_counters_period_format" CHECK ("usage_counters"."period" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "usage_counters_count" CHECK ("usage_counters"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_limits" (
	"metric_code" text PRIMARY KEY NOT NULL,
	"limit_value" bigint,
	"alerts" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_limits_metric_valid" CHECK ("usage_limits"."metric_code" in ('r2_storage_bytes','r2_objects_count','r2_class_a_ops_month_count','r2_class_b_ops_month_count','supabase_db_bytes','supabase_storage_bytes','supabase_storage_objects_count','server_disk_used_bytes','server_memory_used_bytes','resend_emails_month_count','resend_emails_day_count')),
	CONSTRAINT "usage_limits_positive" CHECK ("usage_limits"."limit_value" is null or "usage_limits"."limit_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"staff_user_id" uuid,
	"r2_status" text NOT NULL,
	"supabase_status" text NOT NULL,
	"server_status" text NOT NULL,
	"resend_status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_runs_trigger_valid" CHECK ("usage_runs"."trigger" in ('schedule','manual','cli')),
	CONSTRAINT "usage_runs_r2_valid" CHECK ("usage_runs"."r2_status" in ('ok','not_configured','failed','partial')),
	CONSTRAINT "usage_runs_supabase_valid" CHECK ("usage_runs"."supabase_status" in ('ok','not_configured','failed','partial')),
	CONSTRAINT "usage_runs_server_valid" CHECK ("usage_runs"."server_status" in ('ok','not_configured','failed','partial')),
	CONSTRAINT "usage_runs_resend_valid" CHECK ("usage_runs"."resend_status" in ('ok','not_configured','failed','partial'))
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"metric_code" text NOT NULL,
	"value" bigint NOT NULL,
	"limit_value" bigint,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_snapshots_provider_valid" CHECK ("usage_snapshots"."provider" in ('r2','supabase','server','resend')),
	CONSTRAINT "usage_snapshots_metric_valid" CHECK ("usage_snapshots"."metric_code" in ('r2_storage_bytes','r2_objects_count','r2_class_a_ops_month_count','r2_class_b_ops_month_count','supabase_db_bytes','supabase_storage_bytes','supabase_storage_objects_count','server_disk_used_bytes','server_memory_used_bytes','resend_emails_month_count','resend_emails_day_count')),
	CONSTRAINT "usage_snapshots_source_valid" CHECK ("usage_snapshots"."source" in ('measured','estimated','provider_api')),
	CONSTRAINT "usage_snapshots_trigger_valid" CHECK ("usage_snapshots"."trigger" in ('schedule','manual','cli')),
	CONSTRAINT "usage_snapshots_value" CHECK ("usage_snapshots"."value" >= 0 and ("usage_snapshots"."limit_value" is null or "usage_snapshots"."limit_value" > 0))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_valid";--> statement-breakpoint
ALTER TABLE "usage_alert_config" ADD CONSTRAINT "usage_alert_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_alerts" ADD CONSTRAINT "usage_alerts_run_id_usage_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."usage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_limits" ADD CONSTRAINT "usage_limits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_runs" ADD CONSTRAINT "usage_runs_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_run_id_usage_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."usage_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_alert_config_updated_by_index" ON "usage_alert_config" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "usage_alerts_run_id_index" ON "usage_alerts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "usage_alerts_created_idx" ON "usage_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_limits_updated_by_index" ON "usage_limits" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "usage_runs_finished_idx" ON "usage_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "usage_runs_staff_user_id_index" ON "usage_runs" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "usage_snapshots_metric_measured_idx" ON "usage_snapshots" USING btree ("metric_code","measured_at");--> statement-breakpoint
CREATE INDEX "usage_snapshots_measured_idx" ON "usage_snapshots" USING btree ("measured_at");--> statement-breakpoint
CREATE INDEX "usage_snapshots_run_id_index" ON "usage_snapshots" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_valid" CHECK ("notifications"."entity_type" is null or "notifications"."entity_type" in ('order','service_request','rsa_request','quote','ticket','refund','shop','application','account','ustaad','platform')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_entity_type_valid";--> statement-breakpoint
ALTER TABLE public.usage_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.usage_snapshots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.usage_alert_config ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.usage_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.usage_runs, public.usage_snapshots, public.usage_limits, public.usage_alert_config, public.usage_alerts, public.usage_counters FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER usage_runs_append_only BEFORE UPDATE OR DELETE ON public.usage_runs
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER usage_snapshots_append_only BEFORE UPDATE OR DELETE ON public.usage_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER usage_alerts_append_only BEFORE UPDATE OR DELETE ON public.usage_alerts
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER usage_limits_bump_version BEFORE UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER usage_limits_touch_updated_at BEFORE UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER usage_alert_config_bump_version BEFORE UPDATE ON public.usage_alert_config
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER usage_alert_config_touch_updated_at BEFORE UPDATE ON public.usage_alert_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER usage_counters_touch_updated_at BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
INSERT INTO public.usage_alert_config (id) VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX "outbox_email_sent_idx" ON "notification_outbox" USING btree ("sent_at") WHERE "notification_outbox"."channel" = 'email' and "notification_outbox"."sent_at" is not null;