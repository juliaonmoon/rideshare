-- Migration 055: no double booking. A driver cannot have two trips that overlap on the same day.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 048 and 049.
--
-- A trip takes up the time from its leave time to its arrival (the drive plus 15 minutes). A trip with a time window
-- ("any time between 6 and 12") takes up the whole window plus the drive, because the time is not fixed yet.
-- When a trip is posted or changed (a new trip, a new time, new days, a different route) every date it runs on in the next
-- 6 months is checked against the driver's other trips; if two overlap, the new or changed one is refused with a plain message.
-- The separate days of a repeating trip never conflict with their own repeating trip. Offer a ride now is not checked.

-- how long a trip takes, from its two places (60 minutes if a place is not known)
create or replace function public._trip_drive_min(t public.trips, d date) returns double precision
language plpgsql stable security definer set search_path = public as $$
declare olat double precision := t.origin_lat; olng double precision := t.origin_lng; dlat double precision := t.dest_lat; dlng double precision := t.dest_lng; st integer;
begin
  if olat is null then select a.lat, a.lng into olat, olng from public.areas a where a.name = t.origin; end if;
  if dlat is null then select a.lat, a.lng into dlat, dlng from public.areas a where a.name = t.dest; end if;
  if olat is null or dlat is null then return 60; end if;
  st := case when t.flex_to is not null and not coalesce(t.flex_locked, false) then t.flex_from else t.depart_min end;
  return coalesce(public._minutes(olat, olng, dlat, dlng, st, extract(dow from d)::int), 60);
exception when others then return 60;
end $$;
revoke all on function public._trip_drive_min(public.trips, date) from public, anon, authenticated;

-- the minutes of the day a trip takes up on a date
create or replace function public._trip_busy(t public.trips, d date) returns int4range
language plpgsql stable security definer set search_path = public as $$
declare flex boolean := t.flex_to is not null and not coalesce(t.flex_locked, false); st integer; en integer;
begin
  st := case when flex then t.flex_from else t.depart_min end;
  en := ceil((case when flex then t.flex_to else t.depart_min end) + public._trip_drive_min(t, d) + 15)::int;
  if en <= st then en := st + 1; end if;
  return int4range(st, en, '[)');
end $$;
revoke all on function public._trip_busy(public.trips, date) from public, anon, authenticated;

create or replace function public._no_double_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Vancouver')::date; first date; last date; d date; o public.trips; a int4range;
begin
  if not new.active or new.live then return new; end if;
  if coalesce(current_setting('app.allow_overlap', true), '') = '1' then return new; end if;   -- only the database tests set this
  if tg_op = 'UPDATE' then
    if new.flex_locked is distinct from old.flex_locked then return new; end if;   -- a rider fixing the time (or the window opening again) is not an edit
    if old.active and (old.depart_min, old.flex_from, old.flex_to, old.trip_date, old.repeat_days, old.repeat_every, old.repeat_nth, old.repeat_until, old.origin, old.dest, old.origin_lat, old.origin_lng, old.dest_lat, old.dest_lng)
       is not distinct from (new.depart_min, new.flex_from, new.flex_to, new.trip_date, new.repeat_days, new.repeat_every, new.repeat_nth, new.repeat_until, new.origin, new.dest, new.origin_lat, new.origin_lng, new.dest_lat, new.dest_lng) then return new; end if;
  end if;
  first := greatest(today, new.trip_date);
  last := case when coalesce(array_length(new.repeat_days, 1), 0) = 0 then new.trip_date else least(coalesce(new.repeat_until, today + 190), today + 190) end;
  for d in select g::date from generate_series(first, last, interval '1 day') g loop
    if not public._trip_on(new, d) then continue; end if;
    a := public._trip_busy(new, d);
    for o in select * from public.trips x
              where x.user_id = new.user_id and x.active and not x.live and x.id <> new.id
                and x.id is distinct from new.series_parent and x.series_parent is distinct from new.id
                and (new.series_parent is null or x.series_parent is distinct from new.series_parent) loop
      if public._trip_on(o, d) and a && public._trip_busy(o, d) then
        raise exception 'This overlaps your other trip (% to %) on %. Change the time or the day.', o.origin, o.dest, to_char(d, 'Dy Mon FMDD');
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists trips_no_double_booking on public.trips;
create trigger trips_no_double_booking before insert or update on public.trips for each row execute function public._no_double_booking();
