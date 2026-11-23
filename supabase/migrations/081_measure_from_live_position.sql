-- 081: new riders are measured from where the car IS once the driver is on the road, and are not taken without a fresh position.
-- "On the road" = the leave time has passed, or Start trip / On my way was tapped, or it is a leave-now trip.
-- A position older than 2 minutes counts as no position: no new request is shown or alerted, and a seat cannot be requested (it is held, not lost).
-- Before the trip starts nothing changes (measured from the trip's start). Run once in Supabase > SQL Editor. Safe to run twice.

create or replace function public._needs_position(p_trip uuid, p_date date) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t public.trips; vnow double precision; underway boolean;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null or p_date <> (now() at time zone 'America/Vancouver')::date then return false; end if;
  vnow := extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver');
  underway := t.live
    or exists (select 1 from public.matches m where m.trip_id = p_trip and m.ride_date = p_date and m.status = 'accepted' and m.en_route_at is not null and m.dropped_off_at is null)
    or (not (t.flex_to is not null and not t.live and not coalesce(t.flex_locked, false)) and vnow >= t.depart_min);
  if not underway then return false; end if;
  return not exists (select 1 from public.driver_positions where driver_id = t.user_id and updated_at > now() - interval '2 minutes');
end $$;
revoke all on function public._needs_position(uuid, date) from public, anon, authenticated;

create or replace function public._quote_trip(p_trip uuid, p_date date, p_new uuid default null, p_live boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; olat double precision; olng double precision; dlat double precision; dlng double precision; dow integer; depart double precision; vnow double precision;
  direct_min double precision; direct_km double precision; cap_min double precision; cap_km double precision;
  cur public.route_stop[]; nxt public.route_stop[]; base public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record; ev record;
  n_acc integer := 0; base_detour double precision; base_detour_km double precision; added_min double precision; added_km double precision; total_min double precision; total_km double precision;
  source text := 'tables'; dep_ts timestamptz; lD jsonb; l0 jsonb; l1 jsonb; legkm double precision[] := '{}'; i integer; aboard uuid[] := '{}'; seg double precision; share double precision;
  pos public.driver_positions; underway boolean := false; started boolean := false; flex_free boolean; fr record; foff double precision; lo double precision;
  total_cost double precision := 0; driver_share double precision := 0; owed jsonb := '{}'::jsonb; shares jsonb := '[]'::jsonb; fin public.route_stop[]; prev public.route_stop; cur_s public.route_stop; new_dollars double precision;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'trip'); end if;
  select coalesce(t.origin_lat, a.lat), coalesce(t.origin_lng, a.lng) into olat, olng from public.areas a where a.name = t.origin;
  select coalesce(t.dest_lat, a.lat), coalesce(t.dest_lng, a.lng) into dlat, dlng from public.areas a where a.name = t.dest;
  olat := coalesce(t.origin_lat, olat); olng := coalesce(t.origin_lng, olng); dlat := coalesce(t.dest_lat, dlat); dlng := coalesce(t.dest_lng, dlng);
  if olat is null or dlat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
  dow := extract(dow from p_date)::int;
  vnow := extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver');
  -- A trip with a time window ("leave between 8 and 2") has no fixed leave time until the first rider is accepted.
  -- For a rider asking for a seat, the driver leaves as early as the window and "not before now" allow, but late enough to reach the pickup when the rider is ready.
  flex_free := t.flex_to is not null and not t.live and not coalesce(t.flex_locked, false);
  depart := case when t.live then vnow + 2 when flex_free then t.flex_from else t.depart_min end;
  -- Once the driver is on the road (leave time passed, or Start trip / On my way tapped, or a leave-now trip), the route starts
  -- from where the car is, not from the trip's start. Without a fresh position (under 2 minutes old) no new rider is taken.
  if p_date = (now() at time zone 'America/Vancouver')::date then
    started := exists (select 1 from public.matches m where m.trip_id = p_trip and m.ride_date = p_date and m.status = 'accepted' and m.en_route_at is not null and m.dropped_off_at is null);
    underway := t.live or started or (not flex_free and vnow >= t.depart_min);
  end if;
  if underway then
    select * into pos from public.driver_positions where driver_id = t.user_id and updated_at > now() - interval '2 minutes';
    if pos.driver_id is null then
      if p_new is not null then return jsonb_build_object('ok', false, 'reason', 'no_position'); end if;
    else
      olat := pos.lat; olng := pos.lng; depart := vnow;
    end if;
  end if;
  if flex_free and p_new is not null then
    select r.ready_from, r.ready_to, coalesce(r.pickup_lat, pa.lat) as plat, coalesce(r.pickup_lng, pa.lng) as plng into fr
      from public.ride_requests r left join public.areas pa on pa.name = r.pickup where r.id = p_new;
    if fr.plat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
    lo := t.flex_from;
    if p_date = (now() at time zone 'America/Vancouver')::date then lo := greatest(lo, ceil(vnow) + 2); end if;
    foff := public._minutes(olat, olng, fr.plat, fr.plng, lo, dow);
    depart := greatest(lo, ceil(fr.ready_from - foff));
    if depart > t.flex_to or depart + foff > fr.ready_to + 1e-9 then return jsonb_build_object('ok', false, 'reason', 'window'); end if;
  end if;
  direct_min := public._minutes(olat, olng, dlat, dlng, depart, dow);
  direct_km := public._road_km(olat, olng, dlat, dlng);
  cap_min := case when t.max_total_detour is null then t.max_detour else greatest(t.max_total_detour, t.max_detour) end;
  cap_km := case when t.max_total_detour_km is null and t.max_detour_km is null then null else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end;
  base := array[(olat, olng, 'origin', null, 0, 0)::public.route_stop, (dlat, dlng, 'dest', null, 0, 0)::public.route_stop];
  cur := base;
  for rec in
    select r.id as rid, r.ready_from, r.ready_to, (m.picked_up_at is not null) as aboard_now,
           coalesce(m.meet_lat, r.pickup_lat, pa.lat) as plat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as plng,
           coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
      from public.matches m join public.ride_requests r on r.id = m.request_id
      left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
     where m.trip_id = p_trip and m.ride_date = p_date and m.status = 'accepted' and m.dropped_off_at is null
     order by m.created_at, m.id
  loop
    n_acc := n_acc + 1;
    -- a rider already in the car: their pickup is where the car is now
    pk := case when underway and rec.aboard_now then (olat, olng, 'pickup', rec.rid, 0, 1440)::public.route_stop else (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop end;
    dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
    select * into b from public._best_insertion(cur, pk, dp, depart, t.max_wait, dow, direct_min, direct_km, cap_min, cap_km, true);
    if b.stops is null then return jsonb_build_object('ok', false, 'reason', 'route'); end if;
    cur := b.stops;
  end loop;
  select * into ev from public._evaluate(cur, depart, t.max_wait, dow);
  base_detour := ev.total_min - direct_min; base_detour_km := public._route_km(cur) - direct_km;
  fin := cur; total_min := ev.total_min; total_km := public._route_km(cur); added_min := 0; added_km := 0;

  if p_new is not null then
    if n_acc >= coalesce(t.max_pickups, 3) then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
    select r.id as rid, r.ready_from, r.ready_to, coalesce(r.pickup_lat, pa.lat) as plat, coalesce(r.pickup_lng, pa.lng) as plng, coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
      into rec from public.ride_requests r left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff where r.id = p_new;
    if rec.rid is null or rec.plat is null or rec.qlat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
    pk := (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop;
    dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
    select * into b from public._best_insertion(cur, pk, dp, depart, t.max_wait, dow, direct_min, direct_km, cap_min, cap_km, false);
    if b.stops is null then return jsonb_build_object('ok', false, 'reason', 'fit'); end if;
    added_min := b.detour - base_detour; added_km := b.detour_km - base_detour_km;
    if added_min > t.max_detour + 1e-9 then return jsonb_build_object('ok', false, 'reason', 'fit_one'); end if;
    if t.max_detour_km is not null and added_km > t.max_detour_km + 1e-9 then return jsonb_build_object('ok', false, 'reason', 'fit_one_km'); end if;
    fin := b.stops; total_min := b.total_min; total_km := public._route_km(fin);
  end if;

  -- live traffic for the real answer (when it is switched on and under the cap); the order of stops is the one chosen above
  if p_live then
    dep_ts := ((p_date::timestamp + (depart::text || ' minutes')::interval) at time zone 'America/Vancouver');
    lD := public._live_route(base, dep_ts);
    if lD is not null then
      l0 := case when n_acc = 0 then lD else public._live_route(cur, dep_ts) end;
      l1 := case when p_new is null then l0 else public._live_route(fin, dep_ts) end;
      if l0 is not null and l1 is not null then
        source := 'live';
        added_min := case when p_new is null then 0 else (l1->>'minutes')::double precision - (l0->>'minutes')::double precision end;
        added_km := case when p_new is null then 0 else (l1->>'km')::double precision - (l0->>'km')::double precision end;
        total_min := (l1->>'minutes')::double precision; total_km := (l1->>'km')::double precision;
        if p_new is not null then
          if added_min > t.max_detour + 1e-9 or (t.max_detour_km is not null and added_km > t.max_detour_km + 1e-9) then return jsonb_build_object('ok', false, 'reason', 'fit_one', 'source', 'live'); end if;
          if ((l1->>'minutes')::double precision - (lD->>'minutes')::double precision) > cap_min + 1e-9
             or (cap_km is not null and ((l1->>'km')::double precision - (lD->>'km')::double precision) > cap_km + 1e-9) then return jsonb_build_object('ok', false, 'reason', 'fit', 'source', 'live'); end if;
        end if;
        select array_agg(x::text::double precision order by ord) into legkm from jsonb_array_elements(l1->'legs') with ordinality as e(x, ord);
      end if;
    end if;
  end if;

  -- fair split: each stretch of road is shared equally by everyone in the car, the driver included
  for i in 2 .. array_length(fin, 1) loop
    prev := fin[i - 1]; cur_s := fin[i];
    if prev.kind = 'pickup' then aboard := aboard || prev.rid; end if;
    if prev.kind = 'dropoff' then aboard := array_remove(aboard, prev.rid); end if;
    seg := (case when source = 'live' then legkm[i - 1] else public._road_km(prev.lat, prev.lng, cur_s.lat, cur_s.lng) end) * t.cost_per_km;
    share := seg / (coalesce(array_length(aboard, 1), 0) + 1);
    total_cost := total_cost + seg; driver_share := driver_share + share;
    if coalesce(array_length(aboard, 1), 0) > 0 then
      for rec in select unnest(aboard) as rid loop
        owed := jsonb_set(owed, array[rec.rid::text], to_jsonb(coalesce((owed->>(rec.rid::text))::double precision, 0) + share));
      end loop;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('request_id', k, 'dollars', round(v::numeric, 4))), '[]'::jsonb) into shares from jsonb_each_text(owed) as e(k, v) where v is not null;
  new_dollars := case when p_new is null then null else coalesce((owed->>(p_new::text))::double precision, 0) end;
  return jsonb_build_object('ok', true, 'source', source, 'added_min', round(added_min::numeric, 2), 'added_km', round(added_km::numeric, 3),
    'total_min', round(total_min::numeric, 2), 'total_km', round(total_km::numeric, 3), 'shares', shares, 'total_cost', round(total_cost::numeric, 4),
    'depart', depart, 'driver_share', round(driver_share::numeric, 4), 'new_dollars', case when new_dollars is null then null else round(new_dollars::numeric, 4) end);
end $$;
revoke all on function public._quote_trip(uuid, date, uuid, boolean) from public, anon, authenticated;

create or replace function public._reachable(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; pl jsonb; off double precision; rt double precision; vnow double precision; tt public.trips;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return true; end if;
  -- a trip with a time window: the request must fit the leave time (or the window, if no rider is accepted yet)
  select * into tt from public.trips where id = m.trip_id;
  if public._needs_position(m.trip_id, m.ride_date) then return false; end if;   -- on the road with no fresh position: do not take new riders
  if tt.flex_to is not null and not tt.live then
    return coalesce((public._quote_trip(m.trip_id, m.ride_date, m.request_id, false)->>'ok')::boolean, false);
  end if;
  pl := public._live_plan(m.trip_id, m.ride_date, m.request_id);
  if not coalesce((pl->>'ok')::boolean, false) then return true; end if;
  off := (pl->'offsets'->>(m.request_id::text))::double precision;
  rt := (pl->'ready_to'->>(m.request_id::text))::double precision;
  vnow := (pl->>'vnow')::double precision;
  if off is null or rt is null then return true; end if;
  return rt - off >= vnow - 0.5;
end $$;
revoke all on function public._reachable(uuid) from public, anon, authenticated;
