-- Migration 011: the driver controls how many people they pick up and how much total time they give up
-- (run once in Supabase > SQL Editor, after 010). Safe to run twice.
--   * trips.max_pickups: 1 = a single pickup only, up to 4 riders.
--   * trips.max_total_detour: the most extra minutes for ALL pickups together (empty = same as max_detour).
--     max_detour keeps its meaning for ONE rider's pickup. The app checks both when matching.
--   * respond_match refuses to accept more riders than max_pickups for that date (hard limit, enforced by the database).
--   * Auto-accept only accepts the FIRST rider of a date; later riders need the driver's tap, so the total-time limit is respected.
--   * Settings get a default for the total limit (d_total_detour). The existing d_seats setting now means "most riders I pick up".

alter table public.trips add column if not exists max_pickups integer not null default 3;
alter table public.trips add column if not exists max_total_detour integer;
alter table public.trips drop constraint if exists trips_max_pickups_check;
alter table public.trips add constraint trips_max_pickups_check check (max_pickups between 1 and 4);
alter table public.trips drop constraint if exists trips_max_total_detour_check;
alter table public.trips add constraint trips_max_total_detour_check check (max_total_detour is null or max_total_detour between 0 and 120);
alter table public.user_settings add column if not exists d_total_detour integer not null default 15;
alter table public.user_settings drop constraint if exists user_settings_d_total_detour_check;
alter table public.user_settings add constraint user_settings_d_total_detour_check check (d_total_detour between 0 and 120);

-- Driver accepts or declines. Accepting with points HOLDS the points. Refuses to go over max_pickups for that date.
create or replace function public.respond_match(p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; bal integer; cap integer; taken integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your request'; end if;
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
revoke all on function public.respond_match(uuid, boolean) from public, anon;
grant execute on function public.respond_match(uuid, boolean) to authenticated;

-- Auto-accept: only the first rider of a date, and only when the trip allows a pickup.
create or replace function public.auto_accept_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.user_settings; bal integer; taken integer; cap integer;
begin
  select * into s from public.user_settings where user_id = new.driver_id;
  if s.user_id is null or not s.d_auto_accept then return new; end if;
  if new.status <> 'requested' or new.ride_date < current_date - 1 then return new; end if;
  select max_pickups into cap from public.trips where id = new.trip_id;
  select count(*) into taken from public.matches
    where trip_id = new.trip_id and ride_date = new.ride_date and status in ('accepted','completed') and id <> new.id;
  if taken > 0 or coalesce(cap, 3) < 1 then return new; end if;   -- later riders: the driver decides
  if new.pay_with = 'points' and new.points > 0 then
    select points into bal from public.wallets where user_id = new.rider_id for update;
    if bal is null or bal < new.points then return new; end if;
    update public.wallets set points = points - new.points where user_id = new.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id)
      values (new.rider_id, -new.points, 'Ride paid with points (held until the ride)', new.id);
  end if;
  update public.matches set status = 'accepted' where id = new.id;
  return new;
end $$;

-- Offer a ride now: also takes the pickup limits.
drop function if exists public.go_live_trip(text, text, integer, integer, text, numeric, integer);
create or replace function public.go_live_trip(p_origin text, p_dest text, p_max_detour integer, p_max_wait integer, p_accepts text, p_cost_per_km numeric, p_minutes integer default 30, p_max_pickups integer default 3, p_max_total_detour integer default null)
returns uuid language plpgsql as $$
declare t timestamp; id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 720 then raise exception 'Choose between 15 minutes and 12 hours'; end if;
  t := (now() at time zone 'America/Vancouver') + interval '5 minutes';
  update public.trips set active = false where user_id = auth.uid() and live and active;
  insert into public.trips (user_id, origin, dest, depart_min, max_detour, max_wait, accepts, cost_per_km, trip_date, repeat_days, live, expires_at, max_pickups, max_total_detour)
    values (auth.uid(), p_origin, p_dest, (extract(hour from t) * 60 + extract(minute from t))::int, p_max_detour, p_max_wait, p_accepts, p_cost_per_km, t::date, '{}', true, now() + (p_minutes * interval '1 minute'), p_max_pickups, p_max_total_detour)
    returning trips.id into id;
  return id;
end $$;
revoke all on function public.go_live_trip(text, text, integer, integer, text, numeric, integer, integer, integer) from public, anon;
grant execute on function public.go_live_trip(text, text, integer, integer, text, numeric, integer, integer, integer) to authenticated;
