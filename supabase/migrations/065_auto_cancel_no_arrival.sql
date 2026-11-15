-- Driver never showed and never tapped Arrived: the ride closes itself 30 minutes after the pickup time.
--   * Rider gets all points back. The driver gets a "driver late" mark (counts in the reliability record).
--   * Only rides where the driver never tapped Arrived, nobody was picked up and the rider never confirmed being in the car.
--   * There is no timer job: the check runs whenever anyone opens the app (same way as expire_live).
-- Run once in the Supabase SQL editor (safe to run again).

create or replace function public.expire_missing_arrivals() returns integer
language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; n integer := 0; refund integer;
begin
  if auth.uid() is null then return 0; end if;
  for m in select * from public.matches where status = 'accepted' and arrived_at is null and picked_up_at is null and rider_confirmed_at is null
           and ride_date between current_date - 2 and current_date + 1 for update skip locked loop
    select * into t from public.trips where id = m.trip_id;
    if t.id is null then continue; end if;
    if now() < coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) + interval '30 minutes' then continue; end if;
    refund := 0;
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Driver never arrived (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = m.driver_id, cancelled_at = now(), late = false, driver_late = true, settled = true, refunded = refund,
      prop_time = null, prop_at = null where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_missing_arrivals() from public, anon;
grant execute on function public.expire_missing_arrivals() to authenticated;