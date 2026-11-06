-- Migration 046: several trips, smarter auto-accept, regular (repeating) rides that match themselves, and ending a regular booking.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 027, 029, 042 first.
--
--  1. Each trip can have its own "accept riders automatically" switch (empty = follow the driver's setting).
--     Auto-accept now fills the car: every rider who still fits the driver's limits is accepted, until a limit is reached.
--     Riders who do not fit are never shown to the driver (unchanged).
--  2. Regular rides: when a repeating trip and a repeating request have been accepted once, the next days
--     (the coming week) are booked by themselves. A driver or rider can skip a day (cancel that day) or end the regular booking.
--  3. Blocking a person also cancels the rides already booked with them for the coming days (points go back) and ends the regular booking.

alter table public.trips add column if not exists auto_accept boolean;

-- ---------- regular bookings that were ended ----------
create table if not exists public.series_off (
  trip_id uuid not null references public.trips(id) on delete cascade,
  request_id uuid not null references public.ride_requests(id) on delete cascade,
  stopped_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, request_id)
);
alter table public.series_off enable row level security;
drop policy if exists "series_off read own" on public.series_off;
create policy "series_off read own" on public.series_off for select to authenticated using (
  stopped_by = auth.uid()
  or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  or exists (select 1 from public.ride_requests r where r.id = request_id and r.user_id = auth.uid()));
revoke insert, update, delete on public.series_off from anon, authenticated;

-- ---------- asking for a seat, usable for a named rider (the regular rides use it) ----------
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
  if not public.occurs_on(p_date, t.trip_date, t.repeat_days) or not public.occurs_on(p_date, r.ride_date, r.repeat_days) then
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

create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return public._request_seat_as(auth.uid(), p_trip, p_request, p_pay_with, p_date);
end $$;
revoke all on function public.request_seat(uuid, uuid, text, date) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, date) to authenticated;

-- ---------- 1. auto-accept: fill the car with every rider who fits ----------
create or replace function public.auto_accept_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.user_settings; t public.trips; on_ boolean;
begin
  if new.status <> 'requested' or new.ride_date < current_date - 1 then return new; end if;
  select * into t from public.trips where id = new.trip_id;
  select * into s from public.user_settings where user_id = new.driver_id;
  on_ := coalesce(t.auto_accept, s.d_auto_accept, false);
  if not on_ then return new; end if;
  -- the same full check as a hand accept: seats, detour limits, leave time, points. If it does not fit, nothing happens.
  begin
    perform public._respond_match(new.driver_id, new.id, true);
  exception when others then null;
  end;
  return new;
end $$;

-- ---------- 2. regular rides ----------
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
      if not public.occurs_on(d, t.trip_date, t.repeat_days) or not public.occurs_on(d, r.ride_date, r.repeat_days) then continue; end if;
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

-- End a regular booking: no more days are booked by themselves, and the coming days are cancelled (points go back).
create or replace function public.stop_series(p_trip uuid, p_request uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; x record; n integer := 0; today date := (now() at time zone 'America/Vancouver')::date;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.trips where id = p_trip;
  select * into r from public.ride_requests where id = p_request;
  if t.id is null or r.id is null or (t.user_id <> auth.uid() and r.user_id <> auth.uid()) then raise exception 'Not your booking'; end if;
  insert into public.series_off (trip_id, request_id, stopped_by) values (p_trip, p_request, auth.uid()) on conflict do nothing;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.matches where trip_id = p_trip and request_id = p_request and ride_date >= today and status in ('requested', 'accepted') and picked_up_at is null loop
    perform public._admin_cancel_match(x.id, 'the regular booking was ended');
    update public.matches set cancelled_by = auth.uid() where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stop_series(uuid, uuid) from public, anon;
grant execute on function public.stop_series(uuid, uuid) to authenticated;

-- ---------- 3. blocking someone also cancels the coming rides with them ----------
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
    select distinct trip_id, request_id, auth.uid() from public.matches
     where (driver_id = auth.uid() and rider_id = p_user) or (driver_id = p_user and rider_id = auth.uid())
    on conflict do nothing;
end $$;
revoke all on function public.block_person(uuid) from public, anon;
grant execute on function public.block_person(uuid) to authenticated;
