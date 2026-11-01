-- Migration 030: the distance of a drive is tracked for the whole trip, not only while a rider is in the car.
-- Before: positions were accepted only when a rider was on the way, so a trip with no rider (or the stretch before pickup) showed about 1 km.
-- Now: positions are accepted whenever the driver has a trip on today, drives are linked to that trip, and a gap in readings (a tunnel,
-- a weak signal) still counts the straight-line distance when it is possible at normal road speeds.
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 014.

create or replace function public._driver_trip_today(d uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.trips t
   where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
     and public.occurs_on((now() at time zone 'America/Vancouver')::date, t.trip_date, t.repeat_days)
   order by t.live desc, t.created_at desc limit 1;
$$;
revoke all on function public._driver_trip_today(uuid) from public, anon, authenticated;

create or replace function public._log_drive(d uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
declare s public.drive_sessions; km numeric; hours double precision;
begin
  select * into s from public.drive_sessions
    where driver_id = d and ended_at is null and last_at > now() - interval '30 minutes' order by started_at desc limit 1;
  if s.id is null then
    update public.drive_sessions set ended_at = last_at where driver_id = d and ended_at is null;
    insert into public.drive_sessions (driver_id, trip_id, last_lat, last_lng)
      values (d, coalesce((select trip_id from public.matches where driver_id = d and status in ('accepted','completed') and en_route_at is not null order by en_route_at desc limit 1),
                          public._driver_trip_today(d)), p_lat, p_lng);
    return;
  end if;
  km := 2 * 6371 * asin(sqrt(power(sin(radians(p_lat - s.last_lat) / 2), 2) + cos(radians(s.last_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.last_lng) / 2), 2)));
  hours := greatest(extract(epoch from (now() - s.last_at)) / 3600.0, 0);
  if km < 0.02 then
    update public.drive_sessions set last_at = now() where id = s.id;      -- standing still or GPS noise: no distance
  elsif km > 0.2 + 150 * hours then
    update public.drive_sessions set last_at = now(), last_lat = p_lat, last_lng = p_lng where id = s.id;   -- too far for the time that passed (a GPS glitch): skip it
  else
    update public.drive_sessions set distance_km = distance_km + km, last_at = now(), last_lat = p_lat, last_lng = p_lng where id = s.id;
    update public.matches set ride_km = ride_km + km
      where driver_id = d and picked_up_at is not null and dropped_off_at is null and status = 'accepted';
  end if;
end $$;
revoke all on function public._log_drive(uuid, double precision, double precision) from public, anon, authenticated;

create or replace function public.share_position(p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.matches where driver_id = auth.uid() and status = 'accepted' and en_route_at is not null) and public._driver_trip_today(auth.uid()) is null then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (auth.uid(), p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
  perform public._log_drive(auth.uid(), p_lat, p_lng);
end $$;

create or replace function public.share_position_token(p_token text, p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  if not exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null) and public._driver_trip_today(d) is null then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (d, p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
  perform public._log_drive(d, p_lat, p_lng);
end $$;
