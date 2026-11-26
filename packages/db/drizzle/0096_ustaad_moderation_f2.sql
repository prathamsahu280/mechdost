-- Workstream F2 (spec 23 § 13; decisions 2026-11-26 "Ustaad moderation F2"): the 36 h removal-grievance clock, the
-- classifier report source, the 2 h `ncii_impersonation` reason, and the end date of a moderation restriction.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ustaad_report_reasons" DROP CONSTRAINT "ustaad_report_reasons_code_valid";--> statement-breakpoint
ALTER TABLE "ustaad_report_reasons" DROP CONSTRAINT "ustaad_report_reasons_clock_valid";--> statement-breakpoint
ALTER TABLE "ustaad_reports" DROP CONSTRAINT "ustaad_reports_source_valid";--> statement-breakpoint
ALTER TABLE "ustaad_reports" DROP CONSTRAINT "ustaad_reports_reason_valid";--> statement-breakpoint
ALTER TABLE "ustaad_reports" DROP CONSTRAINT "ustaad_reports_clock_valid";--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD COLUMN "restricted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_restricted_until" CHECK ("ustaad_members"."restricted_until" is null or "ustaad_members"."status" = 'restricted');--> statement-breakpoint
ALTER TABLE "ustaad_report_reasons" ADD CONSTRAINT "ustaad_report_reasons_code_valid" CHECK ("ustaad_report_reasons"."code" in ('wrong_unsafe','illegal_modification','abuse','spam','privacy','minor','not_work','fake','job_scam','ip','ncii_impersonation','other'));--> statement-breakpoint
ALTER TABLE "ustaad_report_reasons" ADD CONSTRAINT "ustaad_report_reasons_clock_valid" CHECK ("ustaad_report_reasons"."default_clock" in ('intimate_2h','legal_3h','removal_36h','standard_24h','grievance_7d'));--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_source_valid" CHECK ("ustaad_reports"."source" in ('member','auto_word','auto_scam','auto_safety','legal_order','grievance'));--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_reason_valid" CHECK ("ustaad_reports"."reason_code" in ('wrong_unsafe','illegal_modification','abuse','spam','privacy','minor','not_work','fake','job_scam','ip','ncii_impersonation','other'));--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_clock_valid" CHECK ("ustaad_reports"."clock" in ('intimate_2h','legal_3h','removal_36h','standard_24h','grievance_7d'));--> statement-breakpoint
INSERT INTO public.ustaad_report_reasons (code, label_en, label_hi, default_clock) VALUES
  ('ncii_impersonation', 'Nude, fake or morphed picture of a person', 'किसी व्यक्ति की नग्न, नकली या बदली हुई तस्वीर', 'intimate_2h')
ON CONFLICT DO NOTHING;