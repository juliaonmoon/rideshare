-- A no-show can only be marked after the driver has arrived at the pickup and waited the full waiting time.
-- Run once in the Supabase SQL editor (safe to run again).

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
    raise exception 'Mark that you have arrived at the pickup first, then wait % minutes', t.max_wait;
  end if;
  if now() < m.arrived_at + (t.max_wait * interval '1 minute') then
    raise exception 'Wait % minutes after you arrived before marking a no-show', t.max_wait;
  end if;
  if now() < public.pickup_at(m.ride_date, t.depart_min) then
    raise exception 'It is not pickup time yet';
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Rider did not show (points kept)', m.id);
  end if;
  update public.matches set status = 'no_show', late = true, cancelled_at = now(), settled = true where id = p_match;
  return 'no_show';
end $$;

revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;
