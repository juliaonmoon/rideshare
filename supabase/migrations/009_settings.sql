-- Migration 009: personal settings (run once in Supabase > SQL Editor, after 008). Safe to run twice.
-- Each person has ONE settings row with separate driver (d_) and rider (r_) defaults, because the same person can be both.
--   * d_detour / d_wait / d_accepts / d_seats: defaults for new trips (each trip can still be changed before posting).
--   * d_auto_accept: when ON, a seat request that fits (cash, or points the rider really has) is accepted instantly,
--     up to d_seats riders per trip per date. Otherwise the driver approves each request by hand.
--   * chat / pets: ride-style tags other people can see on your cards ("quiet ride", "pets ok").
-- Nothing here is sensitive; no gender or other personal data is stored.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  d_detour integer not null default 10 check (d_detour between 0 and 60),
  d_wait integer not null default 5 check (d_wait between 0 and 60),
  d_accepts text not null default 'either' check (d_accepts in ('points','cash','either')),
  d_seats integer not null default 3 check (d_seats between 1 and 6),
  d_auto_accept boolean not null default false,
  d_chat text not null default 'some' check (d_chat in ('quiet','some','chatty')),
  d_pets boolean not null default true,
  r_pays text not null default 'points' check (r_pays in ('points','cash')),
  r_chat text not null default 'some' check (r_chat in ('quiet','some','chatty')),
  r_pets boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "settings own read" on public.user_settings;
drop policy if exists "settings own insert" on public.user_settings;
drop policy if exists "settings own update" on public.user_settings;
create policy "settings own read" on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy "settings own insert" on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy "settings own update" on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_settings from anon;
grant select, insert, update on public.user_settings to authenticated;

-- Ride-style tags of other people (only chat style and pets; nothing else is shared).
create or replace function public.ride_styles(p_ids uuid[])
returns table (user_id uuid, d_chat text, d_pets boolean, r_chat text, r_pets boolean, auto_accept boolean)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.d_chat, s.d_pets, s.r_chat, s.r_pets, s.d_auto_accept
  from public.user_settings s where s.user_id = any (p_ids) and auth.uid() is not null
$$;
revoke all on function public.ride_styles(uuid[]) from public, anon;
grant execute on function public.ride_styles(uuid[]) to authenticated;

-- Auto-accept: runs right after a seat request is created.
create or replace function public.auto_accept_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.user_settings; bal integer; taken integer;
begin
  select * into s from public.user_settings where user_id = new.driver_id;
  if s.user_id is null or not s.d_auto_accept then return new; end if;
  if new.status <> 'requested' or new.ride_date < current_date - 1 then return new; end if;
  select count(*) into taken from public.matches
    where trip_id = new.trip_id and ride_date = new.ride_date and status = 'accepted' and id <> new.id;
  if taken >= s.d_seats then return new; end if;            -- full: leave it for the driver to decide
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
drop trigger if exists matches_auto_accept on public.matches;
create trigger matches_auto_accept after insert on public.matches for each row execute function public.auto_accept_new_match();
