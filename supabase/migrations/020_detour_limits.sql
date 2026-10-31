-- Migration 020: detour limits in minutes AND (optionally) kilometres, saved with each seat request, and used to hide requests that do not fit
-- (run once in Supabase > SQL Editor, after 019). Safe to run twice.
--
-- The driver's rules (a request must fit ALL of the ones the driver set):
--   * max_detour            minutes one rider may add           (already existed)
--   * max_total_detour      minutes all riders together may add (already existed)
--   * max_detour_km         km one rider may add                (new, optional: empty = no km limit)
--   * max_total_detour_km   km all riders together may add      (new, optional)
-- The rider's app works out the extra minutes / km for the driver it asks (same engine and Google drive times as the rest of the app)
-- and sends them with the request. They are saved on the match. A request that does not fit is refused when it is made, and one that
-- stops fitting later (because other riders were accepted) is left out of the driver's alerts and cannot be accepted.
-- Test riders get made-up detours (small ones) so the whole flow can be tried.

alter table public.trips add column if not exists max_detour_km numeric(5,1), add column if not exists max_total_detour_km numeric(5,1);
alter table public.trips drop constraint if exists trips_detour_km_check;
alter table public.trips add constraint trips_detour_km_check check ((max_detour_km is null or max_detour_km between 0 and 200) and (max_total_detour_km is null or max_total_detour_km between 0 and 400));
alter table public.user_settings add column if not exists d_detour_km numeric(5,1), add column if not exists d_total_detour_km numeric(5,1);
alter table public.matches add column if not exists detour_min numeric(5,1), add column if not exists detour_km numeric(5,1);

-- Does this detour fit the trip's limits, together with the riders already accepted? (unknown detour = fits, for older requests)
create or replace function public._detour_fits(p_trip uuid, p_date date, p_min numeric, p_km numeric, p_exclude uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t public.trips; acc_min numeric; acc_km numeric; cap_min numeric; cap_km numeric;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null then return true; end if;
  select coalesce(sum(detour_min), 0), coalesce(sum(detour_km), 0) into acc_min, acc_km
    from public.matches where trip_id = p_trip and ride_date = p_date and status in ('accepted', 'completed')
      and id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid);
  cap_min := greatest(coalesce(t.max_total_detour, t.max_detour), t.max_detour);
  cap_km := case when t.max_detour_km is null and t.max_total_detour_km is null then null
                 else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end;
  if p_min is not null then
    if p_min > t.max_detour + 0.05 then return false; end if;
    if acc_min + p_min > cap_min + 0.05 then return false; end if;
  end if;
  if p_km is not null and cap_km is not null then
    if t.max_detour_km is not null and p_km > t.max_detour_km + 0.05 then return false; end if;
    if acc_km + p_km > cap_km + 0.05 then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public._detour_fits(uuid, date, numeric, numeric, uuid) from public, anon, authenticated;

-- Seat request: also takes the rider's detour (minutes, km) and refuses what does not fit the driver's limits.
drop function if exists public.request_seat(uuid, uuid, text, integer, date);
create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_points integer, p_date date, p_detour_min numeric default null, p_detour_km numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; max_pts integer; direct double precision; dmin numeric; dkm numeric;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.expires_at is not null and t.expires_at < now() then raise exception 'That live trip has ended'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'Your live request has ended'; end if;
  if t.user_id = auth.uid() then raise exception 'You cannot ride with yourself'; end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  if not public.occurs_on(p_date, t.trip_date, t.repeat_days) or not public.occurs_on(p_date, r.ride_date, r.repeat_days) then
    raise exception 'That trip or request does not run on that date';
  end if;
  if p_pay_with not in ('points','cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  if p_pay_with = 'points' then
    direct := public.area_km(r.pickup, r.dropoff);
    if direct is null then raise exception 'Unknown area'; end if;
    max_pts := ceil(((direct + t.max_detour * 40.0 / 60.0) * t.cost_per_km / 2.0) / 0.10)::integer + 1;
    if p_points < 1 or p_points > max_pts then raise exception 'That points amount is outside the fair range (1 to %)', max_pts; end if;
  end if;
  dmin := case when p_detour_min is null then null else least(greatest(p_detour_min, 0), 999) end;
  dkm := case when p_detour_km is null then null else least(greatest(p_detour_km, 0), 999) end;
  if not public._detour_fits(p_trip, p_date, dmin, dkm, null) then raise exception 'This trip is outside the driver''s detour limits'; end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, detour_min, detour_km)
    values (p_trip, p_request, t.user_id, auth.uid(), p_pay_with, case when p_pay_with = 'points' then p_points else 0 end, p_date, dmin, dkm)
    returning id into m;
  return m;
end $$;
revoke all on function public.request_seat(uuid, uuid, text, integer, date, numeric, numeric) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, integer, date, numeric, numeric) to authenticated;

-- Accept / decline: an accept is refused if the request no longer fits (same rules as the app and the phone alert).
create or replace function public._respond_match(p_driver uuid, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; bal integer; cap integer; taken integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  select max_pickups into cap from public.trips where id = m.trip_id;
  select count(*) into taken from public.matches
    where trip_id = m.trip_id and ride_date = m.ride_date and status in ('accepted','completed') and id <> m.id;
  if taken >= coalesce(cap, 3) then raise exception 'You already have % pickup(s) for this trip. Raise the limit on the trip to take more.', coalesce(cap, 3); end if;
  if not public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id) then raise exception 'This request no longer fits your detour limits'; end if;
  if m.pay_with = 'points' and m.points > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < m.points then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - m.points where user_id = m.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id)
      values (m.rider_id, -m.points, 'Ride paid with points (held until the ride)', m.id);
  end if;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;
revoke all on function public._respond_match(uuid, uuid, boolean) from public, anon, authenticated;

-- The driver's phone check: requests that do not fit are left out; the ones that fit carry their detour for the alert text.
create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public.occurs_on(today, t.trip_date, t.repeat_days));
  -- Test mode: about every 2 minutes, while nothing is waiting, a made-up rider asks (it appears 20 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '2 minutes'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 20);
      update public.test_accounts set last_test_at = now() where user_id = d;
    exception when others then null;   -- never let a test problem break the real alert check
    end;
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at, m.detour_min, m.detour_km,
      coalesce(a.sum_min, 0) + coalesce(m.detour_min, 0) as total_min, coalesce(a.sum_km, 0) + coalesce(m.detour_km, 0) as total_km,
      greatest(coalesce(t.max_total_detour, t.max_detour), t.max_detour) as limit_min,
      case when t.max_detour_km is null and t.max_total_detour_km is null then null
           else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end as limit_km
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    join public.trips t on t.id = m.trip_id
    left join public.profiles p on p.id = m.rider_id
    left join lateral (select sum(x.detour_min) as sum_min, sum(x.detour_km) as sum_km from public.matches x
                       where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status in ('accepted','completed')) a on true
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
      and public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id)
    order by m.created_at desc limit 5) x;
  select coalesce(jsonb_agg(y order by y.en_route_at), '[]'::jsonb) into rides from (
    select m.id, coalesce(p.display_name, 'Rider') as name, m.en_route_at,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived' else 'on_my_way' end as stage,
      coalesce(r.pickup_label, r.pickup) as pickup_name, coalesce(r.dropoff_label, r.dropoff) as dropoff_name,
      coalesce(r.pickup_lat, pa.lat) as pickup_lat, coalesce(r.pickup_lng, pa.lng) as pickup_lng,
      coalesce(r.dropoff_lat, da.lat) as dropoff_lat, coalesce(r.dropoff_lng, da.lng) as dropoff_lng,
      (r.pickup_lat is not null) as pickup_exact, (r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;

-- Test requests: made-up detours that fit (small ones), so the flow can be tried. Everything else as in migration 018.
create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  t record; r record; today date := (now() at time zone 'America/Vancouver')::date; nm text; n integer;
  o_lat double precision; o_lng double precision; d_lat double precision; d_lng double precision;
  fp double precision; fd double precision; pl double precision; pg double precision; dl double precision; dg double precision;
  pa text; da text; dmin numeric; dkm numeric;
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
  dmin := case n when 0 then 2.0 when 1 then 4.5 when 2 then 6.0 else 3.0 end;
  dkm := case n when 0 then 0.9 when 1 then 2.4 when 2 then 3.2 else 1.5 end;

  update public.ride_requests set
    pickup = coalesce(pa, t.origin), dropoff = coalesce(da, t.dest),
    pickup_lat = pl, pickup_lng = pg, dropoff_lat = dl, dropoff_lng = dg,
    pickup_label = null, dropoff_label = null,
    ready_from = greatest(0, t.depart_min - 10), ready_to = least(1439, t.depart_min + 120),
    ride_date = today, repeat_days = '{}'
  where id = r.request_id;
  update public.trips set max_pickups = greatest(max_pickups, 4), max_detour = greatest(max_detour, 15), max_wait = greatest(max_wait, 10),
    max_total_detour = greatest(coalesce(max_total_detour, 0), 30) where id = t.id;

  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at, detour_min, detour_km)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'), dmin, dkm)
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at, detour_min = excluded.detour_min, detour_km = excluded.detour_km
    where public.matches.status not in ('accepted','completed');
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;
