-- "Leave by": for an Offer-a-ride-now trip, the driver is told when they must leave to reach a rider inside the rider's ready time.
--   * _live_plan: the drive times from where the driver is (fresh phone position, else the typed start) through the accepted riders and a rider
--     being considered. It also says whether the driver is already moving (fresh position that is driving speed or far from the typed start).
--   * leave_info(match): what the driver's request card shows ("Leave by 7:48" or "About 9 min to reach them").
--   * The saved pickup time of a live trip is based on that plan (leave-by plus the drive when the driver has not started, now plus the drive when moving).
--   * driver_alerts_token also sends the leave-by time of each request and the accepted riders still waiting for the driver to set off, so the phone can remind the driver.
-- Needs migration 033. Run once in the Supabase SQL editor (safe to run again).

-- ---------- 1. The plan ----------
create or replace function public._live_plan(p_trip uuid, p_date date, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; pos public.driver_positions; olat double precision; olng double precision; dlat double precision; dlng double precision;
  slat double precision; slng double precision; dow integer; vnow double precision; moving boolean := false;
  direct_min double precision; direct_km double precision; cur public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record;
  times double precision[]; i integer; offs jsonb := '{}'::jsonb; rts jsonb := '{}'::jsonb; lb double precision := null; v double precision;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null or not t.live then return jsonb_build_object('ok', false, 'reason', 'not_live'); end if;
  select coalesce(t.origin_lat, a.lat), coalesce(t.origin_lng, a.lng) into olat, olng from public.areas a where a.name = t.origin;
  select coalesce(t.dest_lat, a.lat), coalesce(t.dest_lng, a.lng) into dlat, dlng from public.areas a where a.name = t.dest;
  olat := coalesce(t.origin_lat, olat); olng := coalesce(t.origin_lng, olng); dlat := coalesce(t.dest_lat, dlat); dlng := coalesce(t.dest_lng, dlng);
  if olat is null or dlat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
  vnow := extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver');
  dow := extract(dow from p_date)::int;
  select * into pos from public.driver_positions where driver_id = t.user_id and updated_at > now() - interval '3 minutes';
  if pos.driver_id is not null then
    slat := pos.lat; slng := pos.lng;
    moving := coalesce(pos.speed, 0) >= 2.5 or public._road_km(pos.lat, pos.lng, olat, olng) > 0.5;
  else
    slat := olat; slng := olng;
  end if;
  direct_min := public._minutes(slat, slng, dlat, dlng, vnow, dow);
  direct_km := public._road_km(slat, slng, dlat, dlng);
  cur := array[(slat, slng, 'origin', null, 0, 0)::public.route_stop, (dlat, dlng, 'dest', null, 0, 0)::public.route_stop];
  for rec in
    select * from (
      select r.id as rid, r.ready_to, coalesce(x.meet_lat, r.pickup_lat, pa.lat) as plat, coalesce(x.meet_lng, r.pickup_lng, pa.lng) as plng,
             coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng, 0 as ord, x.created_at as ca
        from public.matches x join public.ride_requests r on r.id = x.request_id
        left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
       where x.trip_id = p_trip and x.ride_date = p_date and x.status = 'accepted' and x.picked_up_at is null and x.dropped_off_at is null
      union all
      select r.id, r.ready_to, coalesce(r.pickup_lat, pa.lat), coalesce(r.pickup_lng, pa.lng), coalesce(r.dropoff_lat, da.lat), coalesce(r.dropoff_lng, da.lng), 1, now()
        from public.ride_requests r left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
       where r.id = p_request
         and not exists (select 1 from public.matches x where x.trip_id = p_trip and x.request_id = r.id and x.ride_date = p_date and x.status = 'accepted')
    ) u order by u.ord, u.ca
  loop
    if rec.plat is null or rec.qlat is null then continue; end if;
    pk := (rec.plat, rec.plng, 'pickup', rec.rid, 0, 100000)::public.route_stop;
    dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
    select * into b from public._best_insertion(cur, pk, dp, vnow, 1e9, dow, direct_min, direct_km, 1e9, null, true);
    if b.stops is null then continue; end if;
    cur := b.stops;
    rts := rts || jsonb_build_object(rec.rid::text, rec.ready_to);
  end loop;
  times := public._stop_times(cur, vnow, 1e9, dow);
  for i in 1 .. coalesce(array_length(cur, 1), 0) loop
    if cur[i].kind = 'pickup' and rts ? (cur[i].rid::text) then
      offs := offs || jsonb_build_object(cur[i].rid::text, times[i] - vnow);
      v := (rts->>(cur[i].rid::text))::double precision - (times[i] - vnow);
      lb := case when lb is null then v else least(lb, v) end;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'moving', moving, 'leave_by_min', lb, 'offsets', offs, 'vnow', vnow, 'ready_to', rts);
end $$;
revoke all on function public._live_plan(uuid, date, uuid) from public, anon, authenticated;

-- ---------- 2. What the request card shows ----------
create or replace function public._leave_json(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.matches; pl jsonb; off double precision; rt double precision; lb double precision; ts timestamptz;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return null; end if;
  pl := public._live_plan(m.trip_id, m.ride_date, m.request_id);
  if not coalesce((pl->>'ok')::boolean, false) then return null; end if;
  off := (pl->'offsets'->>(m.request_id::text))::double precision;
  rt := (pl->'ready_to'->>(m.request_id::text))::double precision;
  if off is null then return null; end if;
  lb := (pl->>'leave_by_min')::double precision;
  ts := case when lb is null then null else ((m.ride_date::timestamp + (floor(lb)::text || ' minutes')::interval) at time zone 'America/Vancouver') end;
  return jsonb_build_object('ok', true, 'moving', (pl->>'moving')::boolean, 'offset_min', round(off::numeric, 1), 'ready_until_min', rt,
    'leave_by_min', case when lb is null then null else floor(lb) end, 'leave_by_at', ts,
    'leave_by_ms', case when ts is null then null else (extract(epoch from ts) * 1000)::bigint end);
end $$;
revoke all on function public._leave_json(uuid) from public, anon, authenticated;

create or replace function public.leave_info(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.matches where id = p_match;
  if d is null or d <> auth.uid() then raise exception 'Not your ride'; end if;
  return coalesce(public._leave_json(p_match), jsonb_build_object('ok', false));
end $$;
revoke all on function public.leave_info(uuid) from public, anon;
grant execute on function public.leave_info(uuid) to authenticated;

-- ---------- 3. The saved pickup time of a live trip comes from the plan ----------
create or replace function public._save_pickup_time(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; t public.trips; olat double precision; olng double precision; dlat double precision; dlng double precision; dow integer; depart double precision; vnow double precision;
  direct_min double precision; direct_km double precision; cap_min double precision; cap_km double precision;
  cur public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record; times double precision[]; i integer; at_min double precision := null; fallback timestamptz;
  pl jsonb; off double precision;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  select * into t from public.trips where id = m.trip_id;
  fallback := public.pickup_at(m.ride_date, t.depart_min);
  if t.live then
    begin
      pl := public._live_plan(m.trip_id, m.ride_date, null);
      if coalesce((pl->>'ok')::boolean, false) then
        off := (pl->'offsets'->>(m.request_id::text))::double precision;
        if off is not null then
          at_min := (case when (pl->>'moving')::boolean or (pl->>'leave_by_min') is null then (pl->>'vnow')::double precision
                          else greatest((pl->>'leave_by_min')::double precision, (pl->>'vnow')::double precision) end) + off;
        end if;
      end if;
    exception when others then at_min := null;
    end;
  end if;
  if at_min is null then
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
  end if;
  update public.matches set pickup_time = case when at_min is null then fallback
    else ((m.ride_date::timestamp + (ceil(at_min)::text || ' minutes')::interval) at time zone 'America/Vancouver') end
   where id = p_match;
end $$;
revoke all on function public._save_pickup_time(uuid) from public, anon, authenticated;

-- ---------- 4. The phone's check also carries the leave-by information ----------
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
