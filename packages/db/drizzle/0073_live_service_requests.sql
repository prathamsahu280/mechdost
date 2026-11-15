ALTER TABLE "live_outbox" DROP CONSTRAINT "live_outbox_topic_format";--> statement-breakpoint
ALTER TABLE "live_outbox" ADD CONSTRAINT "live_outbox_topic_format" CHECK ("live_outbox"."topic" ~ '^(order|shop|workshop|user|staff_city|quote|request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');--> statement-breakpoint
-- Live pings for service requests (design 2026-11-16): any change to a request pings its customer, the workshop that
-- holds it and the city's service staff (recipients resolved from Postgres by the relay); ids and versions only.
CREATE OR REPLACE FUNCTION public.live_request_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_enqueue('request:' || NEW.id, 'request', NEW.id, NEW.version, 'request.status_changed');
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER service_requests_live AFTER INSERT OR UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.live_request_changed();