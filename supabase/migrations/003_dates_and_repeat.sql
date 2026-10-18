-- Migration 003: dates and weekly repeat for trips and ride requests (run once in Supabase > SQL Editor, after 002).
-- A trip/request has a start date (trip_date / ride_date) and optional weekly repeat days (ISO: 1 = Mon ... 7 = Sun).
-- It happens on its start date, and on every later date whose weekday is in repeat_days.
-- A seat request (match) is for one specific date (ride_date). Safe to run twice.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'repeat_days') then
    alter table public.trips add column trip_date date not null default current_date;
    alter table public.trips add column repeat_days smallint[] not null default '{}';
    alter table public.ride_requests add column ride_date date not null default current_date;
    alter table public.ride_requests add column repeat_days smallint[] not null default '{}';
    alter table public.matches add column ride_date date not null default current_date;
    -- Pre-launch: existing trips and requests (including the sample people) become every-day repeating, starting today.
    update public.trips set repeat_days = '{1,2,3,4,5,6,7}';
    update public.ride_requests set repeat_days = '{1,2,3,4,5,6,7}';
    alter table public.trips add constraint trips_repeat_days_check check (repeat_days <@ array[1,2,3,4,5,6,7]::smallint[]);
    alter table public.ride_requests add constraint requests_repeat_days_check check (repeat_days <@ array[1,2,3,4,5,6,7]::smallint[]);
    alter table public.matches drop constraint if exists matches_trip_id_request_id_key;
    alter table public.matches add constraint matches_trip_request_date_key unique (trip_id, request_id, ride_date);
  end if;
end $$;

create or replace function public.occurs_on(p_date date, p_base date, p_days smallint[]) returns boolean
language sql immutable as $$
  select p_date = p_base
      or (coalesce(cardinality(p_days), 0) > 0 and p_date > p_base and extract(isodow from p_date)::smallint = any(p_days))
$$;

-- Dates must be within the booking window (30 days ahead; one day of slack for time zones).
create or replace function public.check_trip_date() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.trip_date is distinct from old.trip_date then
    if new.trip_date < current_date - 1 or new.trip_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  end if;
  return new;
end $$;
create or replace function public.check_request_date() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.ride_date is distinct from old.ride_date then
    if new.ride_date < current_date - 1 or new.ride_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trips_date_check on public.trips;
create trigger trips_date_check before insert or update on public.trips for each row execute function public.check_trip_date();
drop trigger if exists requests_date_check on public.ride_requests;
create trigger requests_date_check before insert or update on public.ride_requests for each row execute function public.check_request_date();
drop function if exists public.check_booking_date();

-- Seat request, now for one specific date.
drop function if exists public.request_seat(uuid, uuid, text, integer);
create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_points integer, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; max_pts integer; direct double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
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

-- Driver accepts or declines (a ride whose date has passed cannot be accepted).
create or replace function public.respond_match(p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; bal integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < m.points then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - m.points where user_id = m.rider_id;
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values
      (m.rider_id, -m.points, 'Ride paid with points', m.id),
      (m.driver_id, m.points, 'Earned giving a ride', m.id);
  end if;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;

revoke all on function public.request_seat(uuid, uuid, text, integer, date) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, integer, date) to authenticated;
revoke all on function public.respond_match(uuid, boolean) from public, anon;
grant execute on function public.respond_match(uuid, boolean) to authenticated;
