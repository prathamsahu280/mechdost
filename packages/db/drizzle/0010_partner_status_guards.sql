-- Partner standing history (decision 2026-11-01) is append-only like order_events, coin_ledger and audit_log, and
-- follows the platform rule: RLS on, nothing for end-user roles (the API is the only writer).
CREATE TRIGGER partner_status_events_append_only BEFORE UPDATE OR DELETE ON public.partner_status_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint
ALTER TABLE public.partner_status_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.partner_status_events FROM anon, authenticated;
