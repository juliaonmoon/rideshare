-- Migration 005: ride steps (run once in Supabase > SQL Editor, after 004).
-- The driver taps through: On my way -> Arrived -> Picked up -> Dropped off. Points are paid to the driver at Dropped off.
-- The rider can tap "I'm in the car" after pickup (a confirmation the driver can see; it does not move points).
-- Steps can be skipped forward (tapping Picked up fills in the earlier steps) but never backwards.
-- A ride can be started from 2 hours before pickup. Once picked up, it can no longer be cancelled or marked a no-show.
-- If a driver never taps Dropped off, the ride still completes automatically 3 hours after pickup (migration 004).
-- Safe to run twice.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'en_route_at') then
    alter table public.matches add column en_route_at timestamptz;
    alter table public.matches add column arrived_at timestamptz;
    alter table public.matches add column picked_up_at timestamptz;
    alter table public.matches add column dropped_off_at timestamptz;
    alter table public.matches add column rider_confirmed_at timestamptz;
  end if;
end $$;

create or replace function public.ride_step(p_match uuid, p_step text)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; rank integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  rank := case p_step when 'on_my_way' then 1 when 'arrived' then 2 when 'picked_up' then 3 when 'dropped_off' then 4 else 0 end;
  if rank = 0 then raise exception 'Unknown step'; end if;
  select * into t from public.trips where id = m.trip_id;
  pk := public.pickup_at(m.ride_date, t.depart_min);
  if now() < pk - interval '2 hours' then raise exception 'You can start this ride up to 2 hours before pickup'; end if;
  if (case when m.dropped_off_at is not null then 4 when m.picked_up_at is not null then 3 when m.arrived_at is not null then 2 when m.en_route_at is not null then 1 else 0 end) >= rank then
    raise exception 'That step is already done';
  end if;
  if rank = 4 and m.picked_up_at is null then raise exception 'Tap Picked up first'; end if;
  update public.matches set
    en_route_at = case when rank >= 1 then coalesce(en_route_at, now()) else en_route_at end,
    arrived_at = case when rank >= 2 then coalesce(arrived_at, now()) else arrived_at end,
    picked_up_at = case when rank >= 3 then coalesce(picked_up_at, now()) else picked_up_at end,
    dropped_off_at = case when rank >= 4 then now() else dropped_off_at end
  where id = p_match;
  if rank = 4 then
    if m.pay_with = 'points' and m.points > 0 then
      update public.wallets set points = points + m.points where user_id = m.driver_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.driver_id, m.points, 'Earned giving a ride', m.id);
    end if;
    update public.matches set status = 'completed', settled = true where id = p_match;
  end if;
  return p_step;
end $$;

create or replace function public.rider_in_car(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' or m.picked_up_at is null then raise exception 'The driver has not marked you as picked up yet'; end if;
  update public.matches set rider_confirmed_at = coalesce(rider_confirmed_at, now()) where id = p_match;
  return 'confirmed';
end $$;

-- cancel_ride and mark_no_show: same rules as migration 004, plus "no longer possible once picked up".
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
  if m.picked_up_at is not null then raise exception 'The ride has already started, so it can no longer be cancelled'; end if;
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

create or replace function public.mark_no_show(p_match uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'The rider was already picked up'; end if;
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

revoke all on function public.ride_step(uuid, text) from public, anon;
revoke all on function public.rider_in_car(uuid) from public, anon;
revoke all on function public.cancel_ride(uuid) from public, anon;
revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.ride_step(uuid, text) to authenticated;
grant execute on function public.rider_in_car(uuid) to authenticated;
grant execute on function public.cancel_ride(uuid) to authenticated;
grant execute on function public.mark_no_show(uuid) to authenticated;
