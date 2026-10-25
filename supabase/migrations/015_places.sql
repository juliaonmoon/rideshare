-- Migration 015: real places (address search) for trips and ride requests
-- (run once in Supabase > SQL Editor, after 014). Safe to run twice.
--
-- Each trip and request keeps its neighbourhood name in origin/dest/pickup/dropoff (so prices and matching keep working),
-- and now also a short place label and a point on the map.
-- Privacy: other people only ever see the neighbourhood. The point is rounded to about 100 metres (3 decimals), and the label
-- loses any leading house number, so a home address is never stored. The database does the rounding itself, whatever the app sends.

alter table public.trips
  add column if not exists origin_label text, add column if not exists origin_lat double precision, add column if not exists origin_lng double precision,
  add column if not exists dest_label text,   add column if not exists dest_lat double precision,   add column if not exists dest_lng double precision;
alter table public.ride_requests
  add column if not exists pickup_label text,  add column if not exists pickup_lat double precision,  add column if not exists pickup_lng double precision,
  add column if not exists dropoff_label text, add column if not exists dropoff_lat double precision, add column if not exists dropoff_lng double precision;

-- Internal helpers
create or replace function public._clean_label(p text) returns text language sql immutable as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '^\s*#?[0-9][0-9A-Za-z-]*\s+', '')), 60), '')
$$;
create or replace function public._clean_coord(p double precision, lo double precision, hi double precision) returns double precision language sql immutable as $$
  select case when p between lo and hi then round(p::numeric, 3)::double precision else null end
$$;

create or replace function public.round_trip_places() returns trigger language plpgsql as $$
begin
  new.origin_label := public._clean_label(new.origin_label); new.dest_label := public._clean_label(new.dest_label);
  new.origin_lat := public._clean_coord(new.origin_lat, 48, 60);  new.origin_lng := public._clean_coord(new.origin_lng, -140, -114);
  new.dest_lat   := public._clean_coord(new.dest_lat, 48, 60);    new.dest_lng   := public._clean_coord(new.dest_lng, -140, -114);
  if new.origin_lat is null or new.origin_lng is null then new.origin_lat := null; new.origin_lng := null; end if;
  if new.dest_lat is null or new.dest_lng is null then new.dest_lat := null; new.dest_lng := null; end if;
  return new;
end $$;
drop trigger if exists trips_round_places on public.trips;
create trigger trips_round_places before insert or update on public.trips for each row execute function public.round_trip_places();

create or replace function public.round_request_places() returns trigger language plpgsql as $$
begin
  new.pickup_label := public._clean_label(new.pickup_label); new.dropoff_label := public._clean_label(new.dropoff_label);
  new.pickup_lat := public._clean_coord(new.pickup_lat, 48, 60);   new.pickup_lng := public._clean_coord(new.pickup_lng, -140, -114);
  new.dropoff_lat := public._clean_coord(new.dropoff_lat, 48, 60); new.dropoff_lng := public._clean_coord(new.dropoff_lng, -140, -114);
  if new.pickup_lat is null or new.pickup_lng is null then new.pickup_lat := null; new.pickup_lng := null; end if;
  if new.dropoff_lat is null or new.dropoff_lng is null then new.dropoff_lat := null; new.dropoff_lng := null; end if;
  return new;
end $$;
drop trigger if exists requests_round_places on public.ride_requests;
create trigger requests_round_places before insert or update on public.ride_requests for each row execute function public.round_request_places();
