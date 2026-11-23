-- 079: the "rider cancelled" / "ride cancelled" notice now says which pickup it was (time, place) and how long before
-- pickup it was cancelled, so two cancels never look like duplicates. Same trigger rules as 053 (only after an accepted ride).
-- Run once in Supabase > SQL Editor. Safe to run twice.
create or replace function public._notice_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.trips; rq public.ride_requests; actor uuid := coalesce(new.cancelled_by, auth.uid()); by_driver boolean; to_user uuid; who text;
        route text; day text; ref text; pk timestamptz; clock text; spot text; lead text; mins integer;
begin
  select * into t from public.trips where id = new.trip_id;
  select * into rq from public.ride_requests where id = new.request_id;
  by_driver := actor is null or actor = new.driver_id;
  to_user := case when by_driver then new.rider_id else new.driver_id end;
  select coalesce(nullif(display_name, ''), 'Someone') into who from public.profiles where id = case when by_driver then new.driver_id else new.rider_id end;
  route := coalesce(t.origin, 'the start') || ' to ' || coalesce(t.dest, 'the destination');
  day := to_char(new.ride_date, 'Dy Mon FMDD');
  pk := coalesce(new.pickup_time, public.pickup_at(new.ride_date, t.depart_min));
  clock := to_char(pk at time zone 'America/Vancouver', 'FMHH12:MI am');
  spot := coalesce(nullif(rq.pickup_label, ''), nullif(rq.pickup, ''), 'the pickup spot');
  mins := round(extract(epoch from (pk - now())) / 60)::int;
  lead := case when mins >= 120 then ', more than 2 hours before pickup'
              when mins >= 60 then ', about ' || (mins / 60) || ' hour' || case when mins >= 120 then 's' else '' end || ' before pickup'
              when mins >= 1 then ', ' || mins || ' min before pickup'
              when mins > -1 then ', right at pickup time'
              else ', ' || (-mins) || ' min after pickup time' end;
  ref := case when by_driver and coalesce(new.refunded, 0) > 0 then ' Your ' || new.refunded || ' points were returned.' else '' end;
  insert into public.notices (user_id, kind, title, body, match_id) values (
    to_user,
    case when by_driver then 'ride_cancelled_by_driver' else 'ride_cancelled_by_rider' end,
    case when by_driver then 'Your ride was cancelled' else 'A rider cancelled' end,
    case when by_driver then 'Your ' || clock || ' ride from ' || spot || ' on ' || day || ' (' || route || ') was cancelled by ' || coalesce(who, 'the driver') || lead || '.' || ref
         else coalesce(who, 'A rider') || ' cancelled the ' || clock || ' pickup at ' || spot || ' on ' || day || ' (' || route || ')' || lead || '.' end,
    new.id);
  return new;
end $$;
