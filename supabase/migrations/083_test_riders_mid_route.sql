-- 083: made-up (sample) riders now wait in the MIDDLE of the trip, not at the start.
-- Before: the pickup was a few hundred metres from the typed start (or 5% of the way ahead of the car), so tests auto-arrived at once
-- and "Running late" could never be tried. Now the pickup is about 40% of the way from the start (or the car, if it has a fresh position)
-- to the destination, and the drop-off about 85% of the way. The place names are the nearest known areas, so the card reads true.
-- Only ever changes made-up riders (sample-r-...@example.invalid). Run once in the Supabase SQL editor (safe to run again).

create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare t record; r record; pos record; today date := (now() at time zone 'America/Vancouver')::date; nm text;
        vnow integer := floor(extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver'));
        slat double precision; slng double precision; plat double precision; plng double precision; qlat double precision; qlng double precision;
        pname text; qname text; rf integer; rt integer; ahead boolean;
begin
  select * into t from public.trips where user_id = p_driver and active and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
  if t.id is null then raise exception 'Post a trip (or switch on Offer a ride now) first'; end if;
  select rq.id as request_id, rq.user_id as rider_id into r
    from public.ride_requests rq join auth.users u on u.id = rq.user_id
    where u.email like 'sample-r-%@example.invalid' and rq.active
    order by (exists (select 1 from public.matches m where m.trip_id = t.id and m.request_id = rq.id and m.ride_date = today and m.status in ('requested','accepted'))), random()
    limit 1;
  if r.request_id is null then raise exception 'No made-up riders found. Run the sample data first.'; end if;
  select lat, lng into pos from public.driver_positions where driver_id = p_driver and updated_at > now() - interval '3 minutes';
  ahead := pos.lat is not null and vnow >= t.depart_min - 5;      -- the driver is on the road: measure from the car
  slat := case when ahead then pos.lat else t.origin_lat end;
  slng := case when ahead then pos.lng else t.origin_lng end;
  if slat is not null and t.dest_lat is not null then
    plat := slat + (t.dest_lat - slat) * 0.40;  plng := slng + (t.dest_lng - slng) * 0.40;
    qlat := slat + (t.dest_lat - slat) * 0.85;  qlng := slng + (t.dest_lng - slng) * 0.85;
    select name into pname from public.areas order by (lat - plat) ^ 2 + (lng - plng) ^ 2 limit 1;
    select name into qname from public.areas order by (lat - qlat) ^ 2 + (lng - qlng) ^ 2 limit 1;
  end if;
  if ahead then rf := greatest(0, vnow - 10); rt := least(1439, vnow + 45);
  else rf := greatest(0, t.depart_min - 10); rt := least(1439, t.depart_min + 60); end if;
  update public.ride_requests set
    pickup = coalesce(pname, t.origin), dropoff = coalesce(qname, t.dest),
    pickup_lat = plat, pickup_lng = plng, dropoff_lat = qlat, dropoff_lng = qlng,
    pickup_label = null, dropoff_label = null,
    ready_from = rf, ready_to = rt, ride_date = today, repeat_days = '{}'
  where id = r.request_id;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'))
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at;
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
