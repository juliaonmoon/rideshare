-- 071: rider location sharing (the rider chooses, per ride). The driver sees where the rider is, only for that ride.
--   * Off by default. The rider turns it on for one ride and can stop any time.
--   * Works only from 15 minutes before pickup until 60 minutes after, and stops when the rider is picked up or the ride ends.
--   * Only the driver of that ride can read it. It is deleted when the ride ends. Nothing is kept in a history.
-- Needs 063. Run once in the Supabase SQL editor (safe to run again).

alter table public.matches add column if not exists rider_share boolean not null default false;

create table if not exists public.rider_locations (
  match_id uuid primary key references public.matches(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy real,
  updated_at timestamptz not null default now()
);
alter table public.rider_locations enable row level security;
revoke all on public.rider_locations from anon, authenticated;

create or replace function public._share_window_ok(m public.matches) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t public.trips; pk timestamptz;
begin
  select * into t from public.trips where id = m.trip_id;
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  return m.status = 'accepted' and m.picked_up_at is null and m.dropped_off_at is null
     and now() >= pk - interval '15 minutes' and now() <= pk + interval '60 minutes';
end $$;
revoke all on function public._share_window_ok(public.matches) from public, anon, authenticated;

create or replace function public.set_location_sharing(p_match uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if p_on then
    if not public._share_window_ok(m) then raise exception 'You can share your location from 15 minutes before pickup until you are picked up'; end if;
    update public.matches set rider_share = true where id = p_match;
  else
    update public.matches set rider_share = false where id = p_match;
    delete from public.rider_locations where match_id = p_match;
  end if;
  return p_on;
end $$;
revoke all on function public.set_location_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_location_sharing(uuid, boolean) to authenticated;

create or replace function public.share_rider_position(p_match uuid, p_lat double precision, p_lng double precision, p_accuracy real default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad position'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if not m.rider_share or not public._share_window_ok(m) then
    delete from public.rider_locations where match_id = p_match;
    return false;
  end if;
  insert into public.rider_locations (match_id, lat, lng, accuracy, updated_at) values (p_match, p_lat, p_lng, p_accuracy, now())
    on conflict (match_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, updated_at = now();
  return true;
end $$;
revoke all on function public.share_rider_position(uuid, double precision, double precision, real) from public, anon;
grant execute on function public.share_rider_position(uuid, double precision, double precision, real) to authenticated;

-- the driver reads it (null when not sharing, stale for over 2 minutes, or the ride is not in its window)
create or replace function public.rider_position(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.matches; l public.rider_locations; r public.ride_requests; plat double precision; plng double precision; km double precision;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if not m.rider_share or not public._share_window_ok(m) then return null; end if;
  select * into l from public.rider_locations where match_id = p_match;
  if l.match_id is null or l.updated_at < now() - interval '2 minutes' then return null; end if;
  select * into r from public.ride_requests where id = m.request_id;
  plat := coalesce(m.meet_lat, r.pickup_lat); plng := coalesce(m.meet_lng, r.pickup_lng);
  if plat is not null and plng is not null then km := public._road_km(l.lat, l.lng, plat, plng); end if;
  return jsonb_build_object('lat', l.lat, 'lng', l.lng, 'age_s', floor(extract(epoch from now() - l.updated_at))::int,
                            'to_pickup_m', case when km is null then null else round(km * 1000)::int end);
end $$;
revoke all on function public.rider_position(uuid) from public, anon;
grant execute on function public.rider_position(uuid) to authenticated;

-- when the ride moves on (picked up, cancelled, finished) the position is deleted and sharing switches off
create or replace function public._clear_rider_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.rider_locations where match_id = new.id;
  update public.matches set rider_share = false where id = new.id and rider_share;
  return new;
end $$;
revoke all on function public._clear_rider_location() from public, anon, authenticated;
drop trigger if exists matches_clear_rider_location on public.matches;
create trigger matches_clear_rider_location after update on public.matches for each row
  when (new.rider_share and (new.picked_up_at is not null or new.status <> 'accepted' or new.dropped_off_at is not null)) execute function public._clear_rider_location();