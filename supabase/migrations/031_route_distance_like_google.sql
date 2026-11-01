-- Migration 031: the distance of a finished trip is the road distance Google Maps gives for the route that was actually driven
-- (origin, then each pickup and drop-off in the order they happened, then the destination), not a sum of GPS readings.
-- It is worked out once when someone opens the trip, saved, and shared by the driver and the riders of that trip.
-- Uses the same live-traffic lookup and usage cap as migration 027 (one lookup per trip); without live traffic it uses the saved map estimate.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 027 and 028.

alter table public.trips add column if not exists route_km numeric(8,2), add column if not exists route_min numeric(7,1), add column if not exists route_source text;
alter table public.matches add column if not exists route_km numeric(8,2);

create or replace function public.trip_route_summary(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; today date := (now() at time zone 'America/Vancouver')::date;
  olat double precision; olng double precision; dlat double precision; dlng double precision;
  stops public.route_stop[]; ev_row record; live jsonb; legs double precision[] := '{}';
  km double precision := 0; mins double precision := 0; src text := 'estimate';
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
  live := public._live_route(stops, now());
  if live is not null then
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
