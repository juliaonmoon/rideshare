-- Migration 032: the distance of a finished trip uses what is free first.
--   1. the phone's own tracking, when it covered (nearly) the whole drive;
--   2. the route Google gave when the seats were accepted (saved on the trip then), if the same riders completed the trip;
--   3. only then a new Google lookup (under the usage cap);
--   4. without Google, the saved map estimate.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 027, 028 and 031 first.

alter table public.trips add column if not exists quoted_km numeric(8,2), add column if not exists quoted_min numeric(7,1), add column if not exists quoted_source text, add column if not exists quoted_rids uuid[];

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

create or replace function public.trip_route_summary(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; today date := (now() at time zone 'America/Vancouver')::date;
  olat double precision; olng double precision; dlat double precision; dlng double precision;
  stops public.route_stop[]; ev_row record; live jsonb; legs double precision[] := '{}';
  km double precision := 0; mins double precision := 0; src text := 'estimate'; tracked double precision; est double precision; scale double precision; done_rids uuid[];
  i integer; j integer; n integer; prev public.route_stop; cur public.route_stop; di integer; sum_km double precision; dow integer;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not (t.user_id = auth.uid() or exists (select 1 from public.matches m where m.trip_id = p_trip and m.rider_id = auth.uid() and m.status = 'completed')) then
    raise exception 'Not your trip';
  end if;
  if t.route_km is not null then return jsonb_build_object('km', t.route_km, 'minutes', t.route_min, 'source', t.route_source); end if;
  if t.active and t.trip_date >= today then raise exception 'The trip is not finished yet'; end if;
  select a.lat, a.lng into olat, olng from public.areas a where a.name = t.origin;
  select a.lat, a.lng into dlat, dlng from public.areas a where a.name = t.dest;
  olat := coalesce(t.origin_lat, olat); olng := coalesce(t.origin_lng, olng); dlat := coalesce(t.dest_lat, dlat); dlng := coalesce(t.dest_lng, dlng);
  if olat is null or dlat is null then return jsonb_build_object('km', null, 'minutes', null, 'source', 'unknown'); end if;
  -- the real order of the stops: by the time each pickup and drop-off happened (no recorded time: pickups first, then drop-offs)
  stops := array[(olat, olng, 'origin', null, 0, 0)::public.route_stop];
  for ev_row in
    select * from (
      select m.id as mid, 'pickup'::text as kind, coalesce(m.picked_up_at, m.created_at) as at, 0 as ord,
             coalesce(m.meet_lat, r.pickup_lat, pa.lat) as lat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as lng
        from public.matches m join public.ride_requests r on r.id = m.request_id left join public.areas pa on pa.name = r.pickup
       where m.trip_id = p_trip and m.status = 'completed'
      union all
      select m.id, 'dropoff'::text, coalesce(m.dropped_off_at, m.created_at + interval '1 day'), 1,
             coalesce(r.dropoff_lat, da.lat), coalesce(r.dropoff_lng, da.lng)
        from public.matches m join public.ride_requests r on r.id = m.request_id left join public.areas da on da.name = r.dropoff
       where m.trip_id = p_trip and m.status = 'completed') e
     where e.lat is not null and e.lng is not null
     order by e.at, e.ord
  loop
    stops := stops || (ev_row.lat, ev_row.lng, ev_row.kind, ev_row.mid, 0, 0)::public.route_stop;
  end loop;
  stops := stops || (dlat, dlng, 'dest', null, 0, 0)::public.route_stop;
  n := array_length(stops, 1);
  dow := extract(dow from t.trip_date)::int;
  tracked := coalesce((select sum(distance_km) from public.drive_sessions where trip_id = p_trip), 0);
  est := public._route_km(stops);
  if est > 0 and tracked >= 0.85 * est and tracked <= 1.6 * est then
    -- the phone tracked (nearly) the whole drive: use it (free), and share it between the legs in proportion
    src := 'gps'; km := tracked; scale := tracked / est;
    mins := coalesce((select sum(extract(epoch from (coalesce(ended_at, last_at) - started_at)) / 60.0) from public.drive_sessions where trip_id = p_trip), 0);
    for i in 2 .. n loop prev := stops[i - 1]; cur := stops[i]; legs := legs || (public._road_km(prev.lat, prev.lng, cur.lat, cur.lng) * scale); end loop;
  else
    -- the route Google gave when the seats were accepted, if it is still the route that was driven (the same riders)
    select array_agg(m.request_id order by m.request_id::text) into done_rids from public.matches m where m.trip_id = p_trip and m.status = 'completed';
    if t.quoted_source = 'live' and t.quoted_km is not null and est > 0 and done_rids is not null and t.quoted_rids is not null and done_rids = t.quoted_rids then
      src := 'google-saved'; km := t.quoted_km; mins := coalesce(t.quoted_min, 0); scale := km / est;
      for i in 2 .. n loop prev := stops[i - 1]; cur := stops[i]; legs := legs || (public._road_km(prev.lat, prev.lng, cur.lat, cur.lng) * scale); end loop;
    else
      live := public._live_route(stops, now());
    end if;
  end if;
  if src in ('gps', 'google-saved') then null;
  elsif live is not null then
    src := 'google';
    km := (live->>'km')::double precision; mins := (live->>'minutes')::double precision;
    select array_agg(x::text::double precision order by ord) into legs from jsonb_array_elements(live->'legs') with ordinality as e(x, ord);
  else
    for i in 2 .. n loop
      prev := stops[i - 1]; cur := stops[i];
      legs := legs || public._road_km(prev.lat, prev.lng, cur.lat, cur.lng);
      mins := mins + public._minutes(prev.lat, prev.lng, cur.lat, cur.lng, t.depart_min + mins, dow);
    end loop;
    select coalesce(sum(x), 0) into km from unnest(legs) x;
  end if;
  update public.trips set route_km = round(km::numeric, 2), route_min = round(mins::numeric, 1), route_source = src where id = p_trip;
  -- each rider's distance in the car: the legs between their pickup and their drop-off
  for i in 2 .. n - 1 loop
    cur := stops[i];
    if cur.kind = 'pickup' then
      di := null;
      for j in i + 1 .. n - 1 loop
        if (stops[j]).kind = 'dropoff' and (stops[j]).rid = cur.rid then di := j; exit; end if;
      end loop;
      if di is not null then
        sum_km := 0;
        for j in i + 1 .. di loop sum_km := sum_km + legs[j - 1]; end loop;
        update public.matches set route_km = round(sum_km::numeric, 2) where id = cur.rid;
      end if;
    end if;
  end loop;
  return jsonb_build_object('km', round(km::numeric, 2), 'minutes', round(mins::numeric, 1), 'source', src);
end $$;
revoke all on function public.trip_route_summary(uuid) from public, anon;
grant execute on function public.trip_route_summary(uuid) to authenticated;
