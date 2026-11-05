-- Migration 042: trips with a time window ("I can leave any time between 8 AM and 2 PM").
--   * A one-time trip can carry a window (flex_from .. flex_to). Until a rider is accepted it has no fixed leave time.
--   * A rider asking for a seat is matched if the driver can leave inside the window and still reach the pickup while the rider is ready.
--   * The first rider the driver accepts locks the trip: its leave time becomes the time worked out for that rider (flex_locked = true).
--     From then on it works like a normal scheduled trip, and later requests must fit that leave time (others are hidden).
--   * If every accepted rider cancels, the window opens again.
--   * The driver's request card and phone alert show "Leave by ..." for it; accepted riders get the usual leave-by reminders.
-- Needs migrations 034, 037 and 041. Run once in the Supabase SQL editor (safe to run again).

alter table public.trips add column if not exists flex_from integer, add column if not exists flex_to integer, add column if not exists flex_locked boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_flex_window_ok') then
    alter table public.trips add constraint trips_flex_window_ok check (
      flex_to is null or (flex_from is not null and flex_from >= 0 and flex_to <= 1439 and flex_to > flex_from
        and trip_date is not null and coalesce(array_length(repeat_days, 1), 0) = 0));
  end if;
end $$;

create or replace function public._quote_trip(p_trip uuid, p_date date, p_new uuid default null, p_live boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; olat double precision; olng double precision; dlat double precision; dlng double precision; dow integer; depart double precision; vnow double precision;
  direct_min double precision; direct_km double precision; cap_min double precision; cap_km double precision;
  cur public.route_stop[]; nxt public.route_stop[]; base public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record; ev record;
  n_acc integer := 0; base_detour double precision; base_detour_km double precision; added_min double precision; added_km double precision; total_min double precision; total_km double precision;
  source text := 'tables'; dep_ts timestamptz; lD jsonb; l0 jsonb; l1 jsonb; legkm double precision[] := '{}'; i integer; aboard uuid[] := '{}'; seg double precision; share double precision;
  flex_free boolean; fr record; foff double precision; lo double precision;
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
    select r.id as rid, r.ready_from, r.ready_to,
           coalesce(m.meet_lat, r.pickup_lat, pa.lat) as plat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as plng,
           coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
      from public.matches m join public.ride_requests r on r.id = m.request_id
      left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
     where m.trip_id = p_trip and m.ride_date = p_date and m.status = 'accepted' and m.dropped_off_at is null
     order by m.created_at, m.id
  loop
    n_acc := n_acc + 1;
    pk := (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop;
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

create or replace function public._respond_match(p_driver uuid, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; r public.ride_requests; bal integer; taken integer; q jsonb; dollars double precision; pts integer; a record; nd double precision; npts integer; diff integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  select * into t from public.trips where id = m.trip_id for update;
  if t.id is null or not t.active or (t.expires_at is not null and t.expires_at < now()) then raise exception 'This trip is no longer on'; end if;
  select * into r from public.ride_requests where id = m.request_id;
  if r.id is null or not r.active or (r.expires_at is not null and r.expires_at < now()) then raise exception 'This request is no longer active'; end if;
  if exists (select 1 from public.matches x where x.request_id = m.request_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id) then
    raise exception 'This rider already has a confirmed seat for that day';
  end if;
  select count(*) into taken from public.matches where trip_id = m.trip_id and ride_date = m.ride_date and status in ('accepted', 'completed') and id <> m.id;
  if taken >= coalesce(t.max_pickups, 3) then raise exception 'You already have % pickup(s) for this trip. Raise the limit on the trip to take more.', coalesce(t.max_pickups, 3); end if;
  -- the server works out the route and everyone's share again with the riders who are booked now
  q := public._quote_trip(m.trip_id, m.ride_date, m.request_id, true);
  if not coalesce((q->>'ok')::boolean, false) then raise exception 'This request no longer fits your detour limits'; end if;
  -- the first rider accepted on a trip with a time window sets the leave time; after that it is a normal scheduled trip
  if t.flex_to is not null and not t.live and not coalesce(t.flex_locked, false) then
    update public.trips set depart_min = ceil((q->>'depart')::double precision)::int, flex_locked = true where id = m.trip_id;
  end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := case when m.pay_with = 'points' then greatest(1, floor(dollars / 0.10 + 0.0001))::int else 0 end;
  update public.matches set points = pts, cash_cents = floor(dollars * 100)::int, price_dollars = round(dollars::numeric, 2),
    detour_min = (q->>'added_min')::numeric, detour_km = (q->>'added_km')::numeric, quote_source = q->>'source' where id = p_match;
  if m.pay_with = 'points' and pts > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < pts then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - pts where user_id = m.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, -pts, 'Ride paid with points (held until the ride)', m.id);
  end if;
  -- riders who were already booked: their share can only go down; the difference goes back to them
  for a in select x.id, x.rider_id, x.request_id, x.pay_with, x.points, x.cash_cents from public.matches x
            where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id order by x.created_at, x.id loop
    nd := coalesce((select (e->>'dollars')::double precision from jsonb_array_elements(q->'shares') e where e->>'request_id' = a.request_id::text limit 1), null);
    if nd is null then continue; end if;
    if a.pay_with = 'points' and a.points > 0 then
      npts := greatest(1, floor(nd / 0.10 + 0.0001))::int;
      if npts < a.points then
        diff := a.points - npts;
        update public.wallets set points = points + diff where user_id = a.rider_id;
        insert into public.ledger (user_id, delta, reason, match_id) values (a.rider_id, diff, 'Refund: your share went down because another rider joined', a.id);
        update public.matches set points = npts, price_dollars = round(nd::numeric, 2) where id = a.id;
      end if;
    elsif a.pay_with = 'cash' then
      update public.matches set cash_cents = least(coalesce(a.cash_cents, 2147483647), floor(nd * 100)::int), price_dollars = least(coalesce(price_dollars, 99999), round(nd::numeric, 2)) where id = a.id;
    end if;
  end loop;
  -- remember the route and its distance for the whole trip as Google gave it now (used later for the trip's distance, so Google is not asked twice)
  update public.trips set quoted_km = (q->>'total_km')::numeric, quoted_min = (q->>'total_min')::numeric, quoted_source = q->>'source',
    quoted_rids = (select array_agg((e->>'request_id')::uuid order by (e->>'request_id')) from jsonb_array_elements(q->'shares') e) where id = m.trip_id;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;
revoke all on function public._respond_match(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public._reachable(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; pl jsonb; off double precision; rt double precision; vnow double precision; tt public.trips;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return true; end if;
  -- a trip with a time window: the request must fit the leave time (or the window, if no rider is accepted yet)
  select * into tt from public.trips where id = m.trip_id;
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

create or replace function public._leave_json(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.matches; pl jsonb; off double precision; rt double precision; lb double precision; ts timestamptz; tt public.trips; fq jsonb;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return null; end if;
  select * into tt from public.trips where id = m.trip_id;
  if tt.flex_to is not null and not tt.live then
    -- a trip with a time window: before the first accept this is the leave time the driver would get; after it, the trip's own leave time
    if m.status = 'accepted' then lb := tt.depart_min;
    else
      fq := public._quote_trip(m.trip_id, m.ride_date, m.request_id, false);
      if not coalesce((fq->>'ok')::boolean, false) then return null; end if;
      lb := (fq->>'depart')::double precision;
    end if;
    select r.ready_to into rt from public.ride_requests r where r.id = m.request_id;
    ts := ((m.ride_date::timestamp + (floor(lb)::int::text || ' minutes')::interval) at time zone 'America/Vancouver');
    return jsonb_build_object('ok', true, 'flex', true, 'locked', coalesce(tt.flex_locked, false), 'moving', false, 'offset_min', null, 'ready_until_min', rt,
      'leave_by_min', floor(lb), 'leave_by_at', ts, 'leave_by_ms', (extract(epoch from ts) * 1000)::bigint);
  end if;
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

create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; lv jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  -- Leave now is the start: once a live offer is moving, riders already accepted count as "on the way" with no separate Start trip tap.
  update public.matches m set en_route_at = now()
    from public.trips t
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and t.id = m.trip_id and t.live and t.active
      and coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, false);
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public.occurs_on(today, t.trip_date, t.repeat_days));
  -- Test mode: about every 45 seconds, while nothing is waiting, a made-up rider asks (it appears 5 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '45 seconds'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 5);
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
      and r.active and (r.expires_at is null or r.expires_at > now())
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
    join public.trips t on t.id = m.trip_id and t.active and (t.live or t.flex_to is not null)
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and (t.flex_to is not null and not t.live or coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, true) = false)
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

-- When the last accepted rider of a trip with a window leaves, the window opens again.
create or replace function public._flex_unlock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'accepted' and new.status is distinct from 'accepted' then
    update public.trips set flex_locked = false, depart_min = flex_from
     where id = new.trip_id and flex_to is not null and flex_locked
       and not exists (select 1 from public.matches x where x.trip_id = new.trip_id and x.status in ('accepted', 'completed'));
  end if;
  return null;
end $$;
drop trigger if exists matches_flex_unlock on public.matches;
create trigger matches_flex_unlock after update of status on public.matches for each row execute function public._flex_unlock();
