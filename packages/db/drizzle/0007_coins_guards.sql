-- MechDost Coins guards (spec 20): the ledger is history, so it is append-only like order_events and audit_log,
-- and both coin tables follow the platform rule: RLS on, nothing for end-user roles (the API is the only writer).
CREATE TRIGGER coin_ledger_append_only BEFORE UPDATE OR DELETE ON public.coin_ledger
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint
ALTER TABLE public.coin_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.coin_accounts FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON public.coin_ledger FROM anon, authenticated;
