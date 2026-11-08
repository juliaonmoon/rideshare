-- Migration 053: changing a trip, and telling people when a confirmed ride is cancelled.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 044, 048 and 049.
--
--  1. A trip with a confirmed rider on ANY of its dates cannot be changed (route, time, days, payment): cancel it and post a new one.
--     (Before, a repeating trip with a time window could still be changed while some of its days had riders.)
--  2. When a trip is changed (and has no confirmed rider), the requests still waiting for an answer are checked again.
--     A request that no longer fits (route, time, detour limits, payment, days) is deleted. Valid ones stay. Nobody is told:
--     nothing was confirmed.
--  3. Notices: when a CONFIRMED ride is cancelled, the other person gets a notice in the app: what was cancelled,
--     which day, the route, and the points returned.

-- ---------- 1. a booked trip is frozen ----------
create or replace function public._freeze_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare booked boolean;
begin
  if coalesce(current_setting('app.cancel_ok', true), '') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'trips' then
    -- a trip is booked when any of its dates has a confirmed rider (the separate days of a repeating trip with a time window count too)
    booked := exists (select 1 from public.matches m where (m.trip_id = old.id or m.trip_id in (select c.id from public.trips c where c.series_parent = old.id)) and m.status = 'accepted' and m.dropped_off_at is null);
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

-- ---------- 2. waiting requests are checked again when a trip changes ----------
create or replace function public._revalidate_requests() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; q jsonb;
begin
  if not new.active then return new; end if;
  if new.flex_locked is distinct from old.flex_locked then return new; end if;   -- the first accepted rider fixing the time, or the window opening again, is not an edit
  if (old.origin, old.dest, old.origin_lat, old.origin_lng, old.dest_lat, old.dest_lng, old.depart_min, old.flex_from, old.flex_to, old.max_detour, old.max_total_detour, old.max_detour_km, old.max_total_detour_km, old.max_pickups, old.accepts, old.repeat_days, old.repeat_every, old.repeat_nth, old.repeat_until, old.trip_date)
     is not distinct from
     (new.origin, new.dest, new.origin_lat, new.origin_lng, new.dest_lat, new.dest_lng, new.depart_min, new.flex_from, new.flex_to, new.max_detour, new.max_total_detour, new.max_detour_km, new.max_total_detour_km, new.max_pickups, new.accepts, new.repeat_days, new.repeat_every, new.repeat_nth, new.repeat_until, new.trip_date)
  then return new; end if;
  for m in select id, request_id, ride_date, pay_with from public.matches where trip_id = new.id and status = 'requested' loop
    if not public._trip_on(new, m.ride_date) or (new.accepts <> 'either' and new.accepts <> m.pay_with) then
      delete from public.matches where id = m.id; continue;
    end if;
    q := public._quote_trip(new.id, m.ride_date, m.request_id, false);
    if not coalesce((q->>'ok')::boolean, false) then delete from public.matches where id = m.id; end if;
  end loop;
  return new;
end $$;
drop trigger if exists trips_revalidate_requests on public.trips;
create trigger trips_revalidate_requests after update on public.trips for each row execute function public._revalidate_requests();

-- ---------- 3. notices ----------
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notices_user_idx on public.notices (user_id, created_at desc);
alter table public.notices enable row level security;
drop policy if exists "notices read own" on public.notices;
create policy "notices read own" on public.notices for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notices from anon, authenticated;

create or replace function public.mark_notices_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.notices set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_notices_read(uuid[]) from public, anon;
grant execute on function public.mark_notices_read(uuid[]) to authenticated;

create or replace function public._notice_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.trips; actor uuid := coalesce(new.cancelled_by, auth.uid()); by_driver boolean; to_user uuid; who text; route text; day text; ref text;
begin
  select * into t from public.trips where id = new.trip_id;
  by_driver := actor is null or actor = new.driver_id;
  to_user := case when by_driver then new.rider_id else new.driver_id end;
  select coalesce(nullif(display_name, ''), 'Someone') into who from public.profiles where id = case when by_driver then new.driver_id else new.rider_id end;
  route := coalesce(t.origin, 'the start') || ' to ' || coalesce(t.dest, 'the destination');
  day := to_char(new.ride_date, 'Dy Mon FMDD');
  ref := case when by_driver and coalesce(new.refunded, 0) > 0 then ' Your ' || new.refunded || ' points were returned.' else '' end;
  insert into public.notices (user_id, kind, title, body, match_id) values (
    to_user,
    case when by_driver then 'ride_cancelled_by_driver' else 'ride_cancelled_by_rider' end,
    case when by_driver then 'Your ride was cancelled' else 'A rider cancelled' end,
    case when by_driver then 'Your ride on ' || day || ' (' || route || ') was cancelled by ' || coalesce(who, 'the driver') || '.' || ref
         else coalesce(who, 'A rider') || ' cancelled their ride on ' || day || ' (' || route || ').' end,
    new.id);
  return new;
end $$;
drop trigger if exists matches_notice_on_cancel on public.matches;
create trigger matches_notice_on_cancel after update of status on public.matches for each row when (old.status = 'accepted' and new.status = 'cancelled') execute function public._notice_on_cancel();
