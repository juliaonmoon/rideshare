-- 073: a full trip closes its other waiting requests. When a rider is accepted and the trip has no seat left on that day,
-- the other waiting requests for that trip and day are closed, so the driver never sees a request that cannot fit.
-- Run once in the Supabase SQL editor (safe to run again).
create or replace function public._close_when_full() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap integer; taken integer;
begin
  select coalesce(max_pickups, 3) into cap from public.trips where id = new.trip_id;
  select count(*)::int into taken from public.matches where trip_id = new.trip_id and ride_date = new.ride_date and status in ('accepted', 'completed');
  if cap is not null and taken >= cap then
    update public.matches set status = 'declined' where trip_id = new.trip_id and ride_date = new.ride_date and status = 'requested' and id <> new.id;
  end if;
  return new;
end $$;
revoke all on function public._close_when_full() from public, anon, authenticated;
drop trigger if exists matches_close_when_full on public.matches;
create trigger matches_close_when_full after update of status on public.matches for each row
  when (old.status = 'requested' and new.status = 'accepted') execute function public._close_when_full();