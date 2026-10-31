-- Migration 025: booking and payout integrity (from the second design and security review).
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 020 to 024 first.
--   * A ride is only paid out if the rider was really picked up; otherwise the held points go back to the rider. An open report pauses payout.
--   * Accepting a seat re-checks the trip and request are still on, locks the trip so two accepts cannot take the last seat,
--     and one rider can have only one confirmed seat per request and day.
--   * Cancel my trip / Cancel my request resolve every booked seat and refund in one step.
--   * A trip or request with a confirmed rider cannot be deleted, or have its route, time, payment or wait changed, behind the app's back.
--   * The waiting time at a pickup is 5 minutes on the server (test accounts excepted).
--   * Reports are filed through a function tied to a real ride (also for cancelled and no-show rides), with a daily limit.
--   * The meeting spot must stay within 2 km of the original pickup and cannot move once the driver is on the way.

-- ---------- 1. Payout only for rides that happened ----------
create or replace function public.settle_due() returns integer
language plpgsql security definer set search_path = public as $$
declare m record; n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  for m in
    select ma.id, ma.driver_id, ma.rider_id, ma.points, ma.pay_with, ma.picked_up_at
    from public.matches ma join public.trips t on t.id = ma.trip_id
    where ma.status = 'accepted' and not ma.settled
      and (ma.driver_id = auth.uid() or ma.rider_id = auth.uid())
      and public.pickup_at(ma.ride_date, t.depart_min) + interval '3 hours' < now()
      and not exists (select 1 from public.reports r where r.match_id = ma.id and r.resolved_at is null)   -- an open report pauses the payout
    for update of ma
  loop
    if m.picked_up_at is not null then
      if m.pay_with = 'points' and m.points > 0 then
        update public.wallets set points = points + m.points where user_id = m.driver_id;
        insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Earned giving a ride', m.id);
      end if;
      update public.matches set status = 'completed', settled = true where id = m.id;
    else
      -- nobody was picked up: give the held points back to the rider
      if m.pay_with = 'points' and m.points > 0 then
        update public.wallets set points = points + m.points where user_id = m.rider_id;
        insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, m.points, 'Refund: the ride did not happen', m.id);
      end if;
      update public.matches set status = 'cancelled', settled = true, cancelled_at = now(), refunded = m.points where id = m.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- 2. Accepting a seat: lock, re-check, one confirmed seat per request and day ----------
do $$ begin
  create unique index if not exists matches_one_accepted_per_request on public.matches (request_id, ride_date) where status = 'accepted';
exception when others then
  raise notice 'Could not create matches_one_accepted_per_request (duplicate accepted seats already exist). Resolve them, then run this file again.';
end $$;

create or replace function public._respond_match(p_driver uuid, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; r public.ride_requests; bal integer; taken integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  -- lock the shared trip so two accepts cannot both take the last seat, then re-check everything
  select * into t from public.trips where id = m.trip_id for update;
  if t.id is null or not t.active or (t.expires_at is not null and t.expires_at < now()) then raise exception 'This trip is no longer on'; end if;
  select * into r from public.ride_requests where id = m.request_id;
  if r.id is null or not r.active or (r.expires_at is not null and r.expires_at < now()) then raise exception 'This request is no longer active'; end if;
  if exists (select 1 from public.matches x where x.request_id = m.request_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id) then
    raise exception 'This rider already has a confirmed seat for that day';
  end if;
  select count(*) into taken from public.matches
    where trip_id = m.trip_id and ride_date = m.ride_date and status in ('accepted','completed') and id <> m.id;
  if taken >= coalesce(t.max_pickups, 3) then raise exception 'You already have % pickup(s) for this trip. Raise the limit on the trip to take more.', coalesce(t.max_pickups, 3); end if;
  if not public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id) then raise exception 'This request no longer fits your detour limits'; end if;
  if m.pay_with = 'points' and m.points > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < m.points then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - m.points where user_id = m.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id)
      values (m.rider_id, -m.points, 'Ride paid with points (held until the ride)', m.id);
  end if;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;
revoke all on function public._respond_match(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------- 3. Cancel a whole trip or request: every booked seat is resolved and refunded in one step ----------
create or replace function public.cancel_trip(p_trip uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.trips; x record; n integer := 0;
begin
  select * into t from public.trips where id = p_trip and user_id = auth.uid() for update;
  if t.id is null then raise exception 'Not your trip'; end if;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id, status from public.matches where trip_id = p_trip and status in ('requested', 'accepted') order by created_at loop
    if x.status = 'requested' then perform public._respond_match(auth.uid(), x.id, false); else perform public.cancel_ride(x.id); end if;
    n := n + 1;
  end loop;
  update public.trips set active = false where id = p_trip;
  return n;
end $$;
revoke all on function public.cancel_trip(uuid) from public, anon;
grant execute on function public.cancel_trip(uuid) to authenticated;

create or replace function public.cancel_request(p_request uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.ride_requests; x record; n integer := 0;
begin
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() for update;
  if r.id is null then raise exception 'Not your request'; end if;
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.matches where request_id = p_request and status in ('requested', 'accepted') order by created_at loop
    perform public.cancel_ride(x.id); n := n + 1;
  end loop;
  update public.ride_requests set active = false where id = p_request;
  return n;
end $$;
revoke all on function public.cancel_request(uuid) from public, anon;
grant execute on function public.cancel_request(uuid) to authenticated;

-- ---------- 4. A booked trip or request cannot be deleted or reshaped behind the app's back ----------
create or replace function public._freeze_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare booked boolean;
begin
  if coalesce(current_setting('app.cancel_ok', true), '') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'trips' then
    booked := exists (select 1 from public.matches m where m.trip_id = old.id and m.status = 'accepted' and m.dropped_off_at is null);
  else
    booked := exists (select 1 from public.matches m where m.request_id = old.id and m.status = 'accepted' and m.dropped_off_at is null);
  end if;
  if not booked then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then raise exception 'A rider has a confirmed seat. Use Cancel my trip / Cancel my request first.'; end if;
  if tg_table_name = 'trips' then
    if old.active and new.active is false then raise exception 'A rider has a confirmed seat. Use Cancel my trip so everyone is refunded.'; end if;
    if (new.depart_min, new.trip_date, new.origin, new.dest, new.origin_lat, new.origin_lng, new.dest_lat, new.dest_lng, new.max_wait, new.accepts, new.repeat_days)
       is distinct from (old.depart_min, old.trip_date, old.origin, old.dest, old.origin_lat, old.origin_lng, old.dest_lat, old.dest_lng, old.max_wait, old.accepts, old.repeat_days) then
      raise exception 'A rider has a confirmed seat. The route, time and payment can no longer be changed.';
    end if;
  else
    if old.active and new.active is false then raise exception 'You have a confirmed seat. Use Cancel my request so everything is refunded.'; end if;
    if (new.pickup, new.dropoff, new.pickup_lat, new.pickup_lng, new.dropoff_lat, new.dropoff_lng, new.ride_date, new.ready_from, new.ready_to, new.pays, new.repeat_days)
       is distinct from (old.pickup, old.dropoff, old.pickup_lat, old.pickup_lng, old.dropoff_lat, old.dropoff_lng, old.ride_date, old.ready_from, old.ready_to, old.pays, old.repeat_days) then
      raise exception 'You have a confirmed seat. The journey can no longer be changed.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists freeze_booked_trips on public.trips;
create trigger freeze_booked_trips before update or delete on public.trips for each row execute function public._freeze_booked();
drop trigger if exists freeze_booked_requests on public.ride_requests;
create trigger freeze_booked_requests before update or delete on public.ride_requests for each row execute function public._freeze_booked();

-- ---------- 5. The waiting time is 5 minutes on the server (test accounts keep what they set) ----------
create or replace function public._fixed_wait() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.test_accounts ta where ta.user_id = new.user_id) then new.max_wait := 5; end if;
  return new;
end $$;
drop trigger if exists fixed_wait_trips on public.trips;
create trigger fixed_wait_trips before insert or update on public.trips for each row execute function public._fixed_wait();

-- ---------- 6. Reports: through a function tied to a real ride, with a daily limit ----------
drop policy if exists "reports insert own" on public.reports;
revoke insert on public.reports from anon, authenticated;
do $$ begin
  alter table public.reports add constraint reports_match_fk foreign key (match_id) references public.matches(id) on delete set null;
exception when others then null;
end $$;

create or replace function public.report_problem(p_match uuid, p_reason text, p_details text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.matches; other uuid; rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or auth.uid() not in (m.driver_id, m.rider_id) then raise exception 'Not your ride'; end if;
  if m.status not in ('accepted', 'completed', 'cancelled', 'no_show') then raise exception 'You can report a problem once a seat has been accepted'; end if;
  if p_reason not in ('late_or_absent', 'unsafe', 'wrong_car_or_person', 'rude', 'payment', 'other') then raise exception 'Pick a reason'; end if;
  if (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have sent many reports today. Please wait, or contact support.';
  end if;
  other := case when auth.uid() = m.driver_id then m.rider_id else m.driver_id end;
  insert into public.reports (reporter_id, reported_id, match_id, reason, details)
    values (auth.uid(), other, p_match, p_reason, nullif(left(trim(coalesce(p_details, '')), 1000), '')) returning id into rid;
  return rid;
end $$;
revoke all on function public.report_problem(uuid, text, text) from public, anon;
grant execute on function public.report_problem(uuid, text, text) to authenticated;

-- ---------- 7. The meeting spot stays close to the pickup and cannot move once the driver is on the way ----------
create or replace function public.set_meet_spot(p_match uuid, p_lat double precision, p_lng double precision, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; r public.ride_requests; plat double precision; plng double precision; km double precision;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'You can set the meeting spot once the driver has accepted'; end if;
  if m.picked_up_at is not null then raise exception 'You have already been picked up'; end if;
  if m.en_route_at is not null then raise exception 'Your driver is already on the way, so the meeting spot can no longer move. Send a message instead.'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Pick a spot on the map'; end if;
  if p_lat is not null then
    if p_lat <> p_lat or p_lng <> p_lng or p_lat not between 48 and 55 or p_lng not between -130 and -120 then raise exception 'That spot is outside the area we cover'; end if;
    select * into r from public.ride_requests where id = m.request_id;
    select coalesce(r.pickup_lat, a.lat), coalesce(r.pickup_lng, a.lng) into plat, plng from public.areas a where a.name = r.pickup;
    plat := coalesce(r.pickup_lat, plat); plng := coalesce(r.pickup_lng, plng);
    if plat is not null and plng is not null then
      km := 6371 * 2 * asin(sqrt(power(sin(radians(p_lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - plng) / 2), 2)));
      if km > 2.0 then raise exception 'The meeting spot has to be within 2 km of your pickup address'; end if;
    end if;
  end if;
  update public.matches set meet_lat = p_lat, meet_lng = case when p_lat is null then null else p_lng end,
    meet_note = nullif(left(trim(coalesce(p_note, '')), 200), '') where id = p_match;
end $$;
revoke all on function public.set_meet_spot(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.set_meet_spot(uuid, double precision, double precision, text) to authenticated;
