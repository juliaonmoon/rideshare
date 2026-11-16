-- 070: repeat late marks get a warning and a human review (no automatic punishment).
-- A late mark = a ride the driver cancelled late, or never arrived for, in the last 30 days.
-- At 3 marks the driver gets a warning notice and a row in driver_reviews for the team to look at. Only the team can read it (Supabase table editor).
-- Run once in the Supabase SQL editor (safe to run again). Needs 053 and 061.

create table if not exists public.driver_reviews (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  marks integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  team_note text
);
alter table public.driver_reviews enable row level security;
revoke all on public.driver_reviews from anon, authenticated;

create or replace function public._warn_repeat_late() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer; who text;
begin
  select count(*)::int into n from public.matches m
   where m.driver_id = new.driver_id and m.status = 'cancelled' and m.cancelled_by = m.driver_id
     and (m.late or m.driver_late) and coalesce(m.cancelled_at, now()) > now() - interval '30 days';
  if n < 3 then return new; end if;
  if exists (select 1 from public.driver_reviews r where r.driver_id = new.driver_id and r.status = 'open' and r.created_at > now() - interval '30 days') then return new; end if;
  select coalesce(nullif(display_name, ''), 'A driver') into who from public.profiles where id = new.driver_id;
  insert into public.driver_reviews (driver_id, marks, reason) values (new.driver_id, n, who || ' has ' || n || ' late cancels or no-shows in the last 30 days.');
  insert into public.notices (user_id, kind, title, body, match_id) values (new.driver_id, 'late_warning', 'A friendly warning',
    'You have ' || n || ' late cancels or missed pickups in the last 30 days. Riders count on you being there. The team may take a look and will be fair. If something happened, you can write to us.', new.id);
  return new;
exception when others then
  return new;   -- never block a cancel because of this
end $$;
revoke all on function public._warn_repeat_late() from public, anon, authenticated;
drop trigger if exists matches_warn_repeat_late on public.matches;
create trigger matches_warn_repeat_late after update of status on public.matches for each row
  when (new.status = 'cancelled' and new.cancelled_by = new.driver_id and (new.late or new.driver_late)) execute function public._warn_repeat_late();