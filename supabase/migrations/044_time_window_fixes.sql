-- Migration 044: fixes from the code review of the time-window trips (migration 042).
--   * Once a rider has a confirmed seat, the trip's time window and its lock can no longer be changed (same rule as the leave time).
--   * When the last accepted rider cancels, the trip is locked while it is checked, so a rider being accepted at the same moment cannot be undone by mistake.
-- Needs migrations 025 and 042. Run once in the Supabase SQL editor (safe to run again).

create or replace function public._freeze_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare booked boolean;
begin
  if coalesce(current_setting('app.cancel_ok', true), '') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'trips' then
    booked := exists (select 1 from public.matches m where m.trip_id = old.id and m.status = 'accepted' and m.dropped_off_at is null);
  else
    booked := exists (select 1 from public.matches m where m.request_id = old.id and m.status = 'accepted' and m.dropped_off_at is null);
  end if;
  if not booked then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then raise exception 'A rider has a confirmed seat. Use Cancel my trip / Cancel my request first.'; end if;
  if tg_table_name = 'trips' then
    if old.active and new.active is false then raise exception 'A rider has a confirmed seat. Use Cancel my trip so everyone is refunded.'; end if;
    if (new.depart_min, new.trip_date, new.origin, new.dest, new.origin_lat, new.origin_lng, new.dest_lat, new.dest_lng, new.max_wait, new.accepts, new.repeat_days, new.flex_from, new.flex_to, new.flex_locked)
       is distinct from (old.depart_min, old.trip_date, old.origin, old.dest, old.origin_lat, old.origin_lng, old.dest_lat, old.dest_lng, old.max_wait, old.accepts, old.repeat_days, old.flex_from, old.flex_to, old.flex_locked) then
      raise exception 'A rider has a confirmed seat. The route, time and payment can no longer be changed.';
    end if;
  else
    if old.active and new.active is false then raise exception 'You have a confirmed seat. Use Cancel my request so everything is refunded.'; end if;
    if (new.pickup, new.dropoff, new.pickup_lat, new.pickup_lng, new.dropoff_lat, new.dropoff_lng, new.ride_date, new.ready_from, new.ready_to, new.pays, new.repeat_days)
       is distinct from (old.pickup, old.dropoff, old.pickup_lat, old.pickup_lng, old.dropoff_lat, old.dropoff_lng, old.ride_date, old.ready_from, old.ready_to, old.pays, old.repeat_days) then
      raise exception 'You have a confirmed seat. The journey can no longer be changed.';
    end if;
  end if;
  return new;
end $$;

create or replace function public._flex_unlock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'accepted' and new.status is distinct from 'accepted' then
    perform 1 from public.trips where id = new.trip_id for update;   -- wait for an accept that is happening right now
    update public.trips set flex_locked = false, depart_min = flex_from
     where id = new.trip_id and flex_to is not null and flex_locked
       and not exists (select 1 from public.matches x where x.trip_id = new.trip_id and x.status in ('accepted', 'completed'));
  end if;
  return null;
end $$;
