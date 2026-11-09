-- Migration 058: the reliability record also shows how many rides someone has completed.
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 004.
--
-- Before: only warnings appeared next to a name (late cancels, missed pickups, driver cancels in the last 30 days).
-- A brand-new member and a person with 40 good rides looked the same. Now the view also counts finished rides.
-- Counts only; no details about other people are exposed.

create or replace view public.reliability as
select p.id as user_id,
  (select count(*) from public.matches m where m.rider_id = p.id and m.late and m.cancelled_by = m.rider_id and m.cancelled_at > now() - interval '30 days')::int as late_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'no_show' and m.cancelled_at > now() - interval '30 days')::int as no_shows,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'cancelled' and m.cancelled_by = m.driver_id and m.cancelled_at > now() - interval '30 days')::int as driver_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'completed')::int as rides_as_rider,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'completed')::int as rides_as_driver,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'cancelled' and m.cancelled_by = m.driver_id and m.late and m.cancelled_at > now() - interval '30 days')::int as driver_late_cancels
from public.profiles p;
revoke all on public.reliability from anon;
grant select on public.reliability to authenticated;
