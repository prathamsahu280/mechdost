-- Live updates (decision 2026-11-01, docs/research/realtime-alternatives.md). Triggers write one live_outbox row
-- per changed entity inside the business transaction, then wake the relay with pg_notify. Postgres folds identical
-- notifications within a transaction, so a busy transaction still wakes the relay once; the relay also sweeps
-- every second in case a notification is missed. Rows carry ids and versions only (no PII, hard rule 16).
CREATE OR REPLACE FUNCTION public.live_enqueue(p_topic text, p_kind text, p_entity uuid, p_version integer, p_event text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.live_outbox (topic, kind, entity_id, entity_version, event)
  VALUES (p_topic, p_kind, p_entity, p_version, p_event);
  PERFORM pg_notify('live_outbox', '');
END;
$$;
--> statement-breakpoint
-- Any change to an order (status, shop, delivery, payment) pings everyone who may see that order.
CREATE OR REPLACE FUNCTION public.live_order_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_enqueue('order:' || NEW.id, 'order', NEW.id, NEW.version, 'order.status_changed');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_live AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.live_order_changed();
--> statement-breakpoint
-- An offer, acceptance, decline or expiry pings the shop it concerns (and that shop's city staff via the relay).
CREATE OR REPLACE FUNCTION public.live_assignment_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_enqueue('shop:' || NEW.shop_id, 'assignment', NEW.id, NEW.version, 'assignment.changed');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_assignments_live AFTER INSERT OR UPDATE ON public.order_assignments
  FOR EACH ROW EXECUTE FUNCTION public.live_assignment_changed();
--> statement-breakpoint
-- Pause / suspend / reactivate reaches the shop's portal at once (the API also re-checks standing on every call).
CREATE OR REPLACE FUNCTION public.live_shop_standing_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.live_enqueue('shop:' || NEW.id, 'shop', NEW.id, NEW.version, 'partner.status_changed');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shops_live AFTER UPDATE OF status ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.live_shop_standing_changed();
--> statement-breakpoint
-- Platform rule: RLS on, nothing for end-user roles; only the API/worker (service connection) reads the outbox.
ALTER TABLE public.live_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.live_outbox FROM anon, authenticated;
--> statement-breakpoint
-- Not callable through the Supabase REST RPC endpoint (it would let anyone inject pings).
REVOKE ALL ON FUNCTION public.live_enqueue(text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
