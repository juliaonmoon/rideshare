-- Migration 049: a repeating trip can have a time window ("every Saturday, any time between 6 am and 12 pm").
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 042, 046 and 048 first.
--
-- How it works: the repeating trip keeps its window for every day. When the driver accepts the first rider for a day,
-- that one day becomes its own fixed trip (the leave time is set by that rider), the riders asking for that day move to it,
-- and the repeating trip carries on for the other days. Later riders for that day ask the day's own trip.
-- If everyone on that day cancels, the day's trip opens up again (the window is back).

alter table public.trips add column if not exists series_parent uuid references public.trips(id) on delete set null;
create index if not exists trips_series_parent_idx on public.trips (series_parent) where series_parent is not null;

-- a window may now be on a repeating trip
alter table public.trips drop constraint if exists trips_flex_window_ok;
alter table public.trips add constraint trips_flex_window_ok check (
  flex_to is null or (flex_from is not null and flex_from >= 0 and flex_to <= 1439 and flex_to > flex_from and trip_date is not null));

-- riders need to see which days a repeating trip skips (a day that became its own trip counts as skipped on the repeating trip)
drop policy if exists "trip_skips read own" on public.trip_skips;
drop policy if exists "trip_skips read all" on public.trip_skips;
create policy "trip_skips read all" on public.trip_skips for select to authenticated using (true);

-- the separate days of a repeating trip do not count toward the 5 trips a driver can have
create or replace function public.limit_trips() returns trigger language plpgsql as $$
begin
  if new.series_parent is not null then return new; end if;
  if (select count(*) from public.trips where user_id = new.user_id and series_parent is null and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have posted too many trips in the last hour. Please try again later.';
  end if;
  if new.active and (select count(*) from public.trips where user_id = new.user_id and active and series_parent is null) >= 5 then
    raise exception 'You already have 5 active trips. Take one down first.';
  end if;
  return new;
end $$;

-- One day of a repeating trip with a window becomes its own fixed trip.
create or replace function public._split_flex_day(t public.trips, d date, dep integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare child uuid := gen_random_uuid();
begin
  insert into public.trips
    select (jsonb_populate_record(null::public.trips, to_jsonb(t) || jsonb_build_object(
      'id', child, 'trip_date', d, 'repeat_days', '[]'::jsonb, 'repeat_until', null, 'repeat_every', 1, 'repeat_nth', null,
      'depart_min', dep, 'flex_locked', true, 'series_parent', t.id, 'created_at', now(), 'quoted_km', null, 'quoted_min', null, 'quoted_source', null, 'quoted_rids', null))).*;
  insert into public.trip_skips (trip_id, skip_date) values (t.id, d) on conflict do nothing;
  return child;
end $$;
revoke all on function public._split_flex_day(public.trips, date, integer) from public, anon, authenticated;

-- Accepting the first rider on a day of a repeating trip with a window (see above).
create or replace function public._respond_match(p_driver uuid, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare child uuid; m public.matches; t public.trips; r public.ride_requests; bal integer; taken integer; q jsonb; dollars double precision; pts integer; a record; nd double precision; npts integer; diff integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  select * into t from public.trips where id = m.trip_id for update;
  if t.id is null or not t.active or (t.expires_at is not null and t.expires_at < now()) then raise exception 'This trip is no longer on'; end if;
  select * into r from public.ride_requests where id = m.request_id;
  if r.id is null or not r.active or (r.expires_at is not null and r.expires_at < now()) then raise exception 'This request is no longer active'; end if;
  if exists (select 1 from public.matches x where x.request_id = m.request_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id) then
    raise exception 'This rider already has a confirmed seat for that day';
  end if;
  select count(*) into taken from public.matches where trip_id = m.trip_id and ride_date = m.ride_date and status in ('accepted', 'completed') and id <> m.id;
  if taken >= coalesce(t.max_pickups, 3) then raise exception 'You already have % pickup(s) for this trip. Raise the limit on the trip to take more.', coalesce(t.max_pickups, 3); end if;
  -- the server works out the route and everyone's share again with the riders who are booked now
  q := public._quote_trip(m.trip_id, m.ride_date, m.request_id, true);
  if not coalesce((q->>'ok')::boolean, false) then raise exception 'This request no longer fits your detour limits'; end if;
  -- the first rider accepted on a trip with a time window sets the leave time; after that it is a normal scheduled trip
  if t.flex_to is not null and not t.live and not coalesce(t.flex_locked, false) then
    if coalesce(array_length(t.repeat_days, 1), 0) > 0 then
      -- a repeating trip with a time window: this one day becomes its own fixed trip, and the repeating trip carries on for the other days
      child := public._split_flex_day(t, m.ride_date, ceil((q->>'depart')::double precision)::int);
      update public.matches set trip_id = child where trip_id = t.id and ride_date = m.ride_date and status = 'requested';
      m.trip_id := child;
    else
      update public.trips set depart_min = ceil((q->>'depart')::double precision)::int, flex_locked = true where id = m.trip_id;
    end if;
  end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := case when m.pay_with = 'points' then greatest(1, floor(dollars / 0.10 + 0.0001))::int else 0 end;
  update public.matches set points = pts, cash_cents = floor(dollars * 100)::int, price_dollars = round(dollars::numeric, 2),
    detour_min = (q->>'added_min')::numeric, detour_km = (q->>'added_km')::numeric, quote_source = q->>'source' where id = p_match;
  if m.pay_with = 'points' and pts > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < pts then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - pts where user_id = m.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, -pts, 'Ride paid with points (held until the ride)', m.id);
  end if;
  -- riders who were already booked: their share can only go down; the difference goes back to them
  for a in select x.id, x.rider_id, x.request_id, x.pay_with, x.points, x.cash_cents from public.matches x
            where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id order by x.created_at, x.id loop
    nd := coalesce((select (e->>'dollars')::double precision from jsonb_array_elements(q->'shares') e where e->>'request_id' = a.request_id::text limit 1), null);
    if nd is null then continue; end if;
    if a.pay_with = 'points' and a.points > 0 then
      npts := greatest(1, floor(nd / 0.10 + 0.0001))::int;
      if npts < a.points then
        diff := a.points - npts;
        update public.wallets set points = points + diff where user_id = a.rider_id;
        insert into public.ledger (user_id, delta, reason, match_id) values (a.rider_id, diff, 'Refund: your share went down because another rider joined', a.id);
        update public.matches set points = npts, price_dollars = round(nd::numeric, 2) where id = a.id;
      end if;
    elsif a.pay_with = 'cash' then
      update public.matches set cash_cents = least(coalesce(a.cash_cents, 2147483647), floor(nd * 100)::int), price_dollars = least(coalesce(price_dollars, 99999), round(nd::numeric, 2)) where id = a.id;
    end if;
  end loop;
  -- remember the route and its distance for the whole trip as Google gave it now (used later for the trip's distance, so Google is not asked twice)
  update public.trips set quoted_km = (q->>'total_km')::numeric, quoted_min = (q->>'total_min')::numeric, quoted_source = q->>'source',
    quoted_rids = (select array_agg((e->>'request_id')::uuid order by (e->>'request_id')) from jsonb_array_elements(q->'shares') e) where id = m.trip_id;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;

create or replace function public.cancel_trip(p_trip uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; x record; n integer := 0;
begin
  select * into t from public.trips where id = p_trip and user_id = auth.uid() for update;
  if t.id is null then raise exception 'Not your trip'; end if;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.trips where series_parent = p_trip and active loop n := n + public.cancel_trip(x.id); end loop;   -- the separate days of a repeating trip with a window
  for x in select id, status from public.matches where trip_id = p_trip and status in ('requested', 'accepted') order by created_at loop
    if x.status = 'requested' then perform public._respond_match(auth.uid(), x.id, false); else perform public.cancel_ride(x.id); end if;
    n := n + 1;
  end loop;
  update public.trips set active = false where id = p_trip;
  return n;
end $$;

create or replace function public.sync_my_series() returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr record; d date; n integer := 0; today date := (now() at time zone 'America/Vancouver')::date;
        m uuid; pay text; t public.trips; r public.ride_requests; st text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  for pr in
    select distinct coalesce(t0.series_parent, x.trip_id) as trip_id, x.request_id, x.driver_id, x.rider_id from public.matches x
      join public.trips t0 on t0.id = x.trip_id
     where x.status in ('accepted', 'completed') and (x.driver_id = me or x.rider_id = me)
  loop
    select * into t from public.trips where id = pr.trip_id and active and not live;
    select * into r from public.ride_requests where id = pr.request_id and active and not live;
    if t.id is null or r.id is null then continue; end if;
    if coalesce(array_length(t.repeat_days, 1), 0) = 0 or coalesce(array_length(r.repeat_days, 1), 0) = 0 then continue; end if;
    if exists (select 1 from public.series_off where trip_id = pr.trip_id and request_id = pr.request_id) then continue; end if;
    if public._pair_blocked(pr.driver_id, pr.rider_id) then continue; end if;
    select x.pay_with into pay from public.matches x where x.trip_id in (select id from public.trips where id = pr.trip_id or series_parent = pr.trip_id) and x.request_id = pr.request_id and x.status in ('accepted', 'completed') order by x.ride_date desc limit 1;
    for d in select g::date from generate_series(today, today + 6, interval '1 day') g loop
      if not public._trip_on(t, d) or not public._req_on(r, d) then continue; end if;
      -- a day that already has a row (booked, skipped, declined or cancelled) is left alone
      if exists (select 1 from public.matches x where x.trip_id in (select id from public.trips where id = pr.trip_id or series_parent = pr.trip_id) and x.request_id = pr.request_id and x.ride_date = d) then continue; end if;
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

create or replace function public.stop_series(p_trip uuid, p_request uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; x record; n integer := 0; today date := (now() at time zone 'America/Vancouver')::date;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select coalesce(series_parent, id) into p_trip from public.trips where id = p_trip;   -- a separate day of a repeating trip: the repeating trip is meant
  select * into t from public.trips where id = p_trip;
  select * into r from public.ride_requests where id = p_request;
  if t.id is null or r.id is null or (t.user_id <> auth.uid() and r.user_id <> auth.uid()) then raise exception 'Not your booking'; end if;
  insert into public.series_off (trip_id, request_id, stopped_by) values (p_trip, p_request, auth.uid()) on conflict do nothing;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.matches where trip_id in (select id from public.trips where id = p_trip or series_parent = p_trip) and request_id = p_request and ride_date >= today and status in ('requested', 'accepted') and picked_up_at is null loop
    perform public._admin_cancel_match(x.id, 'the regular booking was ended');
    update public.matches set cancelled_by = auth.uid() where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stop_series(uuid, uuid) from public, anon;
grant execute on function public.stop_series(uuid, uuid) to authenticated;

create or replace function public.block_person(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x record; today date := (now() at time zone 'America/Vancouver')::date;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  insert into public.user_blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  perform set_config('app.cancel_ok', '1', true);
  -- waiting requests and booked rides that have not started, between the two of you, for today and later
  for x in select id from public.matches
            where status in ('requested', 'accepted') and picked_up_at is null and ride_date >= today
              and ((driver_id = auth.uid() and rider_id = p_user) or (driver_id = p_user and rider_id = auth.uid())) loop
    perform public._admin_cancel_match(x.id, 'the booking was ended');
    update public.matches set cancelled_by = auth.uid() where id = x.id;
  end loop;
  -- old waiting requests (earlier dates) are withdrawn too, as before
  update public.matches set status = 'cancelled', cancelled_at = now()
   where status = 'requested' and ((driver_id = auth.uid() and rider_id = p_user) or (driver_id = p_user and rider_id = auth.uid()));
  -- and their regular bookings end
  insert into public.series_off (trip_id, request_id, stopped_by)
    select distinct coalesce((select s.series_parent from public.trips s where s.id = trip_id), trip_id), request_id, auth.uid() from public.matches
     where (driver_id = auth.uid() and rider_id = p_user) or (driver_id = p_user and rider_id = auth.uid())
    on conflict do nothing;
end $$;
revoke all on function public.block_person(uuid) from public, anon;
grant execute on function public.block_person(uuid) to authenticated;

create or replace function public.skip_trip_day(p_trip uuid, p_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; x record; n integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.trips where id = p_trip;
  if t.id is null or t.user_id <> auth.uid() then raise exception 'Not your trip'; end if;
  insert into public.trip_skips (trip_id, skip_date) values (p_trip, p_date) on conflict do nothing;
  perform set_config('app.cancel_ok', '1', true);
  update public.trips set active = false where series_parent = p_trip and trip_date = p_date and active;   -- the day that became its own trip
  for x in select id from public.matches where trip_id in (select id from public.trips where id = p_trip or series_parent = p_trip) and ride_date = p_date and status in ('requested', 'accepted') and picked_up_at is null loop
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
  if exists (select 1 from public.trips where series_parent = p_trip and trip_date = p_date and active) then raise exception 'This day already has its own trip with riders'; end if;
  delete from public.trip_skips where trip_id = p_trip and skip_date = p_date;
end $$;
revoke all on function public.unskip_trip_day(uuid, date) from public, anon;
grant execute on function public.unskip_trip_day(uuid, date) to authenticated;
