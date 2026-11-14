-- Email templates (2026-11-15): admin-editable heading and button label next to subject and body. Tiny table.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "button_label" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "templates_heading_len" CHECK ("notification_templates"."heading" is null or char_length("notification_templates"."heading") <= 120);--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "templates_button_label_len" CHECK ("notification_templates"."button_label" is null or char_length("notification_templates"."button_label") <= 40);