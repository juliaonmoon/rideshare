-- Migration 002: the server checks the points a rider offers (run once in Supabase > SQL Editor, after schema.sql).
-- Before: the rider's page sent any amount from 1 to 500. Now the server computes the most a ride could fairly cost
-- and rejects anything above it, so a modified page cannot overcharge or underpay beyond the fair range.
-- Fair upper bound: each stretch of road is shared by everyone aboard, so a rider pays at most half of the stretch
-- they ride; that stretch is at most the direct distance plus the driver's detour allowance (at 40 km/h).

create table if not exists public.areas (
  name text primary key,
  lat double precision not null,
  lng double precision not null
);
alter table public.areas enable row level security;
drop policy if exists "areas read" on public.areas;
create policy "areas read" on public.areas for select to authenticated using (true);
revoke insert, update, delete on public.areas from anon, authenticated;

insert into public.areas (name, lat, lng) values
  ('Surrey Central', 49.189, -122.849),
  ('Guildford (Surrey)', 49.191, -122.801),
  ('Fleetwood (Surrey)', 49.153, -122.795),
  ('Newton (Surrey)', 49.133, -122.845),
  ('Cloverdale (Surrey)', 49.105, -122.735),
  ('South Surrey', 49.05, -122.8),
  ('Port Coquitlam', 49.263, -122.781),
  ('Lougheed (Burnaby)', 49.2484, -122.897),
  ('Production Way (Burnaby)', 49.2539, -122.9181),
  ('SFU Burnaby', 49.2781, -122.9199),
  ('Brentwood (Burnaby)', 49.2665, -123.0007),
  ('BCIT / Willingdon (Burnaby)', 49.249, -123),
  ('Metrotown (Burnaby)', 49.2276, -123.0076),
  ('Whalley (Surrey)', 49.195, -122.865),
  ('Pattullo Bridge (New West)', 49.206, -122.9),
  ('Edmonds (Burnaby)', 49.2124, -122.9591),
  ('Royal Oak (Burnaby)', 49.22, -122.988),
  ('Braid (New West)', 49.233, -122.882),
  ('Sperling (Burnaby)', 49.259, -122.964)
on conflict (name) do update set lat = excluded.lat, lng = excluded.lng;

create or replace function public.area_km(p_a text, p_b text) returns double precision
language sql stable set search_path = public as $$
  select 2 * 6371 * asin(sqrt(
    sin(radians(b.lat - a.lat) / 2) ^ 2 +
    cos(radians(a.lat)) * cos(radians(b.lat)) * sin(radians(b.lng - a.lng) / 2) ^ 2)) * 1.35
  from public.areas a, public.areas b where a.name = p_a and b.name = p_b
$$;

create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_points integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; max_pts integer; direct double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.user_id = auth.uid() then raise exception 'You cannot ride with yourself'; end if;
  if p_pay_with not in ('points','cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  if p_pay_with = 'points' then
    direct := public.area_km(r.pickup, r.dropoff);
    if direct is null then raise exception 'Unknown area'; end if;
    max_pts := ceil(((direct + t.max_detour * 40.0 / 60.0) * t.cost_per_km / 2.0) / 0.10)::integer + 1;
    if p_points < 1 or p_points > max_pts then raise exception 'That points amount is outside the fair range (1 to %)', max_pts; end if;
  end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points)
    values (p_trip, p_request, t.user_id, auth.uid(), p_pay_with, case when p_pay_with = 'points' then p_points else 0 end)
    returning id into m;
  return m;
end $$;

revoke all on function public.request_seat(uuid, uuid, text, integer) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, integer) to authenticated;
