-- Quote follow-ups (spec 19): photo attachments on quote messages (media_objects owner kind) and read receipts.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "quote_reads" (
	"quote_id" uuid NOT NULL,
	"side" text NOT NULL,
	"read_through_at" timestamp with time zone NOT NULL,
	"read_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_reads_quote_id_side_pk" PRIMARY KEY("quote_id","side"),
	CONSTRAINT "quote_reads_side_valid" CHECK ("quote_reads"."side" in ('customer','staff'))
);
--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_owner_kind_valid";--> statement-breakpoint
ALTER TABLE "quote_reads" ADD CONSTRAINT "quote_reads_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_reads" ADD CONSTRAINT "quote_reads_read_by_user_id_users_id_fk" FOREIGN KEY ("read_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_reads_read_by_user_id_index" ON "quote_reads" USING btree ("read_by_user_id");--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_kind_valid" CHECK ("media_objects"."owner_kind" in ('service_photo','ticket_message','product_photo','quote_message'));--> statement-breakpoint
-- Read receipts are server-side only: RLS on, client roles revoked (same as the other quote tables, 0049).
ALTER TABLE public.quote_reads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.quote_reads FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER quote_reads_bump_version BEFORE UPDATE ON public.quote_reads
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER quote_reads_touch_updated_at BEFORE UPDATE ON public.quote_reads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- A read marker moving pings the quote's topic, so "seen" appears on the other side without waiting for the poll.
CREATE OR REPLACE FUNCTION public.live_quote_read() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_enqueue('quote:' || NEW.quote_id, 'quote', NEW.quote_id, NEW.version, 'quote.read');
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER quote_reads_live AFTER INSERT OR UPDATE ON public.quote_reads
  FOR EACH ROW EXECUTE FUNCTION public.live_quote_read();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.live_quote_read() FROM PUBLIC, anon, authenticated;
