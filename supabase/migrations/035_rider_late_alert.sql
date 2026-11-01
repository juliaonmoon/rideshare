-- The rider's phone check also says when the driver is running late (a minute past the rider's pickup time and not arrived),
-- and sends the pickup time, so the phone can warn the rider with the time to cancel for free.
-- Needs migration 033. Run once in the Supabase SQL editor (safe to run again).

create or replace function public.rider_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; rides jsonb; active boolean; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  active := exists (select 1 from public.matches m where m.rider_id = u and m.status in ('requested', 'accepted') and m.ride_date >= today - 1)
         or exists (select 1 from public.ride_requests r where r.user_id = u and r.active and r.live and (r.expires_at is null or r.expires_at > now()));
  select coalesce(jsonb_agg(y order by y.ride_date, y.id), '[]'::jsonb) into rides from (
    select m.id, m.ride_date, coalesce(p.display_name, 'Your driver') as driver_name,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived'
           when m.en_route_at is not null then 'on_my_way' else 'accepted' end as stage,
      m.arrived_at, t.max_wait as wait_min,
      (extract(epoch from coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min))) * 1000)::bigint as pickup_ms,
      (m.arrived_at is null and m.picked_up_at is null and now() >= coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) + interval '1 minute') as late,
      nullif(trim(concat_ws(' ', pc.car_color, pc.car_make, case when pc.car_plate is not null then '(' || pc.car_plate || ')' end)), '') as car,
      coalesce(r.pickup_label, r.pickup) as pickup_name, m.meet_note
    from public.matches m
    join public.trips t on t.id = m.trip_id
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.driver_id
    left join public.profile_cards pc on pc.user_id = m.driver_id
    where m.rider_id = u and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1
    limit 6) y;
  return jsonb_build_object('active', active, 'rides', rides);
end $$;
revoke all on function public.rider_alerts_token(text) from public;
grant execute on function public.rider_alerts_token(text) to anon, authenticated;
