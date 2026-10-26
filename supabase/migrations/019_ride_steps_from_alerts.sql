-- Migration 019: update a ride step (Arrived / Picked up / Dropped off) from a phone notification button
-- (run once in Supabase > SQL Editor, after 018). Safe to run twice.
--
-- While the driver is in Google Maps, the RideShare phone helper shows a notification with one big button per step, so the driver never
-- has to switch apps. This adds what the helper needs:
--   * ride_step_token(token, match, step): the same rules as the app's ride_step, using the short-lived tracking token.
--     Pressing a button twice is harmless (it answers "already_done").
--   * driver_alerts_token now also lists the riders on the way (stage and the pickup / drop-off points), so the helper can show the
--     right button and notice when the car arrives near a stop.

-- 1. one set of rules for the app and for the phone helper
create or replace function public._ride_step(p_driver uuid, p_match uuid, p_step text, p_quiet boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; rank integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then
    if p_quiet and m.status = 'completed' then return 'already_done'; end if;
    raise exception 'This ride is %', m.status;
  end if;
  rank := case p_step when 'on_my_way' then 1 when 'arrived' then 2 when 'picked_up' then 3 when 'dropped_off' then 4 else 0 end;
  if rank = 0 then raise exception 'Unknown step'; end if;
  select * into t from public.trips where id = m.trip_id;
  pk := public.pickup_at(m.ride_date, t.depart_min);
  if now() < pk - interval '2 hours' then raise exception 'You can start this ride up to 2 hours before pickup'; end if;
  if (case when m.dropped_off_at is not null then 4 when m.picked_up_at is not null then 3 when m.arrived_at is not null then 2 when m.en_route_at is not null then 1 else 0 end) >= rank then
    if p_quiet then return 'already_done'; end if;
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
revoke all on function public._ride_step(uuid, uuid, text, boolean) from public, anon, authenticated;

create or replace function public.ride_step(p_match uuid, p_step text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return public._ride_step(auth.uid(), p_match, p_step, false);
end $$;
revoke all on function public.ride_step(uuid, text) from public, anon;
grant execute on function public.ride_step(uuid, text) to authenticated;

create or replace function public.ride_step_token(p_token text, p_match uuid, p_step text)
returns text language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  return public._ride_step(d, p_match, p_step, true);
end $$;
revoke all on function public.ride_step_token(text, uuid, text) from public;
grant execute on function public.ride_step_token(text, uuid, text) to anon, authenticated;

-- 2. the driver's alert check also lists the riders on the way
create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public.occurs_on(today, t.trip_date, t.repeat_days));
  -- Test mode: about every 2 minutes, while nothing is waiting, a made-up rider asks (it appears 20 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '2 minutes'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 20);
      update public.test_accounts set last_test_at = now() where user_id = d;
    exception when others then null;   -- never let a test problem break the real alert check
    end;
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
    order by m.created_at desc limit 5) x;
  -- riders on the way: where to pick up and drop off (the exact point if the rider gave one, else the middle of the neighbourhood)
  select coalesce(jsonb_agg(y order by y.en_route_at), '[]'::jsonb) into rides from (
    select m.id, coalesce(p.display_name, 'Rider') as name, m.en_route_at,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived' else 'on_my_way' end as stage,
      coalesce(r.pickup_label, r.pickup) as pickup_name, coalesce(r.dropoff_label, r.dropoff) as dropoff_name,
      coalesce(r.pickup_lat, pa.lat) as pickup_lat, coalesce(r.pickup_lng, pa.lng) as pickup_lng,
      coalesce(r.dropoff_lat, da.lat) as dropoff_lat, coalesce(r.dropoff_lng, da.lng) as dropoff_lng,
      (r.pickup_lat is not null) as pickup_exact, (r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;
