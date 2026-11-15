-- Shop staff invites (2026-11-15). A new table: no existing rows, no lock on live tables.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "shop_staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_staff_invites_status_valid" CHECK ("shop_staff_invites"."status" in ('sent','used','expired','revoked')),
	CONSTRAINT "shop_staff_invites_phone" CHECK ("shop_staff_invites"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "shop_staff_invites_name" CHECK (char_length("shop_staff_invites"."name") between 2 and 60),
	CONSTRAINT "shop_staff_invites_used_has_user" CHECK ("shop_staff_invites"."status" <> 'used' or ("shop_staff_invites"."used_at" is not null and "shop_staff_invites"."used_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "shop_staff_invites" ADD CONSTRAINT "shop_staff_invites_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_staff_invites" ADD CONSTRAINT "shop_staff_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_staff_invites" ADD CONSTRAINT "shop_staff_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_staff_invites_one_open_uq" ON "shop_staff_invites" USING btree ("shop_id","phone") WHERE "shop_staff_invites"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "shop_staff_invites_open_phone_idx" ON "shop_staff_invites" USING btree ("phone") WHERE "shop_staff_invites"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "shop_staff_invites_created_by_index" ON "shop_staff_invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "shop_staff_invites_used_by_index" ON "shop_staff_invites" USING btree ("used_by");--> statement-breakpoint
-- RLS on, no direct client access (the API connects as owner), version + updated_at triggers (spec 14).
ALTER TABLE public.shop_staff_invites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.shop_staff_invites FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER shop_staff_invites_bump_version BEFORE UPDATE ON public.shop_staff_invites
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER shop_staff_invites_touch_updated_at BEFORE UPDATE ON public.shop_staff_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();