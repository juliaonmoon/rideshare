-- 067: a rider cannot hold two rides within an hour of each other.
-- Checked when a ride is requested or accepted-on-create (including auto-accept and regular rides).
create or replace function public._rider_no_double_booking() returns trigger language plpgsql security definer set search_path = public as $$
declare t_new public.trips; pk_new timestamptz; clash boolean;
begin
  if new.status not in ('requested', 'accepted') then return new; end if;
  select * into t_new from public.trips where id = new.trip_id;
  if not found then return new; end if;
  pk_new := coalesce(new.pickup_time, public.pickup_at(new.ride_date, t_new.depart_min));
  select exists (
    select 1 from public.matches x join public.trips tx on tx.id = x.trip_id
    where x.rider_id = new.rider_id and x.id is distinct from new.id
      and x.status in ('requested', 'accepted') and x.picked_up_at is null
      and x.ride_date between new.ride_date - 1 and new.ride_date + 1
      and abs(extract(epoch from (coalesce(x.pickup_time, public.pickup_at(x.ride_date, tx.depart_min)) - pk_new))) < 3600
  ) into clash;
  if clash then raise exception 'You already have a ride around that time. Cancel it first, or pick a different time.'; end if;
  return new;
end $$;
revoke all on function public._rider_no_double_booking() from public, anon, authenticated;
drop trigger if exists rider_no_double_booking on public.matches;
create trigger rider_no_double_booking before insert on public.matches for each row execute function public._rider_no_double_booking();