-- A seat request the driver can no longer reach inside the rider's ready time ("too late to reach them") is not shown and not announced.
--   * _reachable(match): the rider's ready-until time minus the drive to them is still ahead of now (live offers only; scheduled trips are always reachable).
--   * request_fits(match) now means: inside the detour limits AND still reachable.
--   * The phone check (driver_alerts_token) leaves unreachable requests out of its pending list.
-- Needs migrations 034 and 036. Run once in the Supabase SQL editor (safe to run again).

create or replace function public._reachable(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; pl jsonb; off double precision; rt double precision; vnow double precision;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return true; end if;
  pl := public._live_plan(m.trip_id, m.ride_date, m.request_id);
  if not coalesce((pl->>'ok')::boolean, false) then return true; end if;
  off := (pl->'offsets'->>(m.request_id::text))::double precision;
  rt := (pl->'ready_to'->>(m.request_id::text))::double precision;
  vnow := (pl->>'vnow')::double precision;
  if off is null or rt is null then return true; end if;
  return rt - off >= vnow - 0.5;
end $$;
revoke all on function public._reachable(uuid) from public, anon, authenticated;

create or replace function public.request_fits(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or m.driver_id is distinct from auth.uid() then raise exception 'Not your ride'; end if;
  return public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id) and public._reachable(m.id);
end $$;
revoke all on function public.request_fits(uuid) from public, anon;
grant execute on function public.request_fits(uuid) to authenticated;

create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; lv jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
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
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at, m.detour_min, m.detour_km,
      coalesce(a.sum_min, 0) + coalesce(m.detour_min, 0) as total_min, coalesce(a.sum_km, 0) + coalesce(m.detour_km, 0) as total_km,
      greatest(coalesce(t.max_total_detour, t.max_detour), t.max_detour) as limit_min,
      case when t.max_detour_km is null and t.max_total_detour_km is null then null
           else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end as limit_km,
      public._leave_json(m.id) as leave
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    join public.trips t on t.id = m.trip_id
    left join public.profiles p on p.id = m.rider_id
    left join lateral (select sum(x.detour_min) as sum_min, sum(x.detour_km) as sum_km from public.matches x
                       where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status in ('accepted','completed')) a on true
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
      and public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id)
      and public._reachable(m.id)
    order by m.created_at desc limit 5) x;
  select coalesce(jsonb_agg(y order by y.en_route_at), '[]'::jsonb) into rides from (
    select m.id, coalesce(p.display_name, 'Rider') as name, m.en_route_at,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived' else 'on_my_way' end as stage,
      coalesce(r.pickup_label, r.pickup) as pickup_name, coalesce(r.dropoff_label, r.dropoff) as dropoff_name,
      coalesce(m.meet_lat, r.pickup_lat, pa.lat) as pickup_lat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as pickup_lng, m.meet_note,
      coalesce(r.dropoff_lat, da.lat) as dropoff_lat, coalesce(r.dropoff_lng, da.lng) as dropoff_lng,
      (m.meet_lat is not null or r.pickup_lat is not null) as pickup_exact, (r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  -- accepted riders on a live offer whose driver has not set off yet, with the time the driver must leave by (empty once the driver is moving)
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'leave_by_ms', z.ms)), '[]'::jsonb) into lv from (
    select m.id, coalesce(p.display_name, 'Rider') as name, (public._leave_json(m.id)->>'leave_by_ms')::bigint as ms
    from public.matches m
    join public.trips t on t.id = m.trip_id and t.live and t.active
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, true) = false
    limit 6) z where z.ms is not null;
  -- where the driver is heading today (the newest active trip), so the phone can end the trip on arrival
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public.occurs_on(today, t.trip_date, t.repeat_days)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides, 'leave', lv, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;
