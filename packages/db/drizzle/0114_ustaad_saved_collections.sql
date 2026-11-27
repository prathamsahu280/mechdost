CREATE TABLE "ustaad_save_collection_items" (
	"collection_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_save_collection_items_collection_id_kind_target_id_pk" PRIMARY KEY("collection_id","kind","target_id"),
	CONSTRAINT "ustaad_save_collection_items_kind_valid" CHECK ("ustaad_save_collection_items"."kind" in ('post','question','answer','job','lesson'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_save_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_save_collections_name_len" CHECK (char_length(btrim("ustaad_save_collections"."name")) between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "ustaad_saved_items" (
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_saved_items_member_id_kind_target_id_pk" PRIMARY KEY("member_id","kind","target_id"),
	CONSTRAINT "ustaad_saved_items_kind_valid" CHECK ("ustaad_saved_items"."kind" in ('question','answer','job','lesson'))
);
--> statement-breakpoint
ALTER TABLE "ustaad_save_collection_items" ADD CONSTRAINT "ustaad_save_collection_items_collection_id_ustaad_save_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."ustaad_save_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_save_collection_items" ADD CONSTRAINT "ustaad_save_collection_items_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_save_collections" ADD CONSTRAINT "ustaad_save_collections_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_saved_items" ADD CONSTRAINT "ustaad_saved_items_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_save_collection_items_member_id_kind_target_id_index" ON "ustaad_save_collection_items" USING btree ("member_id","kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_save_collections_member_name_uq" ON "ustaad_save_collections" USING btree ("member_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ustaad_saved_items_member_id_created_at_index" ON "ustaad_saved_items" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE public.ustaad_saved_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_saved_items FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE public.ustaad_save_collections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_save_collections FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE public.ustaad_save_collection_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_save_collection_items FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_save_collections_bump_version BEFORE UPDATE ON public.ustaad_save_collections
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_save_collections_touch_updated_at BEFORE UPDATE ON public.ustaad_save_collections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();