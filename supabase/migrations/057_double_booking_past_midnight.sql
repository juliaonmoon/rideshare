-- Migration 057: the no-double-booking rule now also catches trips that run past midnight.
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 055.
--
-- Before: a trip leaving at 11:30 pm that ends after midnight was never compared with a trip leaving at 12:10 am the next day.
-- Now each date is also compared with the end of the day before and the start of the day after.

create or replace function public._no_double_booking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare today date := (now() at time zone 'America/Vancouver')::date; first date; last date; d date; o public.trips; a int4range; b int4range;
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
      -- same day
      if public._trip_on(o, d) and a && public._trip_busy(o, d) then
        raise exception 'This overlaps your other trip (% to %) on %. Change the time or the day.', o.origin, o.dest, to_char(d, 'Dy Mon FMDD');
      end if;
      -- the other trip started the day before and runs past midnight into this day
      if public._trip_on(o, d - 1) then
        b := public._trip_busy(o, d - 1);
        if upper(b) > 1440 and a && int4range(lower(b) - 1440, upper(b) - 1440, '[)') then
          raise exception 'This overlaps your other trip (% to %) on %, which runs past midnight. Change the time or the day.', o.origin, o.dest, to_char(d - 1, 'Dy Mon FMDD');
        end if;
      end if;
      -- this trip runs past midnight into the next day, where the other trip starts
      if upper(a) > 1440 and public._trip_on(o, d + 1) and int4range(lower(a) - 1440, upper(a) - 1440, '[)') && public._trip_busy(o, d + 1) then
        raise exception 'This runs past midnight and overlaps your other trip (% to %) on %. Change the time or the day.', o.origin, o.dest, to_char(d + 1, 'Dy Mon FMDD');
      end if;
    end loop;
  end loop;
  return new;
end $$;
