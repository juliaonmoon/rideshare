-- Migration 047: "Repeat until" - a repeating trip or request can have a last day.
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 046 first.
--
-- After the last day nothing new is booked, and the trip / request switches itself off the next time the app opens.

alter table public.trips add column if not exists repeat_until date;
alter table public.ride_requests add column if not exists repeat_until date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_repeat_until_ok') then
    alter table public.trips add constraint trips_repeat_until_ok check (repeat_until is null or (repeat_until >= trip_date and coalesce(array_length(repeat_days, 1), 0) > 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_repeat_until_ok') then
    alter table public.ride_requests add constraint requests_repeat_until_ok check (repeat_until is null or (repeat_until >= ride_date and coalesce(array_length(repeat_days, 1), 0) > 0));
  end if;
end $$;

-- Does a repeating item happen on this date, with its last day taken into account?
create or replace function public._on_day(p_date date, p_base date, p_days smallint[], p_until date) returns boolean
language sql stable set search_path = public as $$
  select public.occurs_on(p_date, p_base, p_days) and (p_until is null or p_date <= p_until or p_date = p_base);
$$;
revoke all on function public._on_day(date, date, smallint[], date) from public, anon;
grant execute on function public._on_day(date, date, smallint[], date) to authenticated;

-- Tidy up: my repeating trips and requests whose last day has passed switch off (called by the app when it loads).
create or replace function public.expire_live() returns void language plpgsql as $$
declare today date := (now() at time zone 'America/Vancouver')::date;
begin
  update public.trips set active = false where user_id = auth.uid() and live and active and expires_at < now();
  update public.ride_requests set active = false where user_id = auth.uid() and live and active and expires_at < now();
  update public.trips set active = false where user_id = auth.uid() and not live and active and repeat_until is not null and repeat_until < today;
  update public.ride_requests set active = false where user_id = auth.uid() and not live and active and repeat_until is not null and repeat_until < today;
end $$;

-- Regular rides and seat requests stop at the last day.
create or replace function public._request_seat_as(p_rider uuid, p_trip uuid, p_request uuid, p_pay_with text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; q jsonb; pts integer; dollars double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = p_rider and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.expires_at is not null and t.expires_at < now() then raise exception 'That live trip has ended'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'Your live request has ended'; end if;
  if t.user_id = p_rider then raise exception 'You cannot ride with yourself'; end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  if not public._on_day(p_date, t.trip_date, t.repeat_days, t.repeat_until) or not public._on_day(p_date, r.ride_date, r.repeat_days, r.repeat_until) then
    raise exception 'That trip or request does not run on that date';
  end if;
  if p_pay_with not in ('points', 'cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  q := public._quote_trip(p_trip, p_date, p_request, true);
  if not coalesce((q->>'ok')::boolean, false) then
    if q->>'reason' = 'full' then raise exception 'This trip has no seat left'; end if;
    if q->>'reason' = 'unknown_area' then raise exception 'Unknown area'; end if;
    raise exception 'This trip is outside the driver''s detour limits';
  end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := greatest(1, floor(dollars / 0.10 + 0.0001))::int;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, detour_min, detour_km, cash_cents, price_dollars, quote_source)
    values (p_trip, p_request, t.user_id, p_rider, p_pay_with, case when p_pay_with = 'points' then pts else 0 end, p_date,
            (q->>'added_min')::numeric, (q->>'added_km')::numeric, floor(dollars * 100)::int, round(dollars::numeric, 2), q->>'source')
    returning id into m;
  -- asking again by hand on purpose brings back a regular booking the rider had ended
  delete from public.series_off where trip_id = p_trip and request_id = p_request and stopped_by = p_rider;
  return m;
end $$;
revoke all on function public._request_seat_as(uuid, uuid, uuid, text, date) from public, anon, authenticated;

create or replace function public.sync_my_series() returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr record; d date; n integer := 0; today date := (now() at time zone 'America/Vancouver')::date;
        m uuid; pay text; t public.trips; r public.ride_requests; st text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  for pr in
    select distinct x.trip_id, x.request_id, x.driver_id, x.rider_id from public.matches x
     where x.status in ('accepted', 'completed') and (x.driver_id = me or x.rider_id = me)
  loop
    select * into t from public.trips where id = pr.trip_id and active and not live;
    select * into r from public.ride_requests where id = pr.request_id and active and not live;
    if t.id is null or r.id is null then continue; end if;
    if coalesce(array_length(t.repeat_days, 1), 0) = 0 or coalesce(array_length(r.repeat_days, 1), 0) = 0 then continue; end if;
    if exists (select 1 from public.series_off where trip_id = pr.trip_id and request_id = pr.request_id) then continue; end if;
    if public._pair_blocked(pr.driver_id, pr.rider_id) then continue; end if;
    select x.pay_with into pay from public.matches x where x.trip_id = pr.trip_id and x.request_id = pr.request_id and x.status in ('accepted', 'completed') order by x.ride_date desc limit 1;
    for d in select g::date from generate_series(today, today + 6, interval '1 day') g loop
      if not public._on_day(d, t.trip_date, t.repeat_days, t.repeat_until) or not public._on_day(d, r.ride_date, r.repeat_days, r.repeat_until) then continue; end if;
      -- a day that already has a row (booked, skipped, declined or cancelled) is left alone
      if exists (select 1 from public.matches x where x.trip_id = pr.trip_id and x.request_id = pr.request_id and x.ride_date = d) then continue; end if;
      if exists (select 1 from public.matches x where x.request_id = pr.request_id and x.ride_date = d and x.status in ('requested', 'accepted', 'completed')) then continue; end if;
      begin
        m := public._request_seat_as(pr.rider_id, pr.trip_id, pr.request_id, pay, d);
        select status into st from public.matches where id = m;
        if st = 'requested' then perform public._respond_match(pr.driver_id, m, true); end if;   -- the driver already said yes to this rider on this trip
        n := n + 1;
      exception when others then null;   -- does not fit this time: nothing is kept, nobody is bothered
      end;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.sync_my_series() from public, anon;
grant execute on function public.sync_my_series() to authenticated;
