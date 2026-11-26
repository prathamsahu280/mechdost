-- G2 (spec 23 § 21g): report source `staff` for restrictions and bans a community manager starts from Members.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ustaad_reports" DROP CONSTRAINT "ustaad_reports_source_valid";--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_source_valid" CHECK ("ustaad_reports"."source" in ('member','auto_word','auto_scam','auto_safety','legal_order','grievance','staff'));
