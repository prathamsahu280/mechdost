-- PostHog forwarder cursor (decision 2026-11-14 "Monitoring", review finding 2): the worker reads
-- `events` ordered by (received_at, id) after a cursor every 10 s. An index on the partitioned parent is created on
-- every existing partition and inherited by partitions made later (`ensure_event_partitions`), so each read is an
-- index range scan from the cursor instead of a scan of the last 25 hours. Small table at launch: a plain (not
-- CONCURRENTLY) build is fine; CONCURRENTLY is not allowed on a partitioned parent anyway.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_received_idx ON public.events (received_at, id);
