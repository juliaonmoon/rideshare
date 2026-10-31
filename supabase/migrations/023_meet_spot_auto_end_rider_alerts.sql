-- Migration 023: exact meeting spot with a note, the trip ends by itself on arrival, and alerts for riders.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 020 and 021 first.

-- 1. The rider can set an exact meeting spot (a pin) and a note for each accepted ride. The driver can already read the match.
alter table public.matches
  add column if not exists meet_lat double precision,
  add column if not exists meet_lng double precision,
  add column if not exists meet_note text check (meet_note is null or length(meet_note) <= 200);

create or replace function public.set_meet_spot(p_match uuid, p_lat double precision, p_lng double precision, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'You can set the meeting spot once the driver has accepted'; end if;
  if m.picked_up_at is not null then raise exception 'You have already been picked up'; end if;
  if p_lat is not null and (p_lat not between 48 and 55 or p_lng not between -130 and -120) then raise exception 'That spot is outside the area we cover'; end if;
  update public.matches set meet_lat = p_lat, meet_lng = case when p_lat is null then null else p_lng end,
    meet_note = nullif(left(trim(coalesce(p_note, '')), 200), '') where id = p_match;
end $$;
revoke all on function public.set_meet_spot(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.set_meet_spot(uuid, double precision, double precision, text) to authenticated;

-- 2. The driver's phone check now uses the meeting spot as the pickup point, passes the note, and says where the trip ends.
create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; rides jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
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
      coalesce(m.meet_lat, r.pickup_lat, pa.lat) as pickup_lat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as pickup_lng, m.meet_note,
      coalesce(r.dropoff_lat, da.lat) as dropoff_lat, coalesce(r.dropoff_lng, da.lng) as dropoff_lng,
      (m.meet_lat is not null or r.pickup_lat is not null) as pickup_exact, (r.dropoff_lat is not null) as dropoff_exact
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    left join public.areas pa on pa.name = r.pickup
    left join public.areas da on da.name = r.dropoff
    where m.driver_id = d and m.status = 'accepted' and m.en_route_at is not null and m.ride_date >= today - 1
    limit 6) y;
  -- where the driver is heading today (the newest active trip), so the phone can end the trip on arrival
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public.occurs_on(today, t.trip_date, t.repeat_days)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend, 'rides', rides, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;

-- 3. The phone ends a trip by itself when the driver reaches the destination with nobody left on board. Only trips switched on with
-- Offer a ride now end this way; scheduled trips stay posted. It refuses while any accepted rider has not been dropped off.
create or replace function public.end_trip_token(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare d uuid; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  if exists (select 1 from public.matches where driver_id = d and status = 'accepted' and dropped_off_at is null and ride_date >= today - 1) then
    return false;
  end if;
  update public.trips set active = false where user_id = d and live and active;
  delete from public.driver_positions where driver_id = d;
  return true;
end $$;
revoke all on function public.end_trip_token(text) from public;
grant execute on function public.end_trip_token(text) to anon, authenticated;

-- 4. The same phone helper also watches the rider's rides, so the rider gets an alert when the seat is confirmed, the driver is on the way,
-- or the driver has arrived and is waiting. Only a hash of the token is stored, as for drivers.
create or replace function public.rider_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; rides jsonb; active boolean; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  active := exists (select 1 from public.matches m where m.rider_id = u and m.status in ('requested', 'accepted') and m.ride_date >= today - 1)
         or exists (select 1 from public.ride_requests r where r.user_id = u and r.active and r.live and (r.expires_at is null or r.expires_at > now()));
  select coalesce(jsonb_agg(y order by y.ride_date, y.id), '[]'::jsonb) into rides from (
    select m.id, m.ride_date, coalesce(p.display_name, 'Your driver') as driver_name,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived'
           when m.en_route_at is not null then 'on_my_way' else 'accepted' end as stage,
      m.arrived_at, t.max_wait as wait_min,
      nullif(trim(concat_ws(' ', pc.car_color, pc.car_make, case when pc.car_plate is not null then '(' || pc.car_plate || ')' end)), '') as car,
      coalesce(r.pickup_label, r.pickup) as pickup_name, m.meet_note
    from public.matches m
    join public.trips t on t.id = m.trip_id
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.driver_id
    left join public.profile_cards pc on pc.user_id = m.driver_id
    where m.rider_id = u and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1
    limit 6) y;
  return jsonb_build_object('active', active, 'rides', rides);
end $$;
revoke all on function public.rider_alerts_token(text) from public;
grant execute on function public.rider_alerts_token(text) to anon, authenticated;
