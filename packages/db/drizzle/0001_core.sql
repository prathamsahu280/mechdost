CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" uuid NOT NULL,
	"code" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"status" text DEFAULT 'coming_soon' NOT NULL,
	"centroid" geography(Point,4326),
	"radius_km" integer DEFAULT 25 NOT NULL,
	"launched_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_code_unique" UNIQUE("code"),
	CONSTRAINT "cities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "cities_code_format" CHECK ("cities"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cities_status_valid" CHECK ("cities"."status" in ('live','coming_soon','paused')),
	CONSTRAINT "cities_radius_positive" CHECK ("cities"."radius_km" > 0)
);
--> statement-breakpoint
CREATE TABLE "pincodes" (
	"pincode" text PRIMARY KEY NOT NULL,
	"state_id" uuid NOT NULL,
	"city_id" uuid,
	"district" text,
	"locality" text,
	"centroid" geography(Point,4326),
	"serviceable_parts" boolean DEFAULT false NOT NULL,
	"serviceable_doorstep" boolean DEFAULT false NOT NULL,
	"serviceable_pickup" boolean DEFAULT false NOT NULL,
	"cod_allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pincodes_format" CHECK ("pincodes"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"gst_state_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_code_unique" UNIQUE("code"),
	CONSTRAINT "states_gstStateCode_unique" UNIQUE("gst_state_code")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pincode" text NOT NULL,
	"phone" text NOT NULL,
	"interest" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_pincode_format" CHECK ("waitlist"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT 'home' NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"pincode" text NOT NULL,
	"city_id" uuid,
	"state_id" uuid NOT NULL,
	"location" geography(Point,4326),
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_label_valid" CHECK ("addresses"."label" in ('home','work','garage','other')),
	CONSTRAINT "addresses_contact_phone_e164" CHECK ("addresses"."contact_phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_purpose_valid" CHECK ("consents"."purpose" in ('account','marketing','analytics','location','share_with_partner','whatsapp'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_channel_category_pk" PRIMARY KEY("user_id","channel","category"),
	CONSTRAINT "notif_pref_channel_valid" CHECK ("notification_preferences"."channel" in ('inapp','email','sms','whatsapp','push')),
	CONSTRAINT "notif_pref_category_valid" CHECK ("notification_preferences"."category" in ('transactional','promotional','reminders','price_alerts'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_key_format" CHECK ("permissions"."key" ~ '^[a-z_]+:[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device" text,
	"ip_truncated" text,
	"city" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_security" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"city_id" uuid,
	"shop_id" uuid,
	"workshop_id" uuid,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_scope_uq" UNIQUE NULLS NOT DISTINCT("user_id","role_id","city_id","shop_id","workshop_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" text NOT NULL,
	"name" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"email" "citext",
	"email_verified_at" timestamp with time zone,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebaseUid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" is null or "users"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "users_language_valid" CHECK ("users"."language" in ('en','hi')),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active','deactivated','deleted'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_makes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_makes_name_unique" UNIQUE("name"),
	CONSTRAINT "vehicle_makes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_models_makeId_name_unique" UNIQUE("make_id","name"),
	CONSTRAINT "vehicle_models_type_valid" CHECK ("vehicle_models"."vehicle_type" in ('2W','3W','4W'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fuel" text NOT NULL,
	"year_from" smallint NOT NULL,
	"year_to" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_variants_modelId_name_fuel_yearFrom_unique" UNIQUE("model_id","name","fuel","year_from"),
	CONSTRAINT "vehicle_variants_fuel_valid" CHECK ("vehicle_variants"."fuel" in ('petrol','diesel','cng_lpg','hybrid','electric')),
	CONSTRAINT "vehicle_variants_years" CHECK ("vehicle_variants"."year_to" is null or "vehicle_variants"."year_to" >= "vehicle_variants"."year_from")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_variant_id" uuid,
	"type" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"year" smallint,
	"fuel" text NOT NULL,
	"registration" text,
	"odometer_km" integer,
	"last_service_km" integer,
	"last_service_at" timestamp with time zone,
	"insurance" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_type_valid" CHECK ("vehicles"."type" in ('2W','3W','4W')),
	CONSTRAINT "vehicles_fuel_valid" CHECK ("vehicles"."fuel" in ('petrol','diesel','cng_lpg','hybrid','electric')),
	CONSTRAINT "vehicles_odometer_nonneg" CHECK ("vehicles"."odometer_km" is null or "vehicles"."odometer_km" >= 0),
	CONSTRAINT "vehicles_service_km_le_odometer" CHECK ("vehicles"."last_service_km" is null or "vehicles"."odometer_km" is null or "vehicles"."last_service_km" <= "vehicles"."odometer_km")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"origin" text DEFAULT 'aftermarket' NOT NULL,
	"logo_path" text,
	"featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brands_origin_valid" CHECK ("brands"."origin" in ('oem','oes','aftermarket'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"description" text,
	"description_hi" text,
	"icon" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "fitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"vehicle_variant_id" uuid NOT NULL,
	"year_from" smallint,
	"year_to" smallint,
	"notes" text,
	CONSTRAINT "fitments_variantId_vehicleVariantId_unique" UNIQUE("variant_id","vehicle_variant_id"),
	CONSTRAINT "fitments_years" CHECK ("fitments"."year_to" is null or "fitments"."year_from" is null or "fitments"."year_to" >= "fitments"."year_from")
);
--> statement-breakpoint
CREATE TABLE "part_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalised" text NOT NULL,
	CONSTRAINT "part_numbers_kind_normalised_variantId_unique" UNIQUE("kind","normalised","variant_id"),
	CONSTRAINT "part_numbers_kind_valid" CHECK ("part_numbers"."kind" in ('oe','mfr','xref')),
	CONSTRAINT "part_numbers_normalised_format" CHECK ("part_numbers"."normalised" ~ '^[A-Z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "product_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"storage_path" text NOT NULL,
	"alt" text NOT NULL,
	"alt_hi" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"blurhash" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"barcode" text,
	"mrp_paise" bigint NOT NULL,
	"weight_g" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_variants_mrp_nonneg" CHECK ("product_variants"."mrp_paise" >= 0),
	CONSTRAINT "product_variants_status_valid" CHECK ("product_variants"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"brand_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text,
	"description_hi" text,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hsn" text NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"country_of_origin" text DEFAULT 'India' NOT NULL,
	"warranty" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_by_shop_id" uuid,
	"rejection_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_status_valid" CHECK ("products"."status" in ('draft','submitted','live','rejected','archived')),
	CONSTRAINT "products_hsn_format" CHECK ("products"."hsn" ~ '^[0-9]{4,8}$'),
	CONSTRAINT "products_gst_rate_range" CHECK ("products"."gst_rate_bp" between 0 and 4000)
);
--> statement-breakpoint
CREATE TABLE "shop_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"selling_paise" bigint NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"lead_days" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_inventory_shopId_variantId_unique" UNIQUE("shop_id","variant_id"),
	CONSTRAINT "shop_inventory_selling_positive" CHECK ("shop_inventory"."selling_paise" > 0),
	CONSTRAINT "shop_inventory_on_hand_nonneg" CHECK ("shop_inventory"."on_hand" >= 0),
	CONSTRAINT "shop_inventory_reserved_nonneg" CHECK ("shop_inventory"."reserved" >= 0),
	CONSTRAINT "shop_inventory_available_nonneg" CHECK ("shop_inventory"."on_hand" - "shop_inventory"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_pincodes" (
	"shop_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"shipping_paise" bigint DEFAULT 0 NOT NULL,
	"lead_days" smallint DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shop_pincodes_shop_id_pincode_pk" PRIMARY KEY("shop_id","pincode"),
	CONSTRAINT "shop_pincodes_shipping_nonneg" CHECK ("shop_pincodes"."shipping_paise" >= 0),
	CONSTRAINT "shop_pincodes_lead_days" CHECK ("shop_pincodes"."lead_days" between 0 and 60)
);
--> statement-breakpoint
CREATE TABLE "shop_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_users_shopId_userId_unique" UNIQUE("shop_id","user_id"),
	CONSTRAINT "shop_users_role_valid" CHECK ("shop_users"."role" in ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"pan" text,
	"phone" text NOT NULL,
	"email" text,
	"address_line" text NOT NULL,
	"pincode" text NOT NULL,
	"city_id" uuid NOT NULL,
	"state_id" uuid NOT NULL,
	"location" geography(Point,4326),
	"status" text DEFAULT 'pending' NOT NULL,
	"busy" boolean DEFAULT false NOT NULL,
	"busy_until" timestamp with time zone,
	"acceptance_timeout_min" integer,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_status_valid" CHECK ("shops"."status" in ('pending','approved','suspended')),
	CONSTRAINT "shops_gstin_format" CHECK ("shops"."gstin" is null or "shops"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "shops_timeout_positive" CHECK ("shops"."acceptance_timeout_min" is null or "shops"."acceptance_timeout_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"discount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_couponId_groupId_unique" UNIQUE("coupon_id","group_id"),
	CONSTRAINT "coupon_redemptions_discount_nonneg" CHECK ("coupon_redemptions"."discount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "citext" NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"max_discount_paise" bigint,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"usage_limit_total" integer,
	"usage_limit_per_user" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"city_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_kind_valid" CHECK ("coupons"."kind" in ('percent','flat','free_shipping')),
	CONSTRAINT "coupons_value_range" CHECK (("coupons"."kind" <> 'percent' or "coupons"."value" between 1 and 100) and "coupons"."value" >= 0),
	CONSTRAINT "coupons_window" CHECK ("coupons"."ends_at" is null or "coupons"."ends_at" > "coupons"."starts_at"),
	CONSTRAINT "coupons_usage_within_limit" CHECK ("coupons"."used_count" >= 0 and ("coupons"."usage_limit_total" is null or "coupons"."used_count" <= "coupons"."usage_limit_total"))
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"series" text NOT NULL,
	"fy" text NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_counters_series_fy_pk" PRIMARY KEY("series","fy"),
	CONSTRAINT "invoice_counters_last_nonneg" CHECK ("invoice_counters"."last" >= 0),
	CONSTRAINT "invoice_counters_fy_format" CHECK ("invoice_counters"."fy" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"series" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid,
	"service_request_id" uuid,
	"credit_note_for" uuid,
	"status" text DEFAULT 'issued' NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"pdf_path" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_series_fy_seq_unique" UNIQUE("series","fy","seq"),
	CONSTRAINT "invoices_kind_valid" CHECK ("invoices"."kind" in ('tax_invoice','credit_note','service_bill')),
	CONSTRAINT "invoices_status_valid" CHECK ("invoices"."status" in ('issued','cancelled')),
	CONSTRAINT "invoices_number_rule46" CHECK (length("invoices"."number") <= 16 and "invoices"."number" ~ '^[A-Z0-9][A-Z0-9/-]*$'),
	CONSTRAINT "invoices_seq_positive" CHECK ("invoices"."seq" > 0),
	CONSTRAINT "invoices_round_off_range" CHECK ("invoices"."round_off_paise" between -50 and 50)
);
--> statement-breakpoint
CREATE TABLE "order_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"offered_by" uuid,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "order_assignments_status_valid" CHECK ("order_assignments"."status" in ('offered','accepted','declined','expired','withdrawn')),
	CONSTRAINT "order_assignments_expiry_after_offer" CHECK ("order_assignments"."expires_at" > "order_assignments"."offered_at"),
	CONSTRAINT "order_assignments_decline_reason" CHECK ("order_assignments"."status" <> 'declined' or ("order_assignments"."decline_reason" is not null and length("order_assignments"."decline_reason") > 0))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"visible_to_customer" boolean DEFAULT true NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_actor_valid" CHECK ("order_events"."actor_type" in ('customer','shop','workshop','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "order_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text DEFAULT 'created' NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"shipping_paise" bigint DEFAULT 0 NOT NULL,
	"cod_fee_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"coupon_id" uuid,
	"gstin" text,
	"business_name" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_groups_code_unique" UNIQUE("code"),
	CONSTRAINT "order_groups_idempotency_uq" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "order_groups_code_format" CHECK ("order_groups"."code" ~ '^MD-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "order_groups_payment_method_valid" CHECK ("order_groups"."payment_method" in ('online','cod')),
	CONSTRAINT "order_groups_payment_status_valid" CHECK ("order_groups"."payment_status" in ('created','attempted','failed','paid','partially_refunded','refunded','expired','cod_pending','cod_collected')),
	CONSTRAINT "order_groups_amounts_nonneg" CHECK ("order_groups"."subtotal_paise" >= 0 and "order_groups"."discount_paise" >= 0 and "order_groups"."shipping_paise" >= 0 and "order_groups"."cod_fee_paise" >= 0 and "order_groups"."total_paise" >= 0),
	CONSTRAINT "order_groups_total_consistent" CHECK ("order_groups"."total_paise" = "order_groups"."subtotal_paise" - "order_groups"."discount_paise" + "order_groups"."shipping_paise" + "order_groups"."cod_fee_paise")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sku" text NOT NULL,
	"hsn" text NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"unit_paise" bigint NOT NULL,
	"qty" integer NOT NULL,
	"line_discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"reco_source" text,
	CONSTRAINT "order_items_qty_positive" CHECK ("order_items"."qty" > 0 and "order_items"."qty" <= 99),
	CONSTRAINT "order_items_cgst_equals_sgst" CHECK ("order_items"."cgst_paise" = "order_items"."sgst_paise"),
	CONSTRAINT "order_items_intra_or_inter" CHECK ("order_items"."igst_paise" = 0 or "order_items"."cgst_paise" = 0),
	CONSTRAINT "order_items_total_consistent" CHECK ("order_items"."total_paise" = "order_items"."taxable_paise" + "order_items"."cgst_paise" + "order_items"."sgst_paise" + "order_items"."igst_paise"),
	CONSTRAINT "order_items_amounts_nonneg" CHECK ("order_items"."unit_paise" >= 0 and "order_items"."line_discount_paise" >= 0 and "order_items"."taxable_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"sub_no" smallint NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"suggested_shop_id" uuid,
	"shop_id" uuid,
	"shipping_address" jsonb NOT NULL,
	"pincode" text NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"shipping_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"cancellable_until_status" text DEFAULT 'confirmed' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_unique" UNIQUE("code"),
	CONSTRAINT "orders_groupId_subNo_unique" UNIQUE("group_id","sub_no"),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('placed','awaiting_shop','needs_rerouting','confirmed','packed','shipped','out_for_delivery','delivered','cancelled','rejected')),
	CONSTRAINT "orders_sub_no_positive" CHECK ("orders"."sub_no" > 0),
	CONSTRAINT "orders_amounts_nonneg" CHECK ("orders"."subtotal_paise" >= 0 and "orders"."total_paise" >= 0 and "orders"."tax_paise" >= 0),
	CONSTRAINT "orders_shop_when_confirmed" CHECK ("orders"."status" in ('placed','awaiting_shop','needs_rerouting','cancelled','rejected') or "orders"."shop_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"method" text,
	"captured_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_providerOrderId_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_providerPaymentId_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('created','attempted','failed','paid','partially_refunded','refunded','expired')),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_currency_inr" CHECK ("payments"."currency" = 'INR'),
	CONSTRAINT "payments_provider_valid" CHECK ("payments"."provider" in ('razorpay'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid,
	"amount_paise" bigint NOT NULL,
	"mode" text DEFAULT 'source' NOT NULL,
	"idem_key" text NOT NULL,
	"provider_refund_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_idemKey_unique" UNIQUE("idem_key"),
	CONSTRAINT "refunds_providerRefundId_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_mode_valid" CHECK ("refunds"."mode" in ('source','wallet','bank_upi')),
	CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('pending','initiated','processed','failed')),
	CONSTRAINT "refunds_idem_key_format" CHECK ("refunds"."idem_key" ~ '^[A-Za-z0-9_-]{10,64}$')
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"inventory_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_qty_positive" CHECK ("reservations"."qty" > 0),
	CONSTRAINT "reservations_status_valid" CHECK ("reservations"."status" in ('active','committed','released','expired')),
	CONSTRAINT "reservations_expiry_after_create" CHECK ("reservations"."expires_at" > "reservations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"courier" text,
	"awb" text,
	"status" text DEFAULT 'created' NOT NULL,
	"proof_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_courier_awb_unique" UNIQUE("courier","awb"),
	CONSTRAINT "shipments_mode_valid" CHECK ("shipments"."mode" in ('own','courier')),
	CONSTRAINT "shipments_courier_awb" CHECK ("shipments"."mode" = 'own' or ("shipments"."courier" is not null and "shipments"."awb" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"actor_role" text,
	"ip_truncated" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"city_id" uuid,
	"value" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_blocks_scope_uq" UNIQUE NULLS NOT DISTINCT("key","locale","city_id","status"),
	CONSTRAINT "content_blocks_locale_valid" CHECK ("content_blocks"."locale" in ('en','hi')),
	CONSTRAINT "content_blocks_status_valid" CHECK ("content_blocks"."status" in ('draft','published'))
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"locked_at" timestamp with time zone,
	"recovery_point" text DEFAULT 'started' NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idempotency_keys_key_format" CHECK ("idempotency_keys"."key" ~ '^[A-Za-z0-9_-]{16,128}$')
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_user_id" uuid,
	"recipient" text,
	"template_key" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_dedupeKey_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_channel_valid" CHECK ("notification_outbox"."channel" in ('inapp','email','sms','whatsapp','push')),
	CONSTRAINT "outbox_status_valid" CHECK ("notification_outbox"."status" in ('pending','sent','failed','cancelled','suppressed')),
	CONSTRAINT "outbox_locale_valid" CHECK ("notification_outbox"."locale" in ('en','hi'))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"dlt_template_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_key_channel_locale_pk" PRIMARY KEY("key","channel","locale"),
	CONSTRAINT "templates_locale_valid" CHECK ("notification_templates"."locale" in ('en','hi'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"business" text,
	"pincode" text NOT NULL,
	"details" text NOT NULL,
	"kyc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"converted_shop_id" uuid,
	"converted_workshop_id" uuid,
	"reviewed_by" uuid,
	"review_note" text,
	"consent_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_applications_code_unique" UNIQUE("code"),
	CONSTRAINT "partner_applications_kind_valid" CHECK ("partner_applications"."kind" in ('seller','garage','mechanic')),
	CONSTRAINT "partner_applications_status_valid" CHECK ("partner_applications"."status" in ('new','in_review','approved','rejected')),
	CONSTRAINT "partner_applications_pincode" CHECK ("partner_applications"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "processed_jobs" (
	"job_key" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"service_request_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reply" text,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_one_per_purchase_uq" UNIQUE NULLS NOT DISTINCT("user_id","order_id","service_request_id","target_type","target_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_target_valid" CHECK ("reviews"."target_type" in ('product','shop','workshop')),
	CONSTRAINT "reviews_status_valid" CHECK ("reviews"."status" in ('pending','approved','hidden')),
	CONSTRAINT "reviews_verified" CHECK ("reviews"."order_id" is not null or "reviews"."service_request_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_scope_key_uq" UNIQUE NULLS NOT DISTINCT("city_id","key")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid,
	"guest_name" text,
	"guest_phone" text,
	"access_key_hash" text,
	"kind" text NOT NULL,
	"order_id" uuid,
	"service_request_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"sla_ack_due" timestamp with time zone NOT NULL,
	"sla_resolve_due" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_code_unique" UNIQUE("code"),
	CONSTRAINT "support_tickets_status_valid" CHECK ("support_tickets"."status" in ('open','in_review','awaiting_customer','resolved','closed')),
	CONSTRAINT "support_tickets_priority_valid" CHECK ("support_tickets"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "support_tickets_kind_valid" CHECK ("support_tickets"."kind" in ('order_issue','service_issue','refund','fitment','product_sourcing','workshop_request','account','deletion_request','other')),
	CONSTRAINT "support_tickets_owner" CHECK ("support_tickets"."user_id" is not null or ("support_tickets"."guest_phone" is not null and "support_tickets"."access_key_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_messages_role_valid" CHECK ("ticket_messages"."author_role" in ('customer','guest','staff','system')),
	CONSTRAINT "ticket_messages_body_len" CHECK (length("ticket_messages"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_status_valid" CHECK ("webhook_events"."status" in ('received','processed','parked','failed'))
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_security" ADD CONSTRAINT "staff_security_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_variants" ADD CONSTRAINT "vehicle_variants_model_id_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicle_variant_id_vehicle_variants_id_fk" FOREIGN KEY ("vehicle_variant_id") REFERENCES "public"."vehicle_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitments" ADD CONSTRAINT "fitments_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitments" ADD CONSTRAINT "fitments_vehicle_variant_id_vehicle_variants_id_fk" FOREIGN KEY ("vehicle_variant_id") REFERENCES "public"."vehicle_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_numbers" ADD CONSTRAINT "part_numbers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_submitted_by_shop_id_shops_id_fk" FOREIGN KEY ("submitted_by_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_inventory" ADD CONSTRAINT "shop_inventory_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_inventory" ADD CONSTRAINT "shop_inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_pincodes" ADD CONSTRAINT "shop_pincodes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_pincodes" ADD CONSTRAINT "shop_pincodes_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_suggested_shop_id_shops_id_fk" FOREIGN KEY ("suggested_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_inventory_id_shop_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."shop_inventory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_converted_shop_id_shops_id_fk" FOREIGN KEY ("converted_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cities_state_id_index" ON "cities" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "pincodes_city_id_index" ON "pincodes" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "pincodes_state_id_index" ON "pincodes" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "waitlist_pincode_index" ON "waitlist" USING btree ("pincode");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default_shipping_uq" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default_shipping" and "addresses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default_billing_uq" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default_billing" and "addresses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "addresses_user_id_index" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "addresses_pincode_index" ON "addresses" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "addresses_city_id_index" ON "addresses" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "addresses_state_id_index" ON "addresses" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "consents_user_id_purpose_created_at_index" ON "consents" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_key_index" ON "role_permissions" USING btree ("permission_key");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_id_index" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_city_id_index" ON "user_roles" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "user_roles_shop_id_index" ON "user_roles" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "user_roles_workshop_id_index" ON "user_roles" USING btree ("workshop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_active_uq" ON "users" USING btree ("phone") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uq" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_one_primary_uq" ON "vehicles" USING btree ("user_id") WHERE "vehicles"."is_primary" and "vehicles"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration_uq" ON "vehicles" USING btree ("user_id",upper("registration")) WHERE "vehicles"."registration" is not null and "vehicles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "vehicles_user_id_index" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicles_vehicle_variant_id_index" ON "vehicles" USING btree ("vehicle_variant_id");--> statement-breakpoint
CREATE INDEX "categories_parent_id_index" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "fitments_vehicle_variant_id_index" ON "fitments" USING btree ("vehicle_variant_id");--> statement-breakpoint
CREATE INDEX "part_numbers_normalised_index" ON "part_numbers" USING btree ("normalised");--> statement-breakpoint
CREATE INDEX "part_numbers_variant_id_index" ON "part_numbers" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "product_photos_product_id_sort_index" ON "product_photos" USING btree ("product_id","sort");--> statement-breakpoint
CREATE INDEX "product_photos_variant_id_index" ON "product_photos" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_id_index" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_barcode_index" ON "product_variants" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "products_category_id_status_index" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_brand_id_index" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_submitted_by_shop_id_index" ON "products" USING btree ("submitted_by_shop_id");--> statement-breakpoint
CREATE INDEX "shop_inventory_variant_id_active_index" ON "shop_inventory" USING btree ("variant_id","active");--> statement-breakpoint
CREATE INDEX "shop_pincodes_pincode_index" ON "shop_pincodes" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "shop_users_user_id_index" ON "shop_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shops_city_id_status_index" ON "shops" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "shops_pincode_index" ON "shops" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "shops_state_id_index" ON "shops" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_user_id_coupon_id_index" ON "coupon_redemptions" USING btree ("user_id","coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_group_id_index" ON "coupon_redemptions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "coupons_city_id_index" ON "coupons" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "invoices_order_id_index" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_service_request_id_index" ON "invoices" USING btree ("service_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_assignments_one_active_uq" ON "order_assignments" USING btree ("order_id") WHERE "order_assignments"."status" in ('offered','accepted');--> statement-breakpoint
CREATE INDEX "order_assignments_expiring_idx" ON "order_assignments" USING btree ("expires_at") WHERE "order_assignments"."status" = 'offered';--> statement-breakpoint
CREATE INDEX "order_assignments_shop_id_status_index" ON "order_assignments" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "order_assignments_offered_by_index" ON "order_assignments" USING btree ("offered_by");--> statement-breakpoint
CREATE INDEX "order_events_order_id_id_index" ON "order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "order_groups_user_id_created_at_index" ON "order_groups" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_groups_city_id_created_at_index" ON "order_groups" USING btree ("city_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_index" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_index" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_status_city_id_placed_at_index" ON "orders" USING btree ("status","city_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_shop_id_status_index" ON "orders" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_user_id_placed_at_index" ON "orders" USING btree ("user_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_suggested_shop_id_index" ON "orders" USING btree ("suggested_shop_id");--> statement-breakpoint
CREATE INDEX "orders_city_id_index" ON "orders" USING btree ("city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_success_per_group_uq" ON "payments" USING btree ("group_id") WHERE "payments"."status" in ('paid','partially_refunded','refunded');--> statement-breakpoint
CREATE INDEX "payments_group_id_index" ON "payments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_index" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_order_id_index" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_requested_by_index" ON "refunds" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "refunds_approved_by_index" ON "refunds" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "reservations_active_expiry_idx" ON "reservations" USING btree ("expires_at") WHERE "reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_order_id_index" ON "reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservations_inventory_id_index" ON "reservations" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "shipments_order_id_index" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_entity_id_created_at_index" ON "audit_log" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_created_at_index" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "content_blocks_updated_by_index" ON "content_blocks" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_index" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "notification_outbox" USING btree ("created_at") WHERE "notification_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_outbox_recipient_user_id_index" ON "notification_outbox" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_templates_updated_by_index" ON "notification_templates" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_index" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "partner_applications_status_created_at_index" ON "partner_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "partner_applications_converted_shop_id_index" ON "partner_applications" USING btree ("converted_shop_id");--> statement-breakpoint
CREATE INDEX "partner_applications_reviewed_by_index" ON "partner_applications" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "reviews_target_type_target_id_status_index" ON "reviews" USING btree ("target_type","target_id","status");--> statement-breakpoint
CREATE INDEX "reviews_order_id_index" ON "reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reviews_moderated_by_index" ON "reviews" USING btree ("moderated_by");--> statement-breakpoint
CREATE INDEX "settings_updated_by_index" ON "settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "support_tickets_status_sla_ack_due_index" ON "support_tickets" USING btree ("status","sla_ack_due");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_index" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_order_id_index" ON "support_tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_id_index" ON "support_tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_id_created_at_index" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_author_user_id_index" ON "ticket_messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."status" in ('received','parked');