ALTER TABLE "shops" ADD COLUMN "pan_enc" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "pan_index" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_enc" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "kyc_enc" text;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_panIndex_unique" UNIQUE("pan_index");--> statement-breakpoint
ALTER TABLE "staff_security" ADD CONSTRAINT "staff_security_totp_encrypted" CHECK ("staff_security"."totp_secret_enc" is null or "staff_security"."totp_secret_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_pan_encrypted" CHECK ("shops"."pan_enc" is null or "shops"."pan_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_destination_encrypted" CHECK ("refunds"."destination_enc" is null or "refunds"."destination_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bank_upi_needs_destination" CHECK ("refunds"."mode" <> 'bank_upi' or "refunds"."destination_enc" is not null);--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_kyc_encrypted" CHECK ("partner_applications"."kyc_enc" is null or "partner_applications"."kyc_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');