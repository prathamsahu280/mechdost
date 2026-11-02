-- Lost access ⇒ wipe that person's live-update inbox (security review follow-up, spec 10 "Live updates").
-- Queued in the same transaction as the access change; the relay deletes `inbox/{firebase_uid}` in Firebase.
CREATE OR REPLACE FUNCTION public.live_revoke(p_user uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.live_revocations (firebase_uid, reason)
  SELECT u.firebase_uid, p_reason FROM public.users u WHERE u.id = p_user;
  PERFORM pg_notify('live_outbox', '');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_user_deactivated() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    PERFORM public.live_revoke(NEW.id, 'deactivated');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_live_revoke AFTER UPDATE OF status ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.live_user_deactivated();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_shop_user_removed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_revoke(OLD.user_id, 'partner_removed');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shop_users_live_revoke AFTER DELETE ON public.shop_users
  FOR EACH ROW EXECUTE FUNCTION public.live_shop_user_removed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_role_revoked() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_revoke(OLD.user_id, 'role_revoked');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_roles_live_revoke AFTER DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.live_role_revoked();
--> statement-breakpoint
ALTER TABLE public.live_revocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.live_revocations FROM anon, authenticated;
--> statement-breakpoint
-- Not callable through the Supabase REST RPC endpoint.
REVOKE ALL ON FUNCTION public.live_revoke(uuid, text) FROM PUBLIC, anon, authenticated;
