CREATE TABLE "ustaad_daily_counters" (
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_daily_counters_member_id_kind_day_pk" PRIMARY KEY("member_id","kind","day"),
	CONSTRAINT "ustaad_daily_counters_kind_valid" CHECK ("ustaad_daily_counters"."kind" in ('promo_served','profiles_served','follows','new_threads','connect_requests')),
	CONSTRAINT "ustaad_daily_counters_n" CHECK ("ustaad_daily_counters"."n" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_promo_hides" (
	"member_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_promo_hides_member_id_promotion_id_pk" PRIMARY KEY("member_id","promotion_id"),
	CONSTRAINT "ustaad_promo_hides_reason_valid" CHECK ("ustaad_promo_hides"."reason_code" in ('not_relevant','seen_too_often','misleading','other'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_thread_members" (
	"thread_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_thread_members_thread_id_member_id_pk" PRIMARY KEY("thread_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD COLUMN "held_reason_code" text;--> statement-breakpoint
ALTER TABLE "ustaad_threads" ADD COLUMN "blocked_from" text;--> statement-breakpoint
ALTER TABLE "ustaad_daily_counters" ADD CONSTRAINT "ustaad_daily_counters_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_promo_hides" ADD CONSTRAINT "ustaad_promo_hides_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_promo_hides" ADD CONSTRAINT "ustaad_promo_hides_promotion_id_ustaad_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."ustaad_promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_thread_members" ADD CONSTRAINT "ustaad_thread_members_thread_id_ustaad_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ustaad_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_thread_members" ADD CONSTRAINT "ustaad_thread_members_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_daily_counters_day_index" ON "ustaad_daily_counters" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ustaad_promo_hides_promotion_id_index" ON "ustaad_promo_hides" USING btree ("promotion_id");--> statement-breakpoint
CREATE INDEX "ustaad_thread_members_member_id_index" ON "ustaad_thread_members" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD CONSTRAINT "ustaad_messages_held_reason_valid" CHECK ("ustaad_messages"."held_reason_code" is null or "ustaad_messages"."held_reason_code" in ('screened','scam_phrase'));--> statement-breakpoint
ALTER TABLE "ustaad_threads" ADD CONSTRAINT "ustaad_threads_blocked_from_valid" CHECK (("ustaad_threads"."status" = 'blocked') = ("ustaad_threads"."blocked_from" is not null) and ("ustaad_threads"."blocked_from" is null or "ustaad_threads"."blocked_from" in ('requested','open','declined')));--> statement-breakpoint
ALTER TABLE public.ustaad_daily_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_promo_hides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_thread_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_daily_counters, public.ustaad_promo_hides, public.ustaad_thread_members FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_daily_counters_touch_updated_at BEFORE UPDATE ON public.ustaad_daily_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_thread_members_touch_updated_at BEFORE UPDATE ON public.ustaad_thread_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();