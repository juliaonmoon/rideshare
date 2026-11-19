-- 074: remember why a waiting request was closed, so the app can show it under "Missed requests".
-- Run once in the Supabase SQL editor (safe to run again). Needs 069 and 073.
alter table public.matches add column if not exists closed_reason text;

create or replace function public._close_sibling_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.matches set status = 'declined', closed_reason = 'taken'
   where request_id = new.request_id and ride_date = new.ride_date and status = 'requested' and id <> new.id;
  return new;
end $$;
revoke all on function public._close_sibling_requests() from public, anon, authenticated;

create or replace function public._close_when_full() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap integer; taken integer;
begin
  select coalesce(max_pickups, 3) into cap from public.trips where id = new.trip_id;
  select count(*)::int into taken from public.matches where trip_id = new.trip_id and ride_date = new.ride_date and status in ('accepted', 'completed');
  if cap is not null and taken >= cap then
    update public.matches set status = 'declined', closed_reason = 'full' where trip_id = new.trip_id and ride_date = new.ride_date and status = 'requested' and id <> new.id;
  end if;
  return new;
end $$;
revoke all on function public._close_when_full() from public, anon, authenticated;