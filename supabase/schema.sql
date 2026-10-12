-- RideShare database setup (Supabase / Postgres).
-- Run once in: Supabase > SQL Editor > New query > paste > Run.
-- Privacy: only neighbourhood-level area names are stored (never exact addresses or phone numbers).
-- Row Level Security is ON for every table; people only see what the policies below allow.
-- Points move only through the functions at the bottom, never by editing tables directly.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Rider' check (char_length(display_name) between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points integer not null default 40 check (points >= 0)
);

create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  match_id uuid,
  created_at timestamptz not null default now()
);

-- A driver's posted commute.
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  origin text not null check (char_length(origin) <= 60),
  dest text not null check (char_length(dest) <= 60),
  depart_min integer not null check (depart_min between 0 and 1439),
  max_detour integer not null check (max_detour between 0 and 60),
  max_wait integer not null check (max_wait between 0 and 60),
  accepts text not null check (accepts in ('points','cash','either')),
  cost_per_km numeric(4,2) not null default 0.20 check (cost_per_km between 0 and 1),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A rider's posted need.
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pickup text not null check (char_length(pickup) <= 60),
  dropoff text not null check (char_length(dropoff) <= 60),
  ready_from integer not null check (ready_from between 0 and 1439),
  ready_to integer not null check (ready_to between 0 and 1439),
  pays text not null check (pays in ('points','cash','either')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A rider asking a driver for a seat.
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  request_id uuid not null references public.ride_requests(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  rider_id uuid not null references auth.users(id) on delete cascade,
  pay_with text not null check (pay_with in ('points','cash')),
  points integer not null default 0 check (points between 0 and 500),
  status text not null default 'requested' check (status in ('requested','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  unique (trip_id, request_id)
);

create index if not exists trips_active_idx on public.trips (active, origin, dest);
create index if not exists requests_active_idx on public.ride_requests (active, pickup, dropoff);
create index if not exists matches_driver_idx on public.matches (driver_id);
create index if not exists matches_rider_idx on public.matches (rider_id);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger enable row level security;
alter table public.trips enable row level security;
alter table public.ride_requests enable row level security;
alter table public.matches enable row level security;

-- profiles: any signed-in person can see names; you can edit only your own.
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- wallets and ledger: private to the owner, read-only (changes happen in the functions below).
create policy "wallet read own" on public.wallets for select to authenticated using (user_id = auth.uid());
create policy "ledger read own" on public.ledger for select to authenticated using (user_id = auth.uid());

-- trips and ride requests: signed-in people can browse active ones; you manage your own.
create policy "trips read" on public.trips for select to authenticated using (active or user_id = auth.uid());
create policy "trips insert own" on public.trips for insert to authenticated with check (user_id = auth.uid());
create policy "trips update own" on public.trips for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "trips delete own" on public.trips for delete to authenticated using (user_id = auth.uid());

create policy "requests read" on public.ride_requests for select to authenticated using (active or user_id = auth.uid());
create policy "requests insert own" on public.ride_requests for insert to authenticated with check (user_id = auth.uid());
create policy "requests update own" on public.ride_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "requests delete own" on public.ride_requests for delete to authenticated using (user_id = auth.uid());

-- matches: only the driver and the rider involved can see it. No direct writes at all.
create policy "matches read involved" on public.matches for select to authenticated
  using (driver_id = auth.uid() or rider_id = auth.uid());

-- Lock direct writes to the money-related tables; nothing is readable without signing in.
revoke insert, update, delete on public.wallets, public.ledger, public.matches from anon, authenticated;
revoke all on all tables in schema public from anon;

-- New sign-up: create a profile and a starting wallet (40 demo points for the pilot).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(nullif(left(new.raw_user_meta_data->>'display_name', 30), ''), left(split_part(new.email, '@', 1), 30)));
  insert into public.wallets (user_id) values (new.id);
  insert into public.ledger (user_id, delta, reason) values (new.id, 40, 'Welcome points');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rider asks a driver for a seat.
create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_points integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.user_id = auth.uid() then raise exception 'You cannot ride with yourself'; end if;
  if p_pay_with not in ('points','cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  if p_pay_with = 'points' and (p_points < 1 or p_points > 500) then raise exception 'Bad points amount'; end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points)
    values (p_trip, p_request, t.user_id, auth.uid(), p_pay_with, case when p_pay_with = 'points' then p_points else 0 end)
    returning id into m;
  return m;
end $$;

-- Driver accepts or declines. Accepting with points moves the points in one step.
create or replace function public.respond_match(p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; bal integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  if m.pay_with = 'points' and m.points > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < m.points then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - m.points where user_id = m.rider_id;
    update public.wallets set points = points + m.points where user_id = m.driver_id;
    insert into public.ledger (user_id, delta, reason, match_id) values
      (m.rider_id, -m.points, 'Ride paid with points', m.id),
      (m.driver_id, m.points, 'Earned giving a ride', m.id);
  end if;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;

-- Rider cancels a request that is still waiting.
create or replace function public.cancel_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.matches set status = 'cancelled' where id = p_match and rider_id = auth.uid() and status = 'requested';
  if not found then raise exception 'Cannot cancel this request'; end if;
end $$;

revoke all on function public.request_seat(uuid, uuid, text, integer) from public, anon;
revoke all on function public.respond_match(uuid, boolean) from public, anon;
revoke all on function public.cancel_match(uuid) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, integer) to authenticated;
grant execute on function public.respond_match(uuid, boolean) to authenticated;
grant execute on function public.cancel_match(uuid) to authenticated;

-- Live updates for matches.
alter publication supabase_realtime add table public.matches;
