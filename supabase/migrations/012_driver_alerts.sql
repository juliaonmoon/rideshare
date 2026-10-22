-- Migration 012: alerts for a driver who is driving (run once in Supabase > SQL Editor, after 011). Safe to run twice.
-- The Android app's background helper (which keeps running while Google Maps is open) asks this function every few seconds:
--   * ride:    is a ride in progress (so the helper should send the driver's position)?
--   * active:  is the driver still "on duty" (a ride in progress, or an active trip today)? If not, the helper switches itself off.
--   * pending: new seat requests waiting for the driver, so the phone can show "Alex asked for a seat".
-- It needs the same short-lived tracking token as the position function, so it only ever answers for ONE driver, and only
-- shows that driver what they could already see in the app (rider first name and neighbourhood-level areas).

create or replace function public.driver_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d uuid; ride boolean; active boolean; pend jsonb; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  ride := exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null);
  active := ride or exists (
    select 1 from public.trips t where t.user_id = d and t.active and (t.expires_at is null or t.expires_at > now())
      and public.occurs_on(today, t.trip_date, t.repeat_days));
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1
    order by m.created_at desc limit 5) x;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend);
end $$;
revoke all on function public.driver_alerts_token(text) from public;
grant execute on function public.driver_alerts_token(text) to anon, authenticated;
