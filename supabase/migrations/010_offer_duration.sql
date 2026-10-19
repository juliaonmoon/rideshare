-- Migration 010: a driver chooses how long "Offer a ride now" stays visible (15 minutes to 12 hours; default 30). The app uses 12 hours as a safety net: the offer is an on/off switch that turns itself off after 12 hours if forgotten.
-- Run once in Supabase > SQL Editor, after 009. Safe to run twice.
-- Example: a 1-hour drive where you are happy to pick someone up 40 minutes in: leave it switched on.
drop function if exists public.go_live_trip(text, text, integer, integer, text, numeric);
create or replace function public.go_live_trip(p_origin text, p_dest text, p_max_detour integer, p_max_wait integer, p_accepts text, p_cost_per_km numeric, p_minutes integer default 30)
returns uuid language plpgsql as $$
declare t timestamp; id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 720 then raise exception 'Choose between 15 minutes and 12 hours'; end if;
  t := (now() at time zone 'America/Vancouver') + interval '5 minutes';
  update public.trips set active = false where user_id = auth.uid() and live and active;
  insert into public.trips (user_id, origin, dest, depart_min, max_detour, max_wait, accepts, cost_per_km, trip_date, repeat_days, live, expires_at)
    values (auth.uid(), p_origin, p_dest, (extract(hour from t) * 60 + extract(minute from t))::int, p_max_detour, p_max_wait, p_accepts, p_cost_per_km, t::date, '{}', true, now() + (p_minutes * interval '1 minute'))
    returning trips.id into id;
  return id;
end $$;
revoke all on function public.go_live_trip(text, text, integer, integer, text, numeric, integer) from public, anon;
grant execute on function public.go_live_trip(text, text, integer, integer, text, numeric, integer) to authenticated;
