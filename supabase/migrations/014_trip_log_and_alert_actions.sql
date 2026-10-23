-- Migration 014: keep the real story of every drive, and let the driver answer a seat request from the phone alert
-- (run once in Supabase > SQL Editor, after 013). Safe to run twice.
--
-- 1. TRIP LOG. While the driver's phone shares its position (during a ride), the database adds up the time and the distance driven.
--    Only totals are kept (start, end, kilometres), never a trail of where you went. This is why restarting Google Maps to add a
--    stop loses nothing: RideShare keeps counting. A gap of more than 30 minutes starts a new drive.
--      * drive_sessions: one row per drive (started, last seen, ended, kilometres).
--      * matches.ride_km: kilometres driven while THIS rider was in the car (rider sees it after the ride).
-- 2. ALERT BUTTONS. The phone helper can accept or decline a request from the notification (same token as the position updates),
--    using the exact same rules as the app (including the pickup limit).

alter table public.matches add column if not exists ride_km numeric(7,2) not null default 0;

create table if not exists public.drive_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  ride_date date not null default ((now() at time zone 'America/Vancouver')::date),
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  ended_at timestamptz,
  distance_km numeric(8,2) not null default 0,
  last_lat double precision,
  last_lng double precision
);
create index if not exists drive_sessions_driver_idx on public.drive_sessions (driver_id, started_at desc);
alter table public.drive_sessions enable row level security;
drop policy if exists "drive sessions own read" on public.drive_sessions;
create policy "drive sessions own read" on public.drive_sessions for select to authenticated using (driver_id = auth.uid());
revoke all on public.drive_sessions from anon, authenticated;
grant select on public.drive_sessions to authenticated;

-- Internal: add one position to the driver's current drive.
create or replace function public._log_drive(d uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
declare s public.drive_sessions; km numeric;
begin
  select * into s from public.drive_sessions
    where driver_id = d and ended_at is null and last_at > now() - interval '30 minutes' order by started_at desc limit 1;
  if s.id is null then
    update public.drive_sessions set ended_at = last_at where driver_id = d and ended_at is null;
    insert into public.drive_sessions (driver_id, trip_id, last_lat, last_lng)
      values (d, (select trip_id from public.matches where driver_id = d and status in ('accepted','completed') and en_route_at is not null order by en_route_at desc limit 1), p_lat, p_lng);
    return;
  end if;
  km := 2 * 6371 * asin(sqrt(power(sin(radians(p_lat - s.last_lat) / 2), 2) + cos(radians(s.last_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.last_lng) / 2), 2)));
  if km < 0.02 then
    update public.drive_sessions set last_at = now() where id = s.id;      -- standing still or GPS noise: no distance
  elsif km > 2 then
    update public.drive_sessions set last_at = now(), last_lat = p_lat, last_lng = p_lng where id = s.id;   -- a jump (GPS glitch or signal gap): skip it
  else
    update public.drive_sessions set distance_km = distance_km + km, last_at = now(), last_lat = p_lat, last_lng = p_lng where id = s.id;
    update public.matches set ride_km = ride_km + km
      where driver_id = d and picked_up_at is not null and dropped_off_at is null and status = 'accepted';
  end if;
end $$;
revoke all on function public._log_drive(uuid, double precision, double precision) from public, anon, authenticated;

-- Position from the signed-in phone (website): also logs the drive.
create or replace function public.share_position(p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.matches where driver_id = auth.uid() and status = 'accepted' and en_route_at is not null) then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (auth.uid(), p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
  perform public._log_drive(auth.uid(), p_lat, p_lng);
end $$;

-- Position from the Android helper (token): also logs the drive.
create or replace function public.share_position_token(p_token text, p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  if not exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null) then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (d, p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
  perform public._log_drive(d, p_lat, p_lng);
end $$;

-- Stopping closes the drive (and still removes the live position and the token).
create or replace function public.stop_sharing() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.driver_positions where driver_id = auth.uid();
  delete from public.tracking_tokens where driver_id = auth.uid();
  update public.drive_sessions set ended_at = now() where driver_id = auth.uid() and ended_at is null;
end $$;

-- ---------- accept or decline: one set of rules for the app and for the phone alert ----------
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

create or replace function public.respond_match(p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return public._respond_match(auth.uid(), p_match, p_accept);
end $$;

-- From the phone alert (no login session, only the short-lived tracking token).
create or replace function public.respond_match_token(p_token text, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  return public._respond_match(d, p_match, p_accept);
end $$;

revoke all on function public.share_position(double precision, double precision, real, real, real) from public, anon;
grant execute on function public.share_position(double precision, double precision, real, real, real) to authenticated;
revoke all on function public.share_position_token(text, double precision, double precision, real, real, real) from public;
grant execute on function public.share_position_token(text, double precision, double precision, real, real, real) to anon, authenticated;
revoke all on function public.stop_sharing() from public, anon;
grant execute on function public.stop_sharing() to authenticated;
revoke all on function public.respond_match(uuid, boolean) from public, anon;
grant execute on function public.respond_match(uuid, boolean) to authenticated;
revoke all on function public.respond_match_token(text, uuid, boolean) from public;
grant execute on function public.respond_match_token(text, uuid, boolean) to anon, authenticated;
