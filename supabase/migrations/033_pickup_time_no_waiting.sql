-- No waiting for riders anywhere, and every accepted rider gets a saved pickup time.
--   * Matching never lets a driver wait for a rider: max_wait is 0 on every trip (a rider whose window opens after the driver would arrive is not matched).
--   * When a seat is accepted, the server saves the rider's pickup time (matches.pickup_time) from the real route.
--   * "Rider isn't here" (mark_no_show) works as soon as the driver has arrived at the pickup, but never before the saved pickup time.
--   * A rider may cancel for free if the driver is more than 15 minutes past the pickup time and has not arrived.
-- Run once in the Supabase SQL editor (safe to run again).

alter table public.matches add column if not exists pickup_time timestamptz;

-- ---------- 1. No waiting in matching ----------
create or replace function public._fixed_wait() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.max_wait := 0;
  return new;
end $$;

alter table public.trips disable trigger freeze_booked_trips;
update public.trips set max_wait = 0 where max_wait is distinct from 0;
alter table public.trips enable trigger freeze_booked_trips;

-- ---------- 2. Time the car reaches each stop (the same driving times as _evaluate) ----------
create or replace function public._stop_times(p_stops public.route_stop[], p_depart double precision, p_wait double precision, p_dow integer)
returns double precision[]
language plpgsql stable as $$
declare t double precision := p_depart; i integer; s public.route_stop; prev public.route_stop; res double precision[] := '{}';
begin
  for i in 1 .. coalesce(array_length(p_stops, 1), 0) loop
    s := p_stops[i];
    if i > 1 then prev := p_stops[i - 1]; t := t + public._minutes(prev.lat, prev.lng, s.lat, s.lng, t, p_dow); end if;
    if s.kind = 'pickup' then t := t + greatest(0, s.rf - t); end if;
    res := res || t;
  end loop;
  return res;
end $$;

-- ---------- 3. Save the pickup time of one accepted seat ----------
create or replace function public._save_pickup_time(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; t public.trips; olat double precision; olng double precision; dlat double precision; dlng double precision; dow integer; depart double precision; vnow double precision;
  direct_min double precision; direct_km double precision; cap_min double precision; cap_km double precision;
  cur public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record; times double precision[]; i integer; at_min double precision := null; fallback timestamptz;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  select * into t from public.trips where id = m.trip_id;
  fallback := public.pickup_at(m.ride_date, t.depart_min);
  begin
    select coalesce(t.origin_lat, a.lat), coalesce(t.origin_lng, a.lng) into olat, olng from public.areas a where a.name = t.origin;
    select coalesce(t.dest_lat, a.lat), coalesce(t.dest_lng, a.lng) into dlat, dlng from public.areas a where a.name = t.dest;
    olat := coalesce(t.origin_lat, olat); olng := coalesce(t.origin_lng, olng); dlat := coalesce(t.dest_lat, dlat); dlng := coalesce(t.dest_lng, dlng);
    if olat is null or dlat is null then raise exception 'no area'; end if;
    dow := extract(dow from m.ride_date)::int;
    vnow := extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver');
    depart := case when t.live then vnow + 2 else t.depart_min end;
    direct_min := public._minutes(olat, olng, dlat, dlng, depart, dow);
    direct_km := public._road_km(olat, olng, dlat, dlng);
    cap_min := case when t.max_total_detour is null then t.max_detour else greatest(t.max_total_detour, t.max_detour) end;
    cap_km := case when t.max_total_detour_km is null and t.max_detour_km is null then null else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end;
    cur := array[(olat, olng, 'origin', null, 0, 0)::public.route_stop, (dlat, dlng, 'dest', null, 0, 0)::public.route_stop];
    for rec in
      select r.id as rid, r.ready_from, r.ready_to,
             coalesce(x.meet_lat, r.pickup_lat, pa.lat) as plat, coalesce(x.meet_lng, r.pickup_lng, pa.lng) as plng,
             coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
        from public.matches x join public.ride_requests r on r.id = x.request_id
        left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
       where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.dropped_off_at is null
       order by x.created_at, x.id
    loop
      pk := (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop;
      dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
      select * into b from public._best_insertion(cur, pk, dp, depart, t.max_wait, dow, direct_min, direct_km, cap_min, cap_km, true);
      if b.stops is null then raise exception 'no route'; end if;
      cur := b.stops;
    end loop;
    times := public._stop_times(cur, depart, t.max_wait, dow);
    for i in 1 .. coalesce(array_length(cur, 1), 0) loop
      if cur[i].kind = 'pickup' and cur[i].rid = m.request_id then at_min := times[i]; end if;
    end loop;
  exception when others then
    at_min := null;
  end;
  update public.matches set pickup_time = case when at_min is null then fallback
    else ((m.ride_date::timestamp + (ceil(at_min)::text || ' minutes')::interval) at time zone 'America/Vancouver') end
   where id = p_match;
end $$;
revoke all on function public._save_pickup_time(uuid) from public, anon, authenticated;

create or replace function public._after_accept() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    perform public._save_pickup_time(new.id);
  end if;
  return null;
end $$;
drop trigger if exists matches_save_pickup on public.matches;
create trigger matches_save_pickup after insert or update of status on public.matches for each row execute function public._after_accept();

-- Seats accepted before this change keep the trip's leave time as their pickup time
update public.matches m set pickup_time = public.pickup_at(m.ride_date, t.depart_min)
  from public.trips t where t.id = m.trip_id and m.pickup_time is null and m.status = 'accepted';

-- ---------- 4. "Rider isn't here": once the driver has arrived, and never before the rider's pickup time ----------
create or replace function public.mark_no_show(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'The rider was already picked up'; end if;
  select * into t from public.trips where id = m.trip_id;
  if m.arrived_at is null then
    raise exception 'Tap that you have arrived at the pickup first';
  end if;
  if now() < coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) then
    raise exception 'It is not the rider''s pickup time yet';
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Rider was not at the pickup (points kept)', m.id);
  end if;
  update public.matches set status = 'no_show', late = true, cancelled_at = now(), settled = true where id = p_match;
  return 'no_show';
end $$;
revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- ---------- 5. Cancelling: the pickup time is the rider's saved one; a driver more than 15 minutes past it (and not arrived) means a free cancel ----------
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
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  driver_is_late := is_rider and m.arrived_at is null and now() >= pk + interval '15 minutes';
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
revoke all on function public.cancel_ride(uuid) from public, anon;
grant execute on function public.cancel_ride(uuid) to authenticated;
