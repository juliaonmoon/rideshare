-- 082: (1) the driver's phone is told when the rider taps "I'm here" or turns on location sharing;
-- (2) a rider who asks a driver who cannot be located gets the real reason, not "outside the detour limits".
-- Run once in Supabase > SQL Editor (after 081). Safe to run twice.

-- (1) notices for the driver
create or replace function public._notice_rider_here() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; rq public.ride_requests;
begin
  select coalesce(nullif(display_name, ''), 'Your rider') into who from public.profiles where id = new.rider_id;
  select * into rq from public.ride_requests where id = new.request_id;
  insert into public.notices (user_id, kind, title, body, match_id) values (new.driver_id, 'rider_here', 'Your rider is at the pickup spot',
    who || ' tapped I''m here at ' || coalesce(nullif(rq.pickup_label, ''), nullif(rq.pickup, ''), 'the pickup spot') || '. Open the app to see where.', new.id);
  return new;
end $$;
revoke all on function public._notice_rider_here() from public, anon, authenticated;
drop trigger if exists matches_notice_rider_here on public.matches;
create trigger matches_notice_rider_here after update of rider_here_at on public.matches for each row
  when (old.rider_here_at is null and new.rider_here_at is not null and new.status = 'accepted') execute function public._notice_rider_here();

create or replace function public._notice_rider_sharing() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(nullif(display_name, ''), 'Your rider') into who from public.profiles where id = new.rider_id;
  insert into public.notices (user_id, kind, title, body, match_id) values (new.driver_id, 'rider_sharing', 'Your rider is sharing their location',
    who || ' is sharing where they are. Open the app to see how far they are from the pickup.', new.id);
  return new;
end $$;
revoke all on function public._notice_rider_sharing() from public, anon, authenticated;
drop trigger if exists matches_notice_rider_sharing on public.matches;
create trigger matches_notice_rider_sharing after update of rider_share on public.matches for each row
  when (old.rider_share is not true and new.rider_share is true and new.status = 'accepted') execute function public._notice_rider_sharing();

-- the phone helper asks for every unread driver notice it should show (rider cancelled / is here / is sharing)
create or replace function public.driver_notice_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; j jsonb;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body) order by n.created_at), '[]'::jsonb) into j
    from public.notices n
    where n.user_id = u and n.kind in ('ride_cancelled_by_rider', 'rider_here', 'rider_sharing') and n.read_at is null and n.created_at > now() - interval '3 hours';
  return j;
end $$;
revoke all on function public.driver_notice_alerts_token(text) from public;
grant execute on function public.driver_notice_alerts_token(text) to anon, authenticated;

-- (2) the seat request says why
create or replace function public._request_seat_as(p_rider uuid, p_trip uuid, p_request uuid, p_pay_with text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; q jsonb; pts integer; dollars double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = p_rider and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.expires_at is not null and t.expires_at < now() then raise exception 'That live trip has ended'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'Your live request has ended'; end if;
  if t.user_id = p_rider then raise exception 'You cannot ride with yourself'; end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  if not public._trip_on(t, p_date) or not public._req_on(r, p_date) then
    raise exception 'That trip or request does not run on that date';
  end if;
  if p_pay_with not in ('points', 'cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  q := public._quote_trip(p_trip, p_date, p_request, true);
  if not coalesce((q->>'ok')::boolean, false) then
    if q->>'reason' = 'full' then raise exception 'This trip has no seat left'; end if;
    if q->>'reason' = 'unknown_area' then raise exception 'Unknown area'; end if;
    if q->>'reason' = 'no_position' then raise exception 'This driver is on the road and cannot be located right now, so new riders are on hold. Try again in a minute, or ask another driver.'; end if;
    raise exception 'This trip is outside the driver''s detour limits';
  end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := greatest(1, floor(dollars / 0.10 + 0.0001))::int;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, detour_min, detour_km, cash_cents, price_dollars, quote_source)
    values (p_trip, p_request, t.user_id, p_rider, p_pay_with, case when p_pay_with = 'points' then pts else 0 end, p_date,
            (q->>'added_min')::numeric, (q->>'added_km')::numeric, floor(dollars * 100)::int, round(dollars::numeric, 2), q->>'source')
    returning id into m;
  -- asking again by hand on purpose brings back a regular booking the rider had ended
  delete from public.series_off where trip_id = p_trip and request_id = p_request and stopped_by = p_rider;
  return m;
end $$;
revoke all on function public._request_seat_as(uuid, uuid, uuid, text, date) from public, anon, authenticated;
