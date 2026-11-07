-- Migration 050: "Start fresh" - cancel everything coming up in one step, keep the history.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 025 (cancel_ride) and 044 (the lock on booked trips).
--
-- reset_my_upcoming() does, for the signed-in person only:
--   * refuses while a ride is under way (a rider picked up and not yet dropped off), so nobody is left stranded;
--   * cancels every ride booked or waiting for TODAY AND LATER on the trips they drive (scheduled, repeating, Offer a ride now, and the
--     separate days of a repeating trip), with the usual refunds (a driver cancelling always refunds), then switches those trips off;
--   * cancels every ride booked or waiting on the ride requests they made (the usual cancellation rules for a rider), then switches those requests off;
--   * switches the phone helper off (tracking links) and forgets the exact addresses of requests that never became a ride.
-- Old bookings from earlier days that were never finished are left alone (they cannot be cancelled any more and do not block anything).
-- Finished rides, points history, ratings, reports and settings are not touched.
-- Each ride is cancelled on its own: if one cannot be (for example its pickup time already passed), the rest still go through,
-- the trip or request that has it stays on, and the answer says how many were left and why.

create or replace function public.reset_my_upcoming() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); today date := (now() at time zone 'America/Vancouver')::date;
  x record; mm record; trips_n integer := 0; reqs_n integer := 0; rides_n integer := 0; failed integer := 0; first_err text; stuck boolean;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.matches m where (m.driver_id = me or m.rider_id = me) and m.status = 'accepted' and m.picked_up_at is not null and m.dropped_off_at is null) then
    raise exception 'A ride is under way. Finish it first, then start fresh.';
  end if;
  perform set_config('app.cancel_ok', '1', true);   -- lets a trip or request with old unfinished bookings be switched off
  -- trips I drive
  for x in select id from public.trips where user_id = me and active order by created_at loop
    stuck := false;
    for mm in select id, status from public.matches where trip_id = x.id and status in ('requested', 'accepted') and picked_up_at is null and ride_date >= today order by created_at loop
      begin
        if mm.status = 'requested' then perform public._respond_match(me, mm.id, false); else perform public.cancel_ride(mm.id); end if;
        rides_n := rides_n + 1;
      exception when others then stuck := true; failed := failed + 1; first_err := coalesce(first_err, sqlerrm);
      end;
    end loop;
    if not stuck then update public.trips set active = false where id = x.id; trips_n := trips_n + 1; end if;
  end loop;
  -- ride requests I made
  for x in select id from public.ride_requests where user_id = me and active order by created_at loop
    stuck := false;
    for mm in select id from public.matches where request_id = x.id and status in ('requested', 'accepted') and picked_up_at is null and ride_date >= today order by created_at loop
      begin
        perform public.cancel_ride(mm.id); rides_n := rides_n + 1;
      exception when others then stuck := true; failed := failed + 1; first_err := coalesce(first_err, sqlerrm);
      end;
    end loop;
    if not stuck then update public.ride_requests set active = false where id = x.id; reqs_n := reqs_n + 1; end if;
  end loop;
  begin delete from public.tracking_tokens where driver_id = me; exception when undefined_table then null; end;
  begin
    delete from public.request_exact e using public.ride_requests r
     where e.request_id = r.id and r.user_id = me and not r.active
       and not exists (select 1 from public.matches m where m.request_id = r.id and m.status = 'completed');
  exception when undefined_table then null;
  end;
  return jsonb_build_object('trips', trips_n, 'requests', reqs_n, 'rides', rides_n, 'failed', failed, 'first_error', first_err);
end $$;
revoke all on function public.reset_my_upcoming() from public, anon;
grant execute on function public.reset_my_upcoming() to authenticated;
