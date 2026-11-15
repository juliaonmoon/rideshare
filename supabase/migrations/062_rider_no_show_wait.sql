-- Rider no-show, step 1: a short wait before "Rider isn't here", and an "I'm here" button for the rider.
--   * The driver can mark a no-show only 5 minutes after tapping Arrived (and never before the pickup time).
--   * The rider can tap "I'm here" (from 30 minutes before pickup). If they did, the wait is 10 minutes
--     and a no-show is flagged "disputed" so the team can review it. The driver can still close the ride.
-- Run once in the Supabase SQL editor (safe to run again).

alter table public.matches add column if not exists rider_here_at timestamptz;
alter table public.matches add column if not exists no_show_disputed boolean not null default false;

create or replace function public.rider_here(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'You were already picked up'; end if;
  select * into t from public.trips where id = m.trip_id;
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  if now() < pk - interval '30 minutes' then raise exception 'It is too early to say you are here'; end if;
  if m.rider_here_at is null then
    update public.matches set rider_here_at = now() where id = p_match;
  end if;
  return 'ok';
end $$;
revoke all on function public.rider_here(uuid) from public, anon;
grant execute on function public.rider_here(uuid) to authenticated;

create or replace function public.mark_no_show(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; wait_min integer; disputed boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'The rider was already picked up'; end if;
  select * into t from public.trips where id = m.trip_id;
  if m.arrived_at is null then
    raise exception 'Tap that you have arrived at the pickup first';
  end if;
  disputed := m.rider_here_at is not null;
  wait_min := case when disputed then 10 else 5 end;
  if now() < m.arrived_at + make_interval(mins => wait_min) then
    raise exception 'Wait % minutes after you arrived before closing this as a missed pickup', wait_min;
  end if;
  if now() < coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) then
    raise exception 'It is not the rider''s pickup time yet';
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Rider was not at the pickup (points kept)', m.id);
  end if;
  update public.matches set status = 'no_show', late = true, cancelled_at = now(), settled = true, no_show_disputed = disputed where id = p_match;
  return case when disputed then 'no_show_disputed' else 'no_show' end;
end $$;
revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;