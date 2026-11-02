-- Security review 2026-11-03: every way access can end must wipe live-update signals, not only deletes.
-- Whole inbox: role/scope changed, shop membership moved, a permission removed from a role, Firebase uid changed.
-- One node: a shop's offer on an order ended (declined / expired / withdrawn) — remove that order's and that
-- assignment's ping from the shop's people, keeping the rest of their inbox.
CREATE OR REPLACE FUNCTION public.live_revoke_node(p_user uuid, p_reason text, p_node text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.live_revocations (firebase_uid, reason, node)
  SELECT u.firebase_uid, p_reason, p_node FROM public.users u WHERE u.id = p_user;
  PERFORM pg_notify('live_outbox', '');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_role_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (OLD.role_id, OLD.city_id, OLD.shop_id, OLD.workshop_id, OLD.user_id)
     IS DISTINCT FROM (NEW.role_id, NEW.city_id, NEW.shop_id, NEW.workshop_id, NEW.user_id) THEN
    PERFORM public.live_revoke(OLD.user_id, 'role_changed');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_roles_live_changed AFTER UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.live_role_changed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_shop_user_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (OLD.shop_id, OLD.user_id) IS DISTINCT FROM (NEW.shop_id, NEW.user_id) THEN
    PERFORM public.live_revoke(OLD.user_id, 'partner_removed');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shop_users_live_changed AFTER UPDATE ON public.shop_users
  FOR EACH ROW EXECUTE FUNCTION public.live_shop_user_changed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_uid_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.firebase_uid IS DISTINCT FROM NEW.firebase_uid THEN
    INSERT INTO public.live_revocations (firebase_uid, reason) VALUES (OLD.firebase_uid, 'uid_changed');
    PERFORM pg_notify('live_outbox', '');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_live_uid_changed AFTER UPDATE OF firebase_uid ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.live_uid_changed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_role_permission_removed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.live_revocations (firebase_uid, reason)
  SELECT DISTINCT u.firebase_uid, 'role_changed'
  FROM public.user_roles ur JOIN public.users u ON u.id = ur.user_id
  WHERE ur.role_id = OLD.role_id;
  PERFORM pg_notify('live_outbox', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER role_permissions_live_removed AFTER DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.live_role_permission_removed();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.live_assignment_ended() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  r record;
BEGIN
  IF OLD.status IN ('offered', 'accepted') AND NEW.status NOT IN ('offered', 'accepted') THEN
    FOR r IN SELECT su.user_id FROM public.shop_users su WHERE su.shop_id = OLD.shop_id LOOP
      PERFORM public.live_revoke_node(r.user_id, 'assignment_ended', 'order~' || OLD.order_id);
      PERFORM public.live_revoke_node(r.user_id, 'assignment_ended', 'assignment~' || OLD.id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_assignments_live_ended AFTER UPDATE OF status ON public.order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.live_assignment_ended();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.live_revoke_node(uuid, text, text) FROM PUBLIC, anon, authenticated;
