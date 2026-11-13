-- Buyer GSTIN at checkout (plan 2026-11-13): the existing, always-null order_groups.gstin / business_name get CHECKs.
-- Added NOT VALID (no full-table lock while scanning), then validated.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_gstin_format" CHECK ("order_groups"."gstin" is null or "order_groups"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') NOT VALID;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_business_pair" CHECK (("order_groups"."gstin" is null) = ("order_groups"."business_name" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_business_name_len" CHECK ("order_groups"."business_name" is null or char_length("order_groups"."business_name") between 2 and 120) NOT VALID;--> statement-breakpoint
ALTER TABLE "order_groups" VALIDATE CONSTRAINT "order_groups_gstin_format";--> statement-breakpoint
ALTER TABLE "order_groups" VALIDATE CONSTRAINT "order_groups_business_pair";--> statement-breakpoint
ALTER TABLE "order_groups" VALIDATE CONSTRAINT "order_groups_business_name_len";
