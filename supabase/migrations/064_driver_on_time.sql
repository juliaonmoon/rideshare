-- Migration 064: a driver's on-time record. A completed ride counts as on time when the driver tapped Arrived within 3 minutes of the agreed pickup time.
-- Counts only. Run once in the Supabase SQL editor (safe to run again). Needs 058.

create or replace view public.reliability as
select p.id as user_id,
  (select count(*) from public.matches m where m.rider_id = p.id and m.late and m.cancelled_by = m.rider_id and m.cancelled_at > now() - interval '30 days')::int as late_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'no_show' and m.cancelled_at > now() - interval '30 days')::int as no_shows,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'cancelled' and m.cancelled_by = m.driver_id and m.cancelled_at > now() - interval '30 days')::int as driver_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'completed')::int as rides_as_rider,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'completed')::int as rides_as_driver,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'cancelled' and m.cancelled_by = m.driver_id and m.late and m.cancelled_at > now() - interval '30 days')::int as driver_late_cancels,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'completed' and m.arrived_at is not null and m.pickup_time is not null)::int as timed_rides,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'completed' and m.arrived_at is not null and m.pickup_time is not null and m.arrived_at <= m.pickup_time + interval '3 minutes')::int as on_time_rides
from public.profiles p;
revoke all on public.reliability from anon;
grant select on public.reliability to authenticated;
