-- Migration 045: exact pickup and drop-off places, shown only to the driver of a booked ride.
-- Until now the app kept only a rounded point (about 100 m) and a street name without the house number, so a driver could not find the rider.
--   * request_exact: the rider's exact pickup / drop-off (full address text and exact point), private to the rider.
--   * save_exact_places(): the rider's app saves them with the request.
--   * match_exact(): the driver of an ACCEPTED ride that is not finished can read them. Before accepting, and after the drop-off, the driver only sees the rounded place.
--   * The phone helper's route and ride list use the exact spots too (a meeting spot the two agreed on still wins).
-- Deleting a request deletes its exact places. Needs migrations 026 and 042. Run once in the Supabase SQL editor (safe to run again).

create table if not exists public.request_exact (
  request_id uuid primary key references public.ride_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pickup_label text, pickup_lat double precision, pickup_lng double precision,
  dropoff_label text, dropoff_lat double precision, dropoff_lng double precision,
  updated_at timestamptz not null default now()
);
alter table public.request_exact enable row level security;
revoke all on public.request_exact from anon;
grant select, insert, update, delete on public.request_exact to authenticated;
drop policy if exists request_exact_owner on public.request_exact;
create policy request_exact_owner on public.request_exact for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.save_exact_places(
  p_request uuid, p_pickup_label text, p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_label text, p_dropoff_lat double precision, p_dropoff_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from public.ride_requests where id = p_request;
  if owner is null or owner <> auth.uid() then raise exception 'Not your request'; end if;
  if (p_pickup_lat is not null and (p_pickup_lat not between -90 and 90 or p_pickup_lng not between -180 and 180))
     or (p_dropoff_lat is not null and (p_dropoff_lat not between -90 and 90 or p_dropoff_lng not between -180 and 180)) then raise exception 'Bad place'; end if;
  if p_pickup_lat is null and p_dropoff_lat is null then return; end if;
  insert into public.request_exact (request_id, user_id, pickup_label, pickup_lat, pickup_lng, dropoff_label, dropoff_lat, dropoff_lng, updated_at)
    values (p_request, auth.uid(), left(p_pickup_label, 200), p_pickup_lat, p_pickup_lng, left(p_dropoff_label, 200), p_dropoff_lat, p_dropoff_lng, now())
  on conflict (request_id) do update set
    pickup_label = case when excluded.pickup_lat is not null then excluded.pickup_label else request_exact.pickup_label end,
    pickup_lat = coalesce(excluded.pickup_lat, request_exact.pickup_lat), pickup_lng = coalesce(excluded.pickup_lng, request_exact.pickup_lng),
    dropoff_label = case when excluded.dropoff_lat is not null then excluded.dropoff_label else request_exact.dropoff_label end,
    dropoff_lat = coalesce(excluded.dropoff_lat, request_exact.dropoff_lat), dropoff_lng = coalesce(excluded.dropoff_lng, request_exact.dropoff_lng), updated_at = now();
end $$;
revoke all on function public.save_exact_places(uuid, text, double precision, double precision, text, double precision, double precision) from public, anon;
grant execute on function public.save_exact_places(uuid, text, double precision, double precision, text, double precision, double precision) to authenticated;

-- The exact places of one ride, for its driver only, from the moment the seat is accepted until the rider is dropped off.
create or replace function public.match_exact(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; e public.request_exact;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or m.driver_id is distinct from auth.uid() or m.status <> 'accepted' or m.dropped_off_at is not null then return null; end if;
  select * into e from public.request_exact where request_id = m.request_id;
  if e.request_id is null then return null; end if;
  return jsonb_build_object('pickup_label', e.pickup_label, 'pickup_lat', e.pickup_lat, 'pickup_lng', e.pickup_lng,
    'dropoff_label', e.dropoff_label, 'dropoff_lat', e.dropoff_lat, 'dropoff_lng', e.dropoff_lng);
end $$;
revoke all on function public.match_exact(uuid) from public, anon;
grant execute on function public.match_exact(uuid) to authenticated;

create or replace function public.driver_route_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; stops jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(s order by s.created_at), '[]'::jsonb) into stops from (
    select m.id as match_id, coalesce(p.display_name, 'Rider') as name, 'pick' as type, m.created_at,
           coalesce(m.meet_lat, ex.pickup_lat, r.pickup_lat, pa.lat) as lat, coalesce(m.meet_lng, ex.pickup_lng, r.pickup_lng, pa.lng) as lng
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.request_exact ex on ex.request_id = r.id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas pa on pa.name = r.pickup
     where m.driver_id = d and m.status = 'accepted' and m.picked_up_at is null and m.dropped_off_at is null and m.ride_date >= today - 1
    union all
    select m.id, coalesce(p.display_name, 'Rider'), 'drop', m.created_at,
           coalesce(ex.dropoff_lat, r.dropoff_lat, da.lat), coalesce(ex.dropoff_lng, r.dropoff_lng, da.lng)
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.request_exact ex on ex.request_id = r.id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas da on da.name = r.dropoff
     where m.driver_id = d and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1) s
   where s.lat is not null and s.lng is not null;
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public.occurs_on(today, t.trip_date, t.repeat_days)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('stops', stops, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;
revoke all on function public.driver_route_token(text) from public;
grant execute on function public.driver_route_token(text) to anon, authenticated;


create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; lv jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  -- Leave now is the start: once a live offer is moving, riders already accepted count as "on the way" with no separate Start trip tap.
  update public.matches m set en_route_at = now()
    from public.trips t
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and t.id = m.trip_id and t.live and t.active
      and coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, false);
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public.occurs_on(today, t.trip_date, t.repeat_days));
  -- Test mode: about every 45 seconds, while nothing is waiting, a made-up rider asks (it appears 5 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '45 seconds'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 5);
      update public.test_accounts set last_test_at = now() where user_id = d;
    exception when others then null;   -- never let a test problem break the real alert check
    end;
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at, m.detour_min, m.detour_km,
      coalesce(a.sum_min, 0) + coalesce(m.detour_min, 0) as total_min, coalesce(a.sum_km, 0) + coalesce(m.detour_km, 0) as total_km,
      greatest(coalesce(t.max_total_detour, t.max_detour), t.max_detour) as limit_min,
      case when t.max_detour_km is null and t.max_total_detour_km is null then null
           else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end as limit_km,
      public._leave_json(m.id) as leave
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    join public.trips t on t.id = m.trip_id
    left join public.profiles p on p.id = m.rider_id
    left join lateral (select sum(x.detour_min) as sum_min, sum(x.detour_km) as sum_km from public.matches x
                       where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status in ('accepted','completed')) a on true
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
      and public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id)
      and public._reachable(m.id)
      and r.active and (r.expires_at is null or r.expires_at > now())
    order by m.created_at desc limit 5) x;
  select coalesce(jsonb_agg(y order by y.en_route_at), '[]'::jsonb) into rides from (
    select m.id, coalesce(p.display_name, 'Rider') as name, m.en_route_at,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived' else 'on_my_way' end as stage,
      coalesce(ex.pickup_label, r.pickup_label, r.pickup) as pickup_name, coalesce(ex.dropoff_label, r.dropoff_label, r.dropoff) as dropoff_name,
      coalesce(m.meet_lat, ex.pickup_lat, r.pickup_lat, pa.lat) as pickup_lat, coalesce(m.meet_lng, ex.pickup_lng, r.pickup_lng, pa.lng) as pickup_lng, m.meet_note,
      coalesce(ex.dropoff_lat, r.dropoff_lat, da.lat) as dropoff_lat, coalesce(ex.dropoff_lng, r.dropoff_lng, da.lng) as dropoff_lng,
      (m.meet_lat is not null or ex.pickup_lat is not null or r.pickup_lat is not null) as pickup_exact, (ex.dropoff_lat is not null or r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.request_exact ex on ex.request_id = r.id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  -- accepted riders on a live offer whose driver has not set off yet, with the time the driver must leave by (empty once the driver is moving)
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'leave_by_ms', z.ms)), '[]'::jsonb) into lv from (
    select m.id, coalesce(p.display_name, 'Rider') as name, (public._leave_json(m.id)->>'leave_by_ms')::bigint as ms
    from public.matches m
    join public.trips t on t.id = m.trip_id and t.active and (t.live or t.flex_to is not null)
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is null and m.picked_up_at is null and m.ride_date = today
      and (t.flex_to is not null and not t.live or coalesce((public._live_plan(m.trip_id, m.ride_date, null)->>'moving')::boolean, true) = false)
    limit 6) z where z.ms is not null;
  -- where the driver is heading today (the newest active trip), so the phone can end the trip on arrival
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public.occurs_on(today, t.trip_date, t.repeat_days)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides, 'leave', lv, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;
