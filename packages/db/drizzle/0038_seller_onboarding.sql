-- Seller onboarding (plan 2026-11-13 Task 2): invites, application fields, ticked products, price requests,
-- staff-blocked listings, the shop's GST status and the seller agreement.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "shop_price_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"requested_paise" bigint NOT NULL,
	"previous_paise" bigint,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"note" text,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_price_requests_status_valid" CHECK ("shop_price_requests"."status" in ('pending','approved','rejected','withdrawn','superseded')),
	CONSTRAINT "shop_price_requests_positive" CHECK ("shop_price_requests"."requested_paise" > 0),
	CONSTRAINT "shop_price_requests_on_hand_nonneg" CHECK ("shop_price_requests"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"text_en" text NOT NULL,
	"text_hi" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "agreement_versions_version_unique" UNIQUE("version"),
	CONSTRAINT "agreement_versions_positive" CHECK ("agreement_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_application_products" (
	"application_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "partner_application_products_application_id_product_id_pk" PRIMARY KEY("application_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "partner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_invites_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "partner_invites_status_valid" CHECK ("partner_invites"."status" in ('sent','used','expired','revoked')),
	CONSTRAINT "partner_invites_token_hash" CHECK ("partner_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "partner_invites_phone" CHECK ("partner_invites"."phone" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "shop_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_agreements_shopId_version_unique" UNIQUE("shop_id","version")
);
--> statement-breakpoint
ALTER TABLE "partner_applications" ALTER COLUMN "details" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_inventory" ADD COLUMN "admin_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_inventory" ADD COLUMN "blocked_reason_code" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "gst_status" text DEFAULT 'registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "email" "citext";--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "shop_name" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "shop_name_hi" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "gst_status" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "gstin_index" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "landmark" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "location" geography(Point,4326);--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "location_accuracy_m" integer;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "location_source" text;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "source" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "shop_price_requests" ADD CONSTRAINT "shop_price_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_price_requests" ADD CONSTRAINT "shop_price_requests_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_price_requests" ADD CONSTRAINT "shop_price_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_price_requests" ADD CONSTRAINT "shop_price_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_application_products" ADD CONSTRAINT "partner_application_products_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_application_products" ADD CONSTRAINT "partner_application_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_agreements" ADD CONSTRAINT "shop_agreements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_agreements" ADD CONSTRAINT "shop_agreements_version_agreement_versions_version_fk" FOREIGN KEY ("version") REFERENCES "public"."agreement_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_agreements" ADD CONSTRAINT "shop_agreements_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_price_requests_one_pending_uq" ON "shop_price_requests" USING btree ("shop_id","variant_id") WHERE "shop_price_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "shop_price_requests_status_created_at_index" ON "shop_price_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shop_price_requests_variant_id_index" ON "shop_price_requests" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "shop_price_requests_requested_by_index" ON "shop_price_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "shop_price_requests_decided_by_index" ON "shop_price_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "agreement_versions_created_by_index" ON "agreement_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "partner_application_products_product_id_index" ON "partner_application_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_invites_one_open_per_phone_uq" ON "partner_invites" USING btree ("phone") WHERE "partner_invites"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "partner_invites_created_by_index" ON "partner_invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "partner_invites_status_expires_at_index" ON "partner_invites" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "shop_agreements_version_index" ON "shop_agreements" USING btree ("version");--> statement-breakpoint
CREATE INDEX "shop_agreements_accepted_by_index" ON "shop_agreements" USING btree ("accepted_by");--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_invite_id_partner_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."partner_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_applications_gstin_index_index" ON "partner_applications" USING btree ("gstin_index");--> statement-breakpoint
CREATE INDEX "partner_applications_invite_id_index" ON "partner_applications" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "partner_applications_phone_index" ON "partner_applications" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "shop_inventory" ADD CONSTRAINT "shop_inventory_blocked_reason" CHECK (not "shop_inventory"."admin_blocked" or "shop_inventory"."blocked_reason_code" is not null);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_gst_status_valid" CHECK ("shops"."gst_status" in ('registered','enrolled'));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_source_valid" CHECK ("partner_applications"."source" in ('public','invite'));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_gst_status_valid" CHECK ("partner_applications"."gst_status" is null or "partner_applications"."gst_status" in ('registered','enrolled'));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_location_source_valid" CHECK ("partner_applications"."location_source" is null or "partner_applications"."location_source" in ('gps','search','pin'));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_accuracy_nonneg" CHECK ("partner_applications"."location_accuracy_m" is null or "partner_applications"."location_accuracy_m" >= 0);--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_seller_complete" CHECK ("partner_applications"."kind" <> 'seller' or ("partner_applications"."gst_status" is not null and "partner_applications"."address_line" is not null and "partner_applications"."location" is not null and "partner_applications"."location_source" is not null));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_details_for_others" CHECK ("partner_applications"."kind" = 'seller' or "partner_applications"."details" is not null);--> statement-breakpoint
-- Deny-all for the Data API (anon/authenticated); only the API role reads and writes these (spec 13).
ALTER TABLE public.partner_invites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.partner_application_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.shop_price_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agreement_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.shop_agreements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.partner_invites, public.partner_application_products, public.shop_price_requests, public.agreement_versions, public.shop_agreements FROM anon, authenticated;--> statement-breakpoint
-- Acceptances are history: never changed or removed.
CREATE TRIGGER shop_agreements_append_only BEFORE UPDATE OR DELETE ON public.shop_agreements
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- Version and updated_at triggers for the new mutable tables (same loop as 0031).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'version' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_bump_version')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
                   r.table_name || '_bump_version', r.table_name);
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_touch_updated_at')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   r.table_name || '_touch_updated_at', r.table_name);
  END LOOP;
END $$;
