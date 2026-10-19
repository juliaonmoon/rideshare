-- Migration 006: "Leave now" trips, live driver position, and free cancel for a very late driver
-- (run once in Supabase > SQL Editor, after 005).
--
-- Leave now: a driver taps one button. The SERVER sets the date and time from its own clock (Vancouver time): departure in 5 minutes,
--   live for 30 minutes, then it disappears by itself. A rider taps "I need a ride now": ready now, live for 20 minutes.
-- Live position: while a driver has a ride in progress (tapped On my way), their phone can share its position. Only the riders on
--   that ride can see it, only the latest point is kept, and it is deleted when sharing stops.
-- Late driver: if the pickup time plus the driver's wait plus 10 minutes has passed and the driver has not arrived, the rider can
--   cancel for all points back, and it counts against the driver.
-- Safe to run twice.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'live') then
    alter table public.trips add column live boolean not null default false;
    alter table public.trips add column expires_at timestamptz;
    alter table public.ride_requests add column live boolean not null default false;
    alter table public.ride_requests add column expires_at timestamptz;
    alter table public.matches add column driver_late boolean not null default false;
  end if;
end $$;

-- Expired live trips/requests are invisible to everyone but their owner.
drop policy if exists "trips read" on public.trips;
create policy "trips read" on public.trips for select to authenticated
  using ((active and (expires_at is null or expires_at > now())) or user_id = auth.uid());
drop policy if exists "requests read" on public.ride_requests;
create policy "requests read" on public.ride_requests for select to authenticated
  using ((active and (expires_at is null or expires_at > now())) or user_id = auth.uid());

-- Driver: leave now. Server clock decides the time (Vancouver), never the phone.
create or replace function public.go_live_trip(p_origin text, p_dest text, p_max_detour integer, p_max_wait integer, p_accepts text, p_cost_per_km numeric)
returns uuid language plpgsql as $$
declare t timestamp; id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  t := (now() at time zone 'America/Vancouver') + interval '5 minutes';
  update public.trips set active = false where user_id = auth.uid() and live and active;
  insert into public.trips (user_id, origin, dest, depart_min, max_detour, max_wait, accepts, cost_per_km, trip_date, repeat_days, live, expires_at)
    values (auth.uid(), p_origin, p_dest, (extract(hour from t) * 60 + extract(minute from t))::int, p_max_detour, p_max_wait, p_accepts, p_cost_per_km, t::date, '{}', true, now() + interval '30 minutes')
    returning trips.id into id;
  return id;
end $$;

-- Rider: I need a ride now (ready now, for the next 20 minutes).
create or replace function public.go_live_request(p_pickup text, p_dropoff text, p_pays text)
returns uuid language plpgsql as $$
declare t timestamp; mins integer; id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  t := now() at time zone 'America/Vancouver';
  mins := (extract(hour from t) * 60 + extract(minute from t))::int;
  update public.ride_requests set active = false where user_id = auth.uid() and live and active;
  insert into public.ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, ride_date, repeat_days, live, expires_at)
    values (auth.uid(), p_pickup, p_dropoff, mins, least(mins + 20, 1439), p_pays, t::date, '{}', true, now() + interval '20 minutes')
    returning ride_requests.id into id;
  return id;
end $$;

-- Tidy up my own expired live trips/requests (called by the app when it loads).
create or replace function public.expire_live() returns void language plpgsql as $$
begin
  update public.trips set active = false where user_id = auth.uid() and live and active and expires_at < now();
  update public.ride_requests set active = false where user_id = auth.uid() and live and active and expires_at < now();
end $$;

-- Seat request: also refuse trips/requests whose live window has ended.
create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_points integer, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; max_pts integer; direct double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.expires_at is not null and t.expires_at < now() then raise exception 'That live trip has ended'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'Your live request has ended'; end if;
  if t.user_id = auth.uid() then raise exception 'You cannot ride with yourself'; end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  if not public.occurs_on(p_date, t.trip_date, t.repeat_days) or not public.occurs_on(p_date, r.ride_date, r.repeat_days) then
    raise exception 'That trip or request does not run on that date';
  end if;
  if p_pay_with not in ('points','cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  if p_pay_with = 'points' then
    direct := public.area_km(r.pickup, r.dropoff);
    if direct is null then raise exception 'Unknown area'; end if;
    max_pts := ceil(((direct + t.max_detour * 40.0 / 60.0) * t.cost_per_km / 2.0) / 0.10)::integer + 1;
    if p_points < 1 or p_points > max_pts then raise exception 'That points amount is outside the fair range (1 to %)', max_pts; end if;
  end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date)
    values (p_trip, p_request, t.user_id, auth.uid(), p_pay_with, case when p_pay_with = 'points' then p_points else 0 end, p_date)
    returning id into m;
  return m;
end $$;

-- Live driver position (one latest row per driver, deleted when sharing stops).
create table if not exists public.driver_positions (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  speed real check (speed is null or speed between 0 and 100),
  heading real check (heading is null or heading between 0 and 360),
  accuracy real,
  updated_at timestamptz not null default now()
);
alter table public.driver_positions enable row level security;
drop policy if exists "positions read" on public.driver_positions;
create policy "positions read" on public.driver_positions for select to authenticated
  using (driver_id = auth.uid() or (
    updated_at > now() - interval '10 minutes'
    and exists (select 1 from public.matches m where m.driver_id = driver_positions.driver_id and m.rider_id = auth.uid() and m.status = 'accepted' and m.en_route_at is not null)));
revoke insert, update, delete on public.driver_positions from anon, authenticated;
revoke all on public.driver_positions from anon;

create or replace function public.share_position(p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.matches where driver_id = auth.uid() and status = 'accepted' and en_route_at is not null) then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (auth.uid(), p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
end $$;

create or replace function public.stop_sharing() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.driver_positions where driver_id = auth.uid();
end $$;

-- cancel_ride: as in 005, plus a free cancel for the rider when the driver is very late.
create or replace function public.cancel_ride(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; is_rider boolean; is_late boolean; driver_is_late boolean;
        keep integer := 0; refund integer := 0; used_waiver boolean; result text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or (m.rider_id <> auth.uid() and m.driver_id <> auth.uid()) then raise exception 'Not your ride'; end if;
  if m.status not in ('requested','accepted') then raise exception 'This ride is already %', m.status; end if;
  is_rider := (m.rider_id = auth.uid());
  if m.status = 'requested' then
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = p_match;
    return 'cancelled_free';
  end if;
  if m.picked_up_at is not null then raise exception 'The ride has already started, so it can no longer be cancelled'; end if;
  select * into t from public.trips where id = m.trip_id;
  pk := public.pickup_at(m.ride_date, t.depart_min);
  driver_is_late := is_rider and m.arrived_at is null and now() >= pk + ((t.max_wait + 10) * interval '1 minute');
  if is_rider and now() >= pk and not driver_is_late then raise exception 'The pickup time has passed, so this ride can no longer be cancelled'; end if;
  if driver_is_late then
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Driver was very late (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), late = false, driver_late = true, settled = true, refunded = refund where id = p_match;
    return 'cancelled_driver_late';
  end if;
  is_late := (pk - now()) < interval '2 hours';
  result := 'cancelled_full';
  if m.pay_with = 'points' and m.points > 0 then
    refund := m.points;
    if is_rider and is_late then
      select not exists (
        select 1 from public.matches x
        where x.rider_id = m.rider_id and x.id <> m.id and x.late and x.cancelled_by = x.rider_id
          and date_trunc('month', x.cancelled_at at time zone 'America/Vancouver') = date_trunc('month', now() at time zone 'America/Vancouver')
      ) into used_waiver;
      if used_waiver then result := 'cancelled_free_late';
      else keep := m.points / 2; refund := m.points - keep; result := 'cancelled_half'; end if;
    end if;
    if refund > 0 then
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Ride cancelled (points returned)', m.id);
    end if;
    if keep > 0 then
      update public.wallets set points = points + keep where user_id = m.driver_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, keep, 'Late cancellation (half kept)', m.id);
    end if;
  elsif is_rider and is_late then
    result := 'cancelled_free_late';
  end if;
  update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
    late = is_late, settled = true, refunded = refund where id = p_match;
  return result;
end $$;

-- Reliability counts: a very late driver counts like a driver cancellation.
create or replace view public.reliability as
select p.id as user_id,
  (select count(*) from public.matches m where m.rider_id = p.id and m.late and m.cancelled_by = m.rider_id and m.cancelled_at > now() - interval '30 days')::int as late_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'no_show' and m.cancelled_at > now() - interval '30 days')::int as no_shows,
  (select count(*) from public.matches m where m.driver_id = p.id and m.cancelled_at > now() - interval '30 days'
     and ((m.status = 'cancelled' and m.cancelled_by = m.driver_id) or m.driver_late))::int as driver_cancels
from public.profiles p;
revoke all on public.reliability from anon;
grant select on public.reliability to authenticated;

-- Live updates for trips, requests and driver positions.
do $$
begin
  begin alter publication supabase_realtime add table public.driver_positions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.trips; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ride_requests; exception when duplicate_object then null; end;
end $$;

revoke all on function public.go_live_trip(text, text, integer, integer, text, numeric) from public, anon;
revoke all on function public.go_live_request(text, text, text) from public, anon;
revoke all on function public.expire_live() from public, anon;
revoke all on function public.request_seat(uuid, uuid, text, integer, date) from public, anon;
revoke all on function public.share_position(double precision, double precision, real, real, real) from public, anon;
revoke all on function public.stop_sharing() from public, anon;
revoke all on function public.cancel_ride(uuid) from public, anon;
grant execute on function public.go_live_trip(text, text, integer, integer, text, numeric) to authenticated;
grant execute on function public.go_live_request(text, text, text) to authenticated;
grant execute on function public.expire_live() to authenticated;
grant execute on function public.request_seat(uuid, uuid, text, integer, date) to authenticated;
grant execute on function public.share_position(double precision, double precision, real, real, real) to authenticated;
grant execute on function public.stop_sharing() to authenticated;
grant execute on function public.cancel_ride(uuid) to authenticated;
