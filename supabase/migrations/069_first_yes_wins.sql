-- 069: first yes wins. When a driver accepts a rider, the rider's other waiting requests for the same day to other drivers are closed,
-- so those drivers see them go away instead of accepting a ride that is already taken.
-- Also: the no-double-booking rule from 067 now lets one request be sent to several drivers at once (same request, different trips).
-- Run once in the Supabase SQL editor (safe to run again).

create or replace function public._rider_no_double_booking() returns trigger language plpgsql security definer set search_path = public as $$
declare t_new public.trips; pk_new timestamptz; clash boolean;
begin
  if new.status not in ('requested', 'accepted') then return new; end if;
  select * into t_new from public.trips where id = new.trip_id;
  if not found then return new; end if;
  pk_new := coalesce(new.pickup_time, public.pickup_at(new.ride_date, t_new.depart_min));
  select exists (
    select 1 from public.matches x join public.trips tx on tx.id = x.trip_id
    where x.rider_id = new.rider_id and x.id is distinct from new.id and x.request_id is distinct from new.request_id
      and x.status in ('requested', 'accepted') and x.picked_up_at is null
      and x.ride_date between new.ride_date - 1 and new.ride_date + 1
      and abs(extract(epoch from (coalesce(x.pickup_time, public.pickup_at(x.ride_date, tx.depart_min)) - pk_new))) < 3600
  ) into clash;
  if clash then raise exception 'You already have a ride around that time. Cancel it first, or pick a different time.'; end if;
  return new;
end $$;

create or replace function public._close_sibling_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.matches set status = 'declined'
   where request_id = new.request_id and ride_date = new.ride_date and status = 'requested' and id <> new.id;
  return new;
end $$;
revoke all on function public._close_sibling_requests() from public, anon, authenticated;
drop trigger if exists matches_close_siblings on public.matches;
create trigger matches_close_siblings after update of status on public.matches for each row
  when (old.status = 'requested' and new.status = 'accepted') execute function public._close_sibling_requests();