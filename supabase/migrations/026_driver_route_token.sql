-- Migration 026: the phone helper can ask for the driver's remaining stops, so one tap in a notification re-starts Google Maps with the new rider added.
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 023 first.

create or replace function public.driver_route_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; stops jsonb; dlat double precision; dlng double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(s order by s.created_at), '[]'::jsonb) into stops from (
    select m.id as match_id, coalesce(p.display_name, 'Rider') as name, 'pick' as type, m.created_at,
           coalesce(m.meet_lat, r.pickup_lat, pa.lat) as lat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as lng
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas pa on pa.name = r.pickup
     where m.driver_id = d and m.status = 'accepted' and m.picked_up_at is null and m.dropped_off_at is null and m.ride_date >= today - 1
    union all
    select m.id, coalesce(p.display_name, 'Rider'), 'drop', m.created_at,
           coalesce(r.dropoff_lat, da.lat), coalesce(r.dropoff_lng, da.lng)
      from public.matches m
      join public.ride_requests r on r.id = m.request_id
      left join public.profiles p on p.id = m.rider_id
      left join public.areas da on da.name = r.dropoff
     where m.driver_id = d and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1) s
   where s.lat is not null and s.lng is not null;
  select coalesce(t.dest_lat, da.lat), coalesce(t.dest_lng, da.lng) into dlat, dlng
    from public.trips t left join public.areas da on da.name = t.dest
    where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now()) and public.occurs_on(today, t.trip_date, t.repeat_days)
    order by t.live desc, t.created_at desc limit 1;
  return jsonb_build_object('stops', stops, 'dest_lat', dlat, 'dest_lng', dlng);
end $$;
revoke all on function public.driver_route_token(text) from public;
grant execute on function public.driver_route_token(text) to anon, authenticated;
