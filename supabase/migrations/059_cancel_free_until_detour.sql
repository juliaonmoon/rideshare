-- Migration 059: new cancellation rule. Run once in the Supabase SQL editor (safe to run again). Needs migrations 033 and 020.
--
-- A rider can always press Cancel (until the ride has started). What changes is whether the points come back:
--   * Before the driver's detour starts (pickup time minus the minutes this rider adds to the drive, at least 3 minutes): free, all points back.
--   * Once the detour has started (or the pickup time has passed): the driver keeps all the points (they already spent the time), and it shows as a late cancel.
--   * If the driver is 5+ minutes past the pickup time and has not arrived: free, all points back, and it shows on the driver's record.
-- Replaces the old rules: the 2-hour window, the one free late cancel a month, "no cancelling after the pickup time" and the 15-minute wait.
-- The seat opens up again for other riders straight away (a cancelled ride no longer counts as a pickup).
-- The driver's own cancel is unchanged: the rider gets everything back and it shows on the driver's record.

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
