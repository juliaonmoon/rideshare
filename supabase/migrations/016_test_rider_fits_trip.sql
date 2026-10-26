-- Migration 016: test mode riders now fit the driver's trip
-- (run once in Supabase > SQL Editor, after 015). Safe to run twice.
--
-- Before: a made-up rider kept its own morning times and random places, so it often did not fit the driver's trip.
-- Now, each time a test request is made, the made-up rider is moved onto the driver's trip:
--   * picks up a little way from where the driver starts (about 600 m),
--   * drops off near the driver's destination (about 300 m before it),
--   * is ready from 10 minutes before to 45 minutes after the trip's departure time, on the trip's date.
-- It only ever changes made-up riders (sample-r-...@example.invalid), never a real person's request.

create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare t record; r record; today date := (now() at time zone 'America/Vancouver')::date; nm text;
begin
  select * into t from public.trips where user_id = p_driver and active and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
  if t.id is null then raise exception 'Post a trip (or switch on Offer a ride now) first'; end if;
  select rq.id as request_id, rq.user_id as rider_id into r
    from public.ride_requests rq join auth.users u on u.id = rq.user_id
    where u.email like 'sample-r-%@example.invalid' and rq.active
    order by (exists (select 1 from public.matches m where m.trip_id = t.id and m.request_id = rq.id and m.ride_date = today and m.status in ('requested','accepted'))), random()
    limit 1;
  if r.request_id is null then raise exception 'No made-up riders found. Run the sample data first.'; end if;
  -- put the made-up rider on this driver's trip
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
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'))
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at;
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
