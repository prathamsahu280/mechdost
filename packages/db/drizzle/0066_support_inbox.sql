-- Support inbox tools, auto-close, guest tickets, account deletion requests (design 2026-11-15 items 4 to 7).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "canned_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"body_en" text NOT NULL,
	"body_hi" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canned_replies_key_unique" UNIQUE("key"),
	CONSTRAINT "canned_replies_key_valid" CHECK ("canned_replies"."key" ~ '^[a-z][a-z0-9_]{2,39}$'),
	CONSTRAINT "canned_replies_title_len" CHECK (length("canned_replies"."title_en") between 1 and 80 and length("canned_replies"."title_hi") between 1 and 80),
	CONSTRAINT "canned_replies_body_len" CHECK (length("canned_replies"."body_en") between 1 and 2000 and length("canned_replies"."body_hi") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "deletion_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "deletion_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "canned_replies" ADD CONSTRAINT "canned_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canned_replies_active_sort_order_index" ON "canned_replies" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "canned_replies_created_by_index" ON "canned_replies" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_deletion_confirmed_by_users_id_fk" FOREIGN KEY ("deletion_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_one_deletion_uq" ON "support_tickets" USING btree ("user_id") WHERE "support_tickets"."kind" = 'deletion_request' and "support_tickets"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "support_tickets_auto_close_idx" ON "support_tickets" USING btree ("resolved_at") WHERE "support_tickets"."status" = 'resolved';--> statement-breakpoint
CREATE INDEX "support_tickets_deletion_confirmed_by_index" ON "support_tickets" USING btree ("deletion_confirmed_by");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_close_reason_valid" CHECK ("support_tickets"."close_reason" is null or "support_tickets"."close_reason" in ('auto','staff'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_deletion_confirm_kind" CHECK ("support_tickets"."deletion_confirmed_at" is null or "support_tickets"."kind" = 'deletion_request');--> statement-breakpoint
-- RLS on, no direct client access (the API connects as owner), version + updated_at triggers (spec 14).
ALTER TABLE public.canned_replies ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.canned_replies FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER canned_replies_bump_version BEFORE UPDATE ON public.canned_replies
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER canned_replies_touch_updated_at BEFORE UPDATE ON public.canned_replies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- Requests answered before this migration: the first public staff message is their first reply.
UPDATE public.support_tickets t SET first_replied_at = m.first_at
FROM (SELECT ticket_id, min(created_at) AS first_at FROM public.ticket_messages
      WHERE author_role = 'staff' AND internal = false GROUP BY ticket_id) m
WHERE m.ticket_id = t.id AND t.first_replied_at IS NULL;--> statement-breakpoint
-- Starter canned replies (English and Hindi); the admin edits or switches them off in the console.
INSERT INTO public.canned_replies (key, title_en, title_hi, body_en, body_hi, sort_order) VALUES
('looking_into_it', 'Looking into it', 'जाँच कर रहे हैं',
 'Thank you for writing to MechDost. We are looking into this and will update you here shortly.',
 'MechDost को लिखने के लिए धन्यवाद। हम इसकी जाँच कर रहे हैं और जल्द ही यहीं आपको बताएँगे।', 10),
('need_photos', 'Please send photos', 'कृपया फ़ोटो भेजें',
 'Could you please attach clear photos of the item and its packaging? This helps us sort it out quickly.',
 'कृपया सामान और उसकी पैकिंग की साफ़ फ़ोटो जोड़ें। इससे हम इसे जल्दी सुलझा पाएँगे।', 20),
('replacement_arranged', 'Replacement arranged', 'बदलकर भेज रहे हैं',
 'We are sorry for the trouble. We have arranged a replacement and will share the delivery update here.',
 'असुविधा के लिए खेद है। हमने बदली हुई वस्तु भेजने की व्यवस्था कर दी है और डिलीवरी की जानकारी यहीं देंगे।', 30),
('refund_started', 'Refund started', 'रिफ़ंड शुरू हो गया',
 'We have started your refund. It goes back to the original payment method (or to the UPI or bank account you gave for cash on delivery).',
 'हमने आपका रिफ़ंड शुरू कर दिया है। यह मूल भुगतान तरीके में (या कैश ऑन डिलीवरी के लिए आपके दिए UPI या बैंक खाते में) वापस जाएगा।', 40),
('resolved_check', 'Marking as resolved', 'समाधान हो गया',
 'We believe this is sorted, so we are marking it resolved. If something is still wrong, reply here within 7 days and we will reopen it.',
 'हमारे अनुसार यह सुलझ गया है, इसलिए इसे हल मान रहे हैं। कुछ और बाक़ी हो तो 7 दिन के भीतर यहीं जवाब दें, हम इसे फिर खोल देंगे।', 50)
ON CONFLICT (key) DO NOTHING;
