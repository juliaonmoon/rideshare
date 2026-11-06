-- Migration 048: repeat patterns like a calendar app - every N weeks, the nth weekday of a month (e.g. the last Thursday),
-- and skipping any single day of a repeating trip.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 046 and 047 first.

alter table public.trips add column if not exists repeat_every smallint not null default 1;
alter table public.trips add column if not exists repeat_nth smallint;
alter table public.ride_requests add column if not exists repeat_every smallint not null default 1;
alter table public.ride_requests add column if not exists repeat_nth smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_repeat_pattern_ok') then
    alter table public.trips add constraint trips_repeat_pattern_ok check (repeat_every between 1 and 4 and (repeat_nth is null or (repeat_nth between 1 and 5 and array_length(repeat_days, 1) = 1)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_repeat_pattern_ok') then
    alter table public.ride_requests add constraint requests_repeat_pattern_ok check (repeat_every between 1 and 4 and (repeat_nth is null or (repeat_nth between 1 and 5 and array_length(repeat_days, 1) = 1)));
  end if;
end $$;

-- Days a driver skipped on a repeating trip.
create table if not exists public.trip_skips (
  trip_id uuid not null references public.trips(id) on delete cascade,
  skip_date date not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, skip_date)
);
alter table public.trip_skips enable row level security;
drop policy if exists "trip_skips read own" on public.trip_skips;
create policy "trip_skips read own" on public.trip_skips for select to authenticated using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
revoke insert, update, delete on public.trip_skips from anon, authenticated;

-- Does a repeating item happen on this date? Weekly (every N weeks) or the nth weekday of a month (5 = the last one).
drop function if exists public._on_day(date, date, smallint[], date);
create or replace function public._on_day(p_date date, p_base date, p_days smallint[], p_until date, p_every integer default 1, p_nth integer default null)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_date is null or p_base is null then false
    when p_date = p_base then true
    when p_date < p_base then false
    when p_until is not null and p_date > p_until then false
    when coalesce(array_length(p_days, 1), 0) = 0 then false
    when p_nth is not null then
      extract(isodow from p_date)::int = p_days[1]
      and case when p_nth = 5 then extract(day from p_date)::int + 7 > extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int
               else ((extract(day from p_date)::int - 1) / 7) + 1 = p_nth end
    else extract(isodow from p_date)::int = any (p_days)
      and (coalesce(p_every, 1) <= 1 or (((p_date - (p_base - (extract(isodow from p_base)::int - 1))) / 7) % p_every) = 0)
  end;
$$;
revoke all on function public._on_day(date, date, smallint[], date, integer, integer) from public, anon;
grant execute on function public._on_day(date, date, smallint[], date, integer, integer) to authenticated;

-- Does this trip run on this date (pattern, last day and skipped days all taken into account)? Does this request?
create or replace function public._trip_on(t public.trips, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select public._on_day(d, t.trip_date, t.repeat_days, t.repeat_until, t.repeat_every, t.repeat_nth)
     and not exists (select 1 from public.trip_skips s where s.trip_id = t.id and s.skip_date = d);
$$;
create or replace function public._req_on(r public.ride_requests, d date) returns boolean
language sql stable set search_path = public as $$
  select public._on_day(d, r.ride_date, r.repeat_days, r.repeat_until, r.repeat_every, r.repeat_nth);
$$;
revoke all on function public._trip_on(public.trips, date) from public, anon;
revoke all on function public._req_on(public.ride_requests, date) from public, anon;
grant execute on function public._trip_on(public.trips, date) to authenticated;
grant execute on function public._req_on(public.ride_requests, date) to authenticated;

-- Skip one day of a repeating trip: riders booked that day are cancelled (points go back).
create or replace function public.skip_trip_day(p_trip uuid, p_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; x record; n integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.trips where id = p_trip;
  if t.id is null or t.user_id <> auth.uid() then raise exception 'Not your trip'; end if;
  insert into public.trip_skips (trip_id, skip_date) values (p_trip, p_date) on conflict do nothing;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.matches where trip_id = p_trip and ride_date = p_date and status in ('requested', 'accepted') and picked_up_at is null loop
    perform public._admin_cancel_match(x.id, 'the driver skipped this day');
    update public.matches set cancelled_by = auth.uid() where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.skip_trip_day(uuid, date) from public, anon;
grant execute on function public.skip_trip_day(uuid, date) to authenticated;

create or replace function public.unskip_trip_day(p_trip uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.trips where id = p_trip and user_id = auth.uid()) then raise exception 'Not your trip'; end if;
  delete from public.trip_skips where trip_id = p_trip and skip_date = p_date;
end $$;
revoke all on function public.unskip_trip_day(uuid, date) from public, anon;
grant execute on function public.unskip_trip_day(uuid, date) to authenticated;

-- The places that ask "does this trip run today?" (phone alerts, the route helper) now use the same rule.
create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; lv jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  -- Leave now is the start: once a live offer is moving, riders already accepted count as "on the way" with no separate Start trip tap.
  update public.matches m set en_route_at = now()
    from public.trips t
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and t.id = m.trip_id and t.live and t.active
      and coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, false);
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public._trip_on(t, today));
  -- Test mode: about every 45 seconds, while nothing is waiting, a made-up rider asks (it appears 5 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '45 seconds'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 5);
      update public.test_accounts set last_test_at = now() where user_id = d;
    exception when others then null;   -- never let a test problem break the real alert check
    end;
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at, m.detour_min, m.detour_km,
      coalesce(a.sum_min, 0) + coalesce(m.detour_min, 0) as total_min, coalesce(a.sum_km, 0) + coalesce(m.detour_km, 0) as total_km,
      greatest(coalesce(t.max_total_detour, t.max_detour), t.max_detour) as limit_min,
      case when t.max_detour_km is null and t.max_total_detour_km is null then null
           else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end as limit_km,
      public._leave_json(m.id) as leave
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    join public.trips t on t.id = m.trip_id
    left join public.profiles p on p.id = m.rider_id
    left join lateral (select sum(x.detour_min) as sum_min, sum(x.detour_km) as sum_km from public.matches x
                       where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status in ('accepted','completed')) a on true
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
      and public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id)
      and public._reachable(m.id)
      and r.active and (r.expires_at is null or r.expires_at > now())
    order by m.created_at desc limit 5) x;
  select coalesce(jsonb_agg(y order by y.en_route_at), '[]'::jsonb) into rides from (
    select m.id, coalesce(p.display_name, 'Rider') as name, m.en_route_at,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived' else 'on_my_way' end as stage,
      coalesce(ex.pickup_label, r.pickup_label, r.pickup) as pickup_name, coalesce(ex.dropoff_label, r.dropoff_label, r.dropoff) as dropoff_name,
      coalesce(m.meet_lat, ex.pickup_lat, r.pickup_lat, pa.lat) as pickup_lat, coalesce(m.meet_lng, ex.pickup_lng, r.pickup_lng, pa.lng) as pickup_lng, m.meet_note,
      coalesce(ex.dropoff_lat, r.dropoff_lat, da.lat) as dropoff_lat, coalesce(ex.dropoff_lng, r.dropoff_lng, da.lng) as dropoff_lng,
      (m.meet_lat is not null or ex.pickup_lat is not null or r.pickup_lat is not null) as pickup_exact, (ex.dropoff_lat is not null or r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.request_exact ex on ex.request_id = r.id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  -- accepted riders on a live offer whose driver has not set off yet, with the time the driver must leave by (empty once the driver is moving)
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'leave_by_ms', z.ms)), '[]'::jsonb) into lv from (
    select m.id, coalesce(p.display_name, 'Rider') as name, (public._leave_json(m.id)->>'leave_by_ms')::bigint as ms
    from public.matches m
    join public.trips t on t.id = m.trip_id and t.active and (t.live or t.flex_to is not null)
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and (t.flex_to is not null and not t.live or coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, true) = false)
    limit 6) z where z.ms is not null;
  -- where the driver is heading today (the newest active trip), so the phone can end the trip on arrival
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public._trip_on(t, today)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides, 'leave', lv, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;

create or replace function public.driver_route_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; stops jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(s order by s.created_at), '[]'::jsonb) into stops from (
    select m.id as match_id, coalesce(p.display_name, 'Rider') as name, 'pick' as type, m.created_at,
           coalesce(m.meet_lat, ex.pickup_lat, r.pickup_lat, pa.lat) as lat, coalesce(m.meet_lng, ex.pickup_lng, r.pickup_lng, pa.lng) as lng
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.request_exact ex on ex.request_id = r.id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas pa on pa.name = r.pickup
     where m.driver_id = d and m.status = 'accepted' and m.picked_up_at is null and m.dropped_off_at is null and m.ride_date >= today - 1
    union all
    select m.id, coalesce(p.display_name, 'Rider'), 'drop', m.created_at,
           coalesce(ex.dropoff_lat, r.dropoff_lat, da.lat), coalesce(ex.dropoff_lng, r.dropoff_lng, da.lng)
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.request_exact ex on ex.request_id = r.id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas da on da.name = r.dropoff
     where m.driver_id = d and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1) s
   where s.lat is not null and s.lng is not null;
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public._trip_on(t, today)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('stops', stops, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;

create or replace function public._driver_trip_today(d uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.trips t
   where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
     and public._trip_on(t, (now() at time zone 'America/Vancouver')::date)
   order by t.live desc, t.created_at desc limit 1;
$$;

-- Booking a seat and the regular rides use it too.
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
  if not public._trip_on(t, p_date) or not public._req_on(r, p_date) then
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
      if not public._trip_on(t, d) or not public._req_on(r, d) then continue; end if;
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
