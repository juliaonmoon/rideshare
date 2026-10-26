-- Migration 018: test riders are spread along the driver's route, and test mode lifts the pickup limit
-- (run once in Supabase > SQL Editor, after 017). Safe to run twice. Includes everything from 016 and 017.
--
-- Each new test request puts the made-up rider at a different place along your route (a straight line from your start to your
-- destination), so several test riders give several stops in the middle of the trip:
--   1st rider: near the start and near the end.  2nd: about 35% to 70% of the way.  3rd: 55% to 85%.  4th and later: 25% to 90%.
-- For test accounts only, the trip also gets room for 4 riders and 30 extra minutes, so accepting several test riders is never refused.
-- It only ever changes made-up riders (sample-r-...@example.invalid) and the trips of test accounts.

create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  t record; r record; today date := (now() at time zone 'America/Vancouver')::date; nm text; n integer;
  o_lat double precision; o_lng double precision; d_lat double precision; d_lng double precision;
  fp double precision; fd double precision; pl double precision; pg double precision; dl double precision; dg double precision;
  pa text; da text;
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

  select coalesce(t.origin_lat, a.lat), coalesce(t.origin_lng, a.lng) into o_lat, o_lng from public.areas a where a.name = t.origin;
  select coalesce(t.dest_lat, a.lat), coalesce(t.dest_lng, a.lng) into d_lat, d_lng from public.areas a where a.name = t.dest;
  select count(*) into n from public.matches where trip_id = t.id and ride_date = today and status in ('requested','accepted','completed');
  fp := case n when 0 then 0.04 when 1 then 0.35 when 2 then 0.55 else 0.25 end;
  fd := case n when 0 then 0.96 when 1 then 0.70 when 2 then 0.85 else 0.90 end;
  pl := o_lat + fp * (d_lat - o_lat); pg := o_lng + fp * (d_lng - o_lng);
  dl := o_lat + fd * (d_lat - o_lat); dg := o_lng + fd * (d_lng - o_lng);
  select name into pa from public.areas order by power(lat - pl, 2) + power((lng - pg) * 0.65, 2) limit 1;
  select name into da from public.areas order by power(lat - dl, 2) + power((lng - dg) * 0.65, 2) limit 1;

  update public.ride_requests set
    pickup = coalesce(pa, t.origin), dropoff = coalesce(da, t.dest),
    pickup_lat = pl, pickup_lng = pg, dropoff_lat = dl, dropoff_lng = dg,
    pickup_label = null, dropoff_label = null,
    ready_from = greatest(0, t.depart_min - 10), ready_to = least(1439, t.depart_min + 120),
    ride_date = today, repeat_days = '{}'
  where id = r.request_id;
  update public.trips set max_pickups = greatest(max_pickups, 4), max_detour = greatest(max_detour, 15), max_wait = greatest(max_wait, 10),
    max_total_detour = greatest(coalesce(max_total_detour, 0), 30) where id = t.id;

  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'))
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at
    where public.matches.status not in ('accepted','completed');
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
