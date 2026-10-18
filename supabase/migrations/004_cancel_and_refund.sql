-- Migration 004: cancellations, refunds, no-shows and points held until the ride (run once in Supabase > SQL Editor, after 003).
-- Policy (modelled on Uber Reserve, BlaBlaCar and Scoop, adapted to points):
--   * Before the driver accepts: the rider can cancel any time, free (no points had moved).
--   * Points are HELD when the driver accepts (taken from the rider, not yet given to the driver) and paid to the driver
--     3 hours after the pickup time, if the ride was not cancelled.
--   * Rider cancels more than 2 hours before pickup: all points back.
--   * Rider cancels within 2 hours of pickup: the first such late cancel each calendar month is forgiven (all points back);
--     after that the driver keeps half (rounded down) and the rider gets the rest back.
--   * Rider cannot cancel after the pickup time. If the rider never shows, the driver can mark a no-show after waiting
--     their wait time, and gets all the points.
--   * Driver cancels (any time before the ride is paid out): the rider gets all points back.
--   * Cash rides: no points move; cancelling only records the status.
-- All times use America/Vancouver. Safe to run twice.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'cancelled_by') then
    alter table public.matches add column cancelled_by uuid references auth.users(id) on delete set null;
    alter table public.matches add column cancelled_at timestamptz;
    alter table public.matches add column late boolean not null default false;
    alter table public.matches add column settled boolean not null default false;
    alter table public.matches add column refunded integer not null default 0;
    alter table public.matches drop constraint if exists matches_status_check;
    alter table public.matches add constraint matches_status_check
      check (status in ('requested','accepted','declined','cancelled','completed','no_show'));
  end if;
end $$;

-- The pickup moment of a trip on a given date, in Vancouver time.
create or replace function public.pickup_at(p_date date, p_min integer) returns timestamptz
language sql immutable as $$
  select (p_date + (p_min * interval '1 minute')) at time zone 'America/Vancouver'
$$;

-- Driver accepts or declines. Accepting with points HOLDS the points (rider is charged now, driver is paid after the ride).
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
    insert into public.ledger (user_id, delta, reason, match_id)
      values (m.rider_id, -m.points, 'Ride paid with points (held until the ride)', m.id);
  end if;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;

-- Pay drivers for rides that have happened (3 hours after pickup). Called by the app when it loads; safe to repeat.
create or replace function public.settle_due() returns integer
language plpgsql security definer set search_path = public as $$
declare m record; n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  for m in
    select ma.id, ma.driver_id, ma.points, ma.pay_with
    from public.matches ma join public.trips t on t.id = ma.trip_id
    where ma.status = 'accepted' and not ma.settled
      and (ma.driver_id = auth.uid() or ma.rider_id = auth.uid())
      and public.pickup_at(ma.ride_date, t.depart_min) + interval '3 hours' < now()
    for update of ma
  loop
    if m.pay_with = 'points' and m.points > 0 then
      update public.wallets set points = points + m.points where user_id = m.driver_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Earned giving a ride', m.id);
    end if;
    update public.matches set status = 'completed', settled = true where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Cancel a request or an accepted ride (rider or driver).
create or replace function public.cancel_ride(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; is_rider boolean; is_late boolean;
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
  select * into t from public.trips where id = m.trip_id;
  pk := public.pickup_at(m.ride_date, t.depart_min);
  if is_rider and now() >= pk then raise exception 'The pickup time has passed, so this ride can no longer be cancelled'; end if;
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

-- Driver marks a no-show after waiting their wait time; the driver keeps all the points.
create or replace function public.mark_no_show(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  select * into t from public.trips where id = m.trip_id;
  if now() < public.pickup_at(m.ride_date, t.depart_min) + (t.max_wait * interval '1 minute') then
    raise exception 'Wait until % minutes after the pickup time before marking a no-show', t.max_wait;
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Rider did not show (points kept)', m.id);
  end if;
  update public.matches set status = 'no_show', late = true, cancelled_at = now(), settled = true where id = p_match;
  return 'no_show';
end $$;

-- Counts only (no details) of recent cancellations, so people can see reliability next to a name.
create or replace view public.reliability as
select p.id as user_id,
  (select count(*) from public.matches m where m.rider_id = p.id and m.late and m.cancelled_by = m.rider_id and m.cancelled_at > now() - interval '30 days')::int as late_cancels,
  (select count(*) from public.matches m where m.rider_id = p.id and m.status = 'no_show' and m.cancelled_at > now() - interval '30 days')::int as no_shows,
  (select count(*) from public.matches m where m.driver_id = p.id and m.status = 'cancelled' and m.cancelled_by = m.driver_id and m.cancelled_at > now() - interval '30 days')::int as driver_cancels
from public.profiles p;
revoke all on public.reliability from anon;
grant select on public.reliability to authenticated;

revoke all on function public.settle_due() from public, anon;
revoke all on function public.cancel_ride(uuid) from public, anon;
revoke all on function public.mark_no_show(uuid) from public, anon;
revoke all on function public.respond_match(uuid, boolean) from public, anon;
grant execute on function public.settle_due() to authenticated;
grant execute on function public.cancel_ride(uuid) to authenticated;
grant execute on function public.mark_no_show(uuid) to authenticated;
grant execute on function public.respond_match(uuid, boolean) to authenticated;
