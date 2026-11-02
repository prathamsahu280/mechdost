-- Rows that already had their first pass before `wiped_at` existed (migration 0023) would never qualify for the
-- second pass under `wiped_at < …`; give them a start time (security review 2026-11-03). The claim query is also
-- null-safe (`coalesce(wiped_at, created_at)`).
UPDATE public.live_revocations SET wiped_at = created_at WHERE attempts > 0 AND done_at IS NULL AND wiped_at IS NULL;
