-- 072: rider location sharing with the screen off (Android). The phone helper sends the rider's position, using the phone's own sign-in token,
-- only for a ride where the rider turned sharing on (migration 071). The phone check also says which ride to send for (share_match).
-- Needs 068 and 071. Run once in the Supabase SQL editor (safe to run again).

create or replace function public.share_rider_position_token(p_token text, p_match uuid, p_lat double precision, p_lng double precision, p_accuracy real default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid; m public.matches;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad position'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or m.rider_id <> u then raise exception 'Not your ride'; end if;
  if not m.rider_share or not public._share_window_ok(m) then
    delete from public.rider_locations where match_id = p_match;
    return false;
  end if;
  insert into public.rider_locations (match_id, lat, lng, accuracy, updated_at) values (p_match, p_lat, p_lng, p_accuracy, now())
    on conflict (match_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, updated_at = now();
  return true;
end $$;
revoke all on function public.share_rider_position_token(text, uuid, double precision, double precision, real) from public;
grant execute on function public.share_rider_position_token(text, uuid, double precision, double precision, real) to anon, authenticated;
create or replace function public.rider_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; rides jsonb; finds jsonb; shm uuid; active boolean; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  active := exists (select 1 from public.matches m where m.rider_id = u and m.status in ('requested', 'accepted') and m.ride_date >= today - 1)
         or exists (select 1 from public.ride_requests r where r.user_id = u and r.active and (r.expires_at is null or r.expires_at > now())
                      and (r.live or r.ride_date >= today or coalesce(array_length(r.repeat_days, 1), 0) > 0));
  select coalesce(jsonb_agg(y order by y.ride_date, y.id), '[]'::jsonb) into rides from (
    select m.id, m.ride_date, coalesce(p.display_name, 'Your driver') as driver_name,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived'
           when m.en_route_at is not null then 'on_my_way' else 'accepted' end as stage,
      m.arrived_at, t.max_wait as wait_min,
      (extract(epoch from coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min))) * 1000)::bigint as pickup_ms,
      (m.arrived_at is null and m.picked_up_at is null and now() >= coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) + interval '1 minute') as late,
      nullif(trim(concat_ws(' ', pc.car_color, pc.car_make, case when pc.car_plate is not null then '(' || pc.car_plate || ')' end)), '') as car,
      coalesce(r.pickup_label, r.pickup) as pickup_name, m.meet_note,
      public._pickup_late_min(m) as late_min,
      case when m.prop_time is not null and m.prop_time > now() then (extract(epoch from m.prop_time) * 1000)::bigint end as prop_ms
    from public.matches m
    join public.trips t on t.id = m.trip_id
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.driver_id
    left join public.profile_cards pc on pc.user_id = m.driver_id
    where m.rider_id = u and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1
    limit 6) y;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body) order by n.created_at), '[]'::jsonb) into finds
    from (select * from public.notices where user_id = u and kind = 'driver_found' and read_at is null and created_at > now() - interval '12 hours' order by created_at desc limit 3) n;
  select m.id into shm from public.matches m where m.rider_id = u and m.rider_share and public._share_window_ok(m) limit 1;
  return jsonb_build_object('active', active, 'rides', rides, 'finds', finds, 'share_match', shm);
end $$;
revoke all on function public.rider_alerts_token(text) from public;
grant execute on function public.rider_alerts_token(text) to anon, authenticated;