-- Migration 054: change just ONE date of a repeating trip (like "this occurrence only" in a calendar app).
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 048, 049 and 053.
--
--  * edit_trip_day(trip, date, changes): the date becomes its own one-time trip with the changes (a different destination,
--    time, limits ...), shown under the same repeating trip as "changed". The repeating trip carries on for the other dates.
--    Only allowed for a date with NO confirmed rider. Requests waiting for that date are checked again: the ones that still
--    fit stay, the others are deleted (nobody is told, nothing was confirmed).
--  * restore_trip_day(changed day): puts the date back to the repeating trip (only when no rider is confirmed on it).
-- Changing the WHOLE repeating trip stays locked as soon as any date has a confirmed rider (migration 053).

alter table public.trips add column if not exists changed_day boolean not null default false;

-- the waiting requests of one trip on one date: keep the ones that still fit, delete the others
create or replace function public._recheck_requests(p_trip uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare t public.trips; m record; q jsonb;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null then return; end if;
  for m in select id, request_id, pay_with from public.matches where trip_id = p_trip and ride_date = p_date and status = 'requested' loop
    if not public._trip_on(t, p_date) or (t.accepts <> 'either' and t.accepts <> m.pay_with) then delete from public.matches where id = m.id; continue; end if;
    q := public._quote_trip(p_trip, p_date, m.request_id, false);
    if not coalesce((q->>'ok')::boolean, false) then delete from public.matches where id = m.id; end if;
  end loop;
end $$;
revoke all on function public._recheck_requests(uuid, date) from public, anon, authenticated;

create or replace function public.edit_trip_day(p_trip uuid, p_date date, p_changes jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; c public.trips; cid uuid; ov jsonb := '{}'::jsonb; k text; today date := (now() at time zone 'America/Vancouver')::date;
  allowed text[] := array['origin','dest','origin_lat','origin_lng','dest_lat','dest_lng','depart_min','flex_from','flex_to','max_detour','max_total_detour','max_detour_km','max_total_detour_km','max_pickups','accepts','auto_accept'];
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.trips where id = p_trip;
  if t.id is null or t.user_id <> auth.uid() then raise exception 'Not your trip'; end if;
  if t.series_parent is not null then select * into t from public.trips where id = t.series_parent; end if;   -- called with the date's own trip: use its repeating trip
  perform 1 from public.trips where id = t.id for update;
  if t.live or not t.active then raise exception 'This trip is not on any more'; end if;
  if coalesce(array_length(t.repeat_days, 1), 0) = 0 then raise exception 'This is not a repeating trip. Use Edit.'; end if;
  if p_date < today then raise exception 'That date has passed'; end if;
  select id into cid from public.trips where series_parent = t.id and trip_date = p_date and active limit 1;
  if cid is null and not public._trip_on(t, p_date) then raise exception 'This trip does not run on that date'; end if;
  if exists (select 1 from public.matches x where x.trip_id in (t.id, coalesce(cid, t.id)) and x.ride_date = p_date and x.status = 'accepted' and x.dropped_off_at is null) then
    raise exception 'A rider is confirmed on that date. Cancel that date first.';
  end if;
  for k in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not (k = any (allowed)) then raise exception 'That cannot be changed for one date'; end if;
    ov := ov || jsonb_build_object(k, p_changes->k);
  end loop;
  if cid is not null then
    select * into c from public.trips where id = cid;
    c := jsonb_populate_record(c, ov);
    update public.trips set origin = c.origin, dest = c.dest, origin_lat = c.origin_lat, origin_lng = c.origin_lng, dest_lat = c.dest_lat, dest_lng = c.dest_lng,
      depart_min = c.depart_min, flex_from = c.flex_from, flex_to = c.flex_to, max_detour = c.max_detour, max_total_detour = c.max_total_detour,
      max_detour_km = c.max_detour_km, max_total_detour_km = c.max_total_detour_km, max_pickups = c.max_pickups, accepts = c.accepts, auto_accept = c.auto_accept, changed_day = true
     where id = cid;
  else
    insert into public.trips
      select (jsonb_populate_record(null::public.trips, to_jsonb(t) || jsonb_build_object(
        'id', gen_random_uuid(), 'trip_date', p_date, 'repeat_days', '[]'::jsonb, 'repeat_until', null, 'repeat_every', 1, 'repeat_nth', null,
        'series_parent', t.id, 'changed_day', true, 'created_at', now(), 'quoted_km', null, 'quoted_min', null, 'quoted_source', null, 'quoted_rids', null) || ov)).*
      returning id into cid;
    insert into public.trip_skips (trip_id, skip_date) values (t.id, p_date) on conflict do nothing;
    update public.matches set trip_id = cid where trip_id = t.id and ride_date = p_date and status = 'requested';   -- the waiting requests for that date follow the date
  end if;
  perform public._recheck_requests(cid, p_date);
  return cid;
end $$;
revoke all on function public.edit_trip_day(uuid, date, jsonb) from public, anon;
grant execute on function public.edit_trip_day(uuid, date, jsonb) to authenticated;

create or replace function public.restore_trip_day(p_child uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.trips; d date;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into c from public.trips where id = p_child;
  if c.id is null or c.user_id <> auth.uid() or c.series_parent is null then raise exception 'Not a changed date of your trip'; end if;
  if exists (select 1 from public.matches x where x.trip_id = c.id and x.status = 'accepted' and x.dropped_off_at is null) then
    raise exception 'A rider is confirmed on that date. Cancel that date first.';
  end if;
  d := c.trip_date;
  delete from public.trip_skips where trip_id = c.series_parent and skip_date = d;
  update public.matches set trip_id = c.series_parent where trip_id = c.id and ride_date = d and status = 'requested';
  update public.trips set active = false where id = c.id;
  perform public._recheck_requests(c.series_parent, d);
end $$;
revoke all on function public.restore_trip_day(uuid) from public, anon;
grant execute on function public.restore_trip_day(uuid) to authenticated;
