-- Migration 017: test mode never flips an accepted ride back to "requested"
-- (run once in Supabase > SQL Editor, after 016). Safe to run twice.
-- Before: if a made-up rider already had an accepted ride on your trip, a new test request could set it back to "requested".
-- Now an accepted or completed ride is left alone; a test request only re-asks when the old one was declined, cancelled or removed.

create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare t record; r record; today date := (now() at time zone 'America/Vancouver')::date; nm text;
begin
  select * into t from public.trips where user_id = p_driver and active and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
  if t.id is null then raise exception 'Post a trip (or switch on Offer a ride now) first'; end if;
  select rq.id as request_id, rq.user_id as rider_id into r
    from public.ride_requests rq join auth.users u on u.id = rq.user_id
    where u.email like 'sample-r-%@example.invalid' and rq.active
      and not exists (select 1 from public.matches m where m.trip_id = t.id and m.request_id = rq.id and m.ride_date = today and m.status in ('requested','accepted','completed'))
    order by random()
    limit 1;
  if r.request_id is null then return 'No free made-up rider (all are already on your trip)'; end if;
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
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at
    where public.matches.status not in ('accepted','completed');
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
