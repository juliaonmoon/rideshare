-- Test data: made-up riders ask for a seat on your repeating trips, each on a DIFFERENT date.
-- Takes your newest posted repeating trips (up to 5) and the made-up riders (sample-r-...@example.invalid, up to 5).
-- Rider 1 asks trip 1 on its 1st coming date, rider 2 asks trip 2 on its 2nd coming date, and so on, so every
-- request is for a different day. Each request sits there waiting for you (even if a trip accepts riders
-- automatically): you will see the date on each request. Safe to run again (it resets the same riders and requests).
-- Needs migrations 046 and 048, and the made-up riders from the sample data.
do $$
declare
  today date := (now() at time zone 'America/Vancouver')::date;
  trip_ids uuid[]; t public.trips; r record; i integer := 0; d date; k integer; cnt integer := 0;
  q jsonb; orig boolean; f integer; tt integer; lines text := ''; used date[] := '{}';
begin
  select array_agg(x.id order by x.created_at desc) into trip_ids from (
    select id, created_at from public.trips
     where active and not live and coalesce(array_length(repeat_days, 1), 0) > 0 and (expires_at is null or expires_at > now())
       and user_id not in (select id from auth.users where email like 'sample-%@example.invalid')
     order by created_at desc limit 5) x;
  if trip_ids is null then raise exception 'No repeating trip found. Post a repeating trip first.'; end if;
  for r in
    select rq.id as request_id, rq.user_id as rider_id
      from public.ride_requests rq join auth.users u on u.id = rq.user_id
     where u.email like 'sample-r-%@example.invalid' and rq.active
     order by u.email limit 5
  loop
    i := i + 1;
    exit when i > array_length(trip_ids, 1);
    select * into t from public.trips where id = trip_ids[i];
    -- a coming date this trip runs, at least i days from now and not used by another request (so every request is for a different day)
    d := null;
    for k in i..30 loop
      if public._trip_on(t, today + k) and not ((today + k) = any (used)) then d := today + k; exit; end if;
    end loop;
    if d is null then raise notice 'Trip % has no free coming date, skipped', i; continue; end if;
    used := used || d;
    -- the rider's request: one date, near the trip's start and end, ready around the trip's leave time
    if t.flex_to is not null then f := least(1439 - 60, t.flex_from + 30); tt := t.flex_to; else f := greatest(0, t.depart_min - 20); tt := least(1439, t.depart_min + 90); end if;
    update public.ride_requests set
      pickup = t.origin, dropoff = t.dest,
      pickup_lat  = case when t.origin_lat is not null then t.origin_lat + 0.004 * i end,
      pickup_lng  = case when t.origin_lat is not null then t.origin_lng + 0.003 * i end,
      dropoff_lat = case when t.dest_lat is not null then t.dest_lat - 0.003 end,
      dropoff_lng = case when t.dest_lat is not null then t.dest_lng + 0.002 end,
      pickup_label = 'Test pickup spot ' || i || ' near ' || t.origin, dropoff_label = 'Test drop-off spot near ' || t.dest,
      ready_from = f, ready_to = greatest(tt, f + 30), ride_date = d, repeat_days = '{}'
    where id = r.request_id;
    begin
      insert into public.request_exact (request_id, user_id, pickup_label, pickup_lat, pickup_lng, dropoff_label, dropoff_lat, dropoff_lng)
        select r.request_id, r.rider_id, (100 * i) || ' Test Street, ' || t.origin || ' (made-up address ' || i || ')',
               case when t.origin_lat is not null then t.origin_lat + 0.004 * i + 0.0004 end, case when t.origin_lat is not null then t.origin_lng + 0.003 * i + 0.0003 end,
               '200 Test Avenue, ' || t.dest || ' (made-up address)', case when t.dest_lat is not null then t.dest_lat - 0.003 + 0.0004 end, case when t.dest_lat is not null then t.dest_lng + 0.002 + 0.0003 end
      on conflict (request_id) do update set pickup_label = excluded.pickup_label, pickup_lat = excluded.pickup_lat, pickup_lng = excluded.pickup_lng,
        dropoff_label = excluded.dropoff_label, dropoff_lat = excluded.dropoff_lat, dropoff_lng = excluded.dropoff_lng;
    exception when undefined_table then null;
    end;
    -- the request waits for the driver: switch automatic acceptance off for this one insert, then put it back
    orig := t.auto_accept;
    update public.trips set auto_accept = false where id = t.id;
    insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
      values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, d, now())
    on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at where public.matches.status <> 'accepted';
    update public.trips set auto_accept = orig where id = t.id;
    q := public._quote_trip(t.id, d, r.request_id, false);
    if coalesce((q->>'ok')::boolean, false) then
      update public.matches set detour_min = (q->>'added_min')::numeric, detour_km = (q->>'added_km')::numeric,
        price_dollars = round(coalesce((q->>'new_dollars')::numeric, 0), 2), cash_cents = floor(coalesce((q->>'new_dollars')::numeric, 0) * 100)::int, quote_source = q->>'source'
       where trip_id = t.id and request_id = r.request_id and ride_date = d and status = 'requested';
    end if;
    cnt := cnt + 1;
    lines := lines || E'\n  ' || to_char(d, 'Dy Mon DD') || ': rider ' || i || ' asks "' || t.origin || ' to ' || t.dest || '"';
  end loop;
  if cnt = 0 then raise exception 'No made-up riders found. Run the sample data first.'; end if;
  raise notice 'Added % test requests, each for a different date:%', cnt, lines;
end $$;
