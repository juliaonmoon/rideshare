-- The app asks the database whether a seat request is inside the driver's detour limits (the same check that decides the phone alert and Accept),
-- so a request outside the limits is not shown, and a request inside them is never hidden by the app's own estimate.
-- Run once in the Supabase SQL editor (safe to run again).

create or replace function public.request_fits(p_match uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or m.driver_id is distinct from auth.uid() then raise exception 'Not your ride'; end if;
  return public._detour_fits(m.trip_id, m.ride_date, m.detour_min, m.detour_km, m.id);
end $$;
revoke all on function public.request_fits(uuid) from public, anon;
grant execute on function public.request_fits(uuid) to authenticated;
