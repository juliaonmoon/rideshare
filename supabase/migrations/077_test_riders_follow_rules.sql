-- 077: made-up (sample) riders now follow the real rules. A made-up rider's seat request is only created if the same server check
-- that real requests go through says it fits (detour limits, time window, seats left). If it would not fit, nothing is sent.
-- When it fits, its detour numbers are filled in exactly like a real request. Real riders are not affected.
-- Run once in the Supabase SQL editor (safe to run again). Needs 042.
create or replace function public._test_rider_follows_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb; cap integer; taken integer;
begin
  if new.status <> 'requested' then return new; end if;
  if not exists (select 1 from auth.users u where u.id = new.rider_id and u.email like 'sample-r-%@example.invalid') then return new; end if;
  select coalesce(max_pickups, 3) into cap from public.trips where id = new.trip_id;
  select count(*)::int into taken from public.matches where trip_id = new.trip_id and ride_date = new.ride_date and status in ('accepted', 'completed') and id is distinct from new.id;
  if cap is not null and taken >= cap then raise exception 'Your trip is full, so no made-up rider was sent'; end if;
  q := public._quote_trip(new.trip_id, new.ride_date, new.request_id, false);
  if not coalesce((q->>'ok')::boolean, false) then raise exception 'A made-up rider would not fit your trip, so none was sent'; end if;
  new.detour_min := (q->>'added_min')::numeric; new.detour_km := (q->>'added_km')::numeric;
  return new;
end $$;
revoke all on function public._test_rider_follows_rules() from public, anon, authenticated;
drop trigger if exists matches_test_rider_rules on public.matches;
create trigger matches_test_rider_rules before insert or update of status on public.matches for each row execute function public._test_rider_follows_rules();