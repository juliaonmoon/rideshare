-- Migration 060: heads-up when the driver will be late. Run once in the Supabase SQL editor (safe to run again). Needs 006, 027, 059.
--
-- pickup_eta(match) gives the rider (or driver) how many minutes late the driver is predicted to be at the pickup spot
-- (negative or 0 = on time), from the driver's live position. It is an estimate and only exists while the driver is sharing their position.
-- cancel_ride: a rider can cancel for free, all points back, while that estimate says 3 or more minutes late.

create or replace function public._pickup_late_min(m public.matches) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t public.trips; r public.ride_requests; pk timestamptz; pos public.driver_positions; plat double precision; plng double precision; mins double precision;
        nowv timestamp := now() at time zone 'America/Vancouver';
begin
  if m.status <> 'accepted' or m.arrived_at is not null or m.picked_up_at is not null then return null; end if;
  select * into pos from public.driver_positions where driver_id = m.driver_id and updated_at > now() - interval '3 minutes';
  if pos.driver_id is null then return null; end if;
  select * into t from public.trips where id = m.trip_id;
  select * into r from public.ride_requests where id = m.request_id;
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  plat := coalesce(m.meet_lat, r.pickup_lat); plng := coalesce(m.meet_lng, r.pickup_lng);
  if plat is null or plng is null then select a.lat, a.lng into plat, plng from public.areas a where a.name = r.pickup; end if;
  if plat is null then return null; end if;
  mins := public._minutes(pos.lat, pos.lng, plat, plng, (extract(hour from nowv) * 60 + extract(minute from nowv))::double precision, extract(dow from nowv)::int);
  if mins is null then return null; end if;
  return round(extract(epoch from (now() + make_interval(secs => mins * 60) - pk)) / 60)::int;
exception when others then return null;
end $$;
revoke all on function public._pickup_late_min(public.matches) from public, anon, authenticated;

create or replace function public.pickup_eta(p_match uuid) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or auth.uid() is null or (m.rider_id <> auth.uid() and m.driver_id <> auth.uid()) then return null; end if;
  return public._pickup_late_min(m);
end $$;
revoke all on function public.pickup_eta(uuid) from public, anon;
grant execute on function public.pickup_eta(uuid) to authenticated;
create or replace function public.cancel_ride(p_match uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.matches; t public.trips; pk timestamptz; cutoff timestamptz; is_rider boolean; is_late boolean; driver_is_late boolean;
        keep integer := 0; refund integer := 0; result text;
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

  -- the driver is 5+ minutes past the pickup time and has not arrived: the rider leaves for free
  driver_is_late := is_rider and m.arrived_at is null and now() >= pk + interval '5 minutes';
  if driver_is_late then
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Driver was late (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), late = false, driver_late = true, settled = true, refunded = refund where id = p_match;
    return 'cancelled_driver_late';
  end if;

  -- the driver is on the way but the live estimate says 3+ minutes late: the rider can leave for free (an estimate is not a mark against the driver)
  if is_rider and coalesce(public._pickup_late_min(m), 0) >= 3 then
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Driver running late (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), late = false, settled = true, refunded = refund where id = p_match;
    return 'cancelled_running_late';
  end if;
  -- the driver's detour for this rider starts this many minutes before the pickup time (at least 3)
  cutoff := pk - make_interval(mins => greatest(coalesce(m.detour_min, 0), 3)::int);
  if is_rider then is_late := now() >= cutoff; else is_late := (pk - now()) < interval '2 hours'; end if;

  result := 'cancelled_full';
  if m.pay_with = 'points' and m.points > 0 then
    refund := m.points;
    if is_rider and is_late then keep := m.points; refund := 0; result := 'cancelled_kept'; end if;
    if refund > 0 then
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Ride cancelled (points returned)', m.id);
    end if;
    if keep > 0 then
      update public.wallets set points = points + keep where user_id = m.driver_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, keep, 'Late cancellation (points kept)', m.id);
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

