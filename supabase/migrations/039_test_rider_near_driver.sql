-- Test mode riders are placed where the driver really is, not where the trip was typed.
-- Before: the made-up rider was put about 600 m from the typed start. A driver who had already left was past that point, so the request
-- (correctly) was hidden as unreachable and no test request ever showed.
-- Now: if the driver has shared a fresh position (last 3 minutes), the made-up rider waits about 5% of the way from the driver to the
-- destination, and is ready from 10 minutes ago to 45 minutes from now. Otherwise it behaves as in migration 016.
-- Only ever changes made-up riders (sample-r-...@example.invalid). Run once in the Supabase SQL editor (safe to run again).

create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare t record; r record; pos record; today date := (now() at time zone 'America/Vancouver')::date; nm text;
        vnow integer := floor(extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver'));
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
  if pos.lat is not null and t.dest_lat is not null then
    -- the driver is on the road: wait a little way ahead, ready around now
    update public.ride_requests set
      pickup = t.origin, dropoff = t.dest,
      pickup_lat  = pos.lat + (t.dest_lat - pos.lat) * 0.05,
      pickup_lng  = pos.lng + (t.dest_lng - pos.lng) * 0.05,
      dropoff_lat = t.dest_lat - 0.003, dropoff_lng = t.dest_lng + 0.002,
      pickup_label = null, dropoff_label = null,
      ready_from = greatest(0, vnow - 10), ready_to = least(1439, vnow + 45),
      ride_date = today, repeat_days = '{}'
    where id = r.request_id;
  else
    update public.ride_requests set
      pickup = t.origin, dropoff = t.dest,
      pickup_lat  = case when t.origin_lat is not null then t.origin_lat + 0.005 end,
      pickup_lng  = case when t.origin_lat is not null then t.origin_lng + 0.004 end,
      dropoff_lat = case when t.dest_lat is not null then t.dest_lat - 0.003 end,
      dropoff_lng = case when t.dest_lat is not null then t.dest_lng + 0.002 end,
      pickup_label = null, dropoff_label = null,
      ready_from = greatest(0, t.depart_min - 10), ready_to = least(1439, t.depart_min + 45),
      ride_date = today, repeat_days = '{}'
    where id = r.request_id;
  end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'))
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at;
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
