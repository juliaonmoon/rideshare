-- Photo and car details that a matched driver and rider can see about each other, plus a Report a problem table.
-- Run once in the Supabase SQL editor (safe to run again).

create table if not exists public.profile_cards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  photo text check (photo is null or (length(photo) <= 150000 and photo ~ '^(https://|data:image/jpeg;base64,)')),
  photo_source text check (photo_source is null or photo_source in ('upload', 'google')),
  car_make text check (car_make is null or length(car_make) <= 40),
  car_color text check (car_color is null or length(car_color) <= 30),
  car_plate text check (car_plate is null or length(car_plate) <= 12),
  updated_at timestamptz not null default now()
);
alter table public.profile_cards enable row level security;

drop policy if exists "cards read own" on public.profile_cards;
drop policy if exists "cards read matched" on public.profile_cards;
drop policy if exists "cards insert own" on public.profile_cards;
drop policy if exists "cards update own" on public.profile_cards;
drop policy if exists "cards delete own" on public.profile_cards;

-- You always see your own card.
create policy "cards read own" on public.profile_cards for select to authenticated using (user_id = auth.uid());
-- You see the card of the other person only when a seat between you is accepted, or was completed in the last 30 days.
create policy "cards read matched" on public.profile_cards for select to authenticated using (
  exists (
    select 1 from public.matches m
    where m.status in ('accepted', 'completed')
      and m.ride_date >= (now() at time zone 'America/Vancouver')::date - 30
      and ((m.driver_id = auth.uid() and m.rider_id = profile_cards.user_id)
        or (m.rider_id = auth.uid() and m.driver_id = profile_cards.user_id))
  )
);
create policy "cards insert own" on public.profile_cards for insert to authenticated with check (user_id = auth.uid());
create policy "cards update own" on public.profile_cards for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cards delete own" on public.profile_cards for delete to authenticated using (user_id = auth.uid());

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid,
  reason text not null check (reason in ('late_or_absent', 'unsafe', 'wrong_car_or_person', 'rude', 'payment', 'other')),
  details text check (details is null or length(details) <= 1000),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);
alter table public.reports enable row level security;
drop policy if exists "reports insert own" on public.reports;
drop policy if exists "reports read own" on public.reports;
-- Anyone signed in can file a report about someone they share an accepted or completed seat with.
create policy "reports insert own" on public.reports for insert to authenticated with check (
  reporter_id = auth.uid()
  and exists (
    select 1 from public.matches m
    where m.status in ('accepted', 'completed')
      and ((m.driver_id = auth.uid() and m.rider_id = reported_id) or (m.rider_id = auth.uid() and m.driver_id = reported_id))
  )
);
create policy "reports read own" on public.reports for select to authenticated using (reporter_id = auth.uid());
