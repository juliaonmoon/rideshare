-- Test data: made-up riders ask for a seat on your newest posted trip that has a time window ("any time between ...").
-- Up to 4 made-up riders (sample-r-...@example.invalid), each ready for an hour at a different point inside the window,
-- so you can see "Accepting sets your leave time to ..." and watch the other requests fit or disappear after you accept one.
-- Only changes made-up riders. Safe to run again (it resets the same riders and requests). Needs migration 042.
do $$
declare t record; r record; n integer := 0; span integer; f integer; q jsonb;
begin
  select * into t from public.trips
    where active and flex_to is not null and not live and not flex_locked and (expires_at is null or expires_at > now())
    order by created_at desc limit 1;
  if t.id is null then raise exception 'No open trip with a time window found. Post one first (and do not accept anyone yet).'; end if;
  span := t.flex_to - t.flex_from;
  for r in
    select rq.id as request_id, rq.user_id as rider_id
      from public.ride_requests rq join auth.users u on u.id = rq.user_id
     where u.email like 'sample-r-%@example.invalid' and rq.active
     order by u.email limit 4
  loop
    n := n + 1;
    f := least(1439 - 60, t.flex_from + (span * n) / 5);
    update public.ride_requests set
      pickup = t.origin, dropoff = t.dest,
      pickup_lat  = case when t.origin_lat is not null then t.origin_lat + 0.004 * n end,
      pickup_lng  = case when t.origin_lat is not null then t.origin_lng + 0.003 * n end,
      dropoff_lat = case when t.dest_lat is not null then t.dest_lat - 0.003 end,
      dropoff_lng = case when t.dest_lat is not null then t.dest_lng + 0.002 end,
      pickup_label = 'Test pickup spot ' || n || ' near ' || t.origin, dropoff_label = 'Test drop-off spot near ' || t.dest,
      ready_from = f, ready_to = f + 60,
      ride_date = t.trip_date, repeat_days = '{}'
    where id = r.request_id;
    insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
      values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, t.trip_date, now())
    on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at where public.matches.status <> 'accepted';
    -- the extra time and distance for this rider, as a real request would carry (shown on the driver's card and phone alert)
    q := public._quote_trip(t.id, t.trip_date, r.request_id, false);
    if coalesce((q->>'ok')::boolean, false) then
      update public.matches set detour_min = (q->>'added_min')::numeric, detour_km = (q->>'added_km')::numeric,
        price_dollars = round(coalesce((q->>'new_dollars')::numeric, 0), 2), cash_cents = floor(coalesce((q->>'new_dollars')::numeric, 0) * 100)::int, quote_source = q->>'source'
       where trip_id = t.id and request_id = r.request_id and ride_date = t.trip_date and status = 'requested';
    end if;
  end loop;
  if n = 0 then raise exception 'No made-up riders found. Run the sample data first.'; end if;
  raise notice 'Added % test requests to the trip on % (window % to % minutes after midnight)', n, t.trip_date, t.flex_from, t.flex_to;
end $$;
