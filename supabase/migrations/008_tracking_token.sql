-- Migration 008: a short-lived tracking token for the Android app's background location helper
-- (run once in Supabase > SQL Editor, after 007).
-- Why: when the driver switches to Google Maps, Android keeps only a small background helper alive. That helper cannot keep a
-- full login session fresh, so the app asks the server for a one-driver, 12-hour token and the helper uses it to send positions.
-- The token can ONLY send that driver's position, and only while the driver has a ride in progress. Only a hash is stored.
-- stop_sharing() also revokes the token. Safe to run twice.

create table if not exists public.tracking_tokens (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null
);
alter table public.tracking_tokens enable row level security;
revoke all on public.tracking_tokens from anon, authenticated;

create or replace function public.start_tracking() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.tracking_tokens (driver_id, token_hash, expires_at)
    values (auth.uid(), encode(sha256(convert_to(t, 'UTF8')), 'hex'), now() + interval '12 hours')
  on conflict (driver_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return t;
end $$;

-- Called by the phone's background helper (no login session), using the token.
create or replace function public.share_position_token(p_token text, p_lat double precision, p_lng double precision, p_speed real, p_heading real, p_accuracy real)
returns void language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select driver_id into d from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if d is null then raise exception 'Invalid or expired token'; end if;
  if not exists (select 1 from public.matches where driver_id = d and status = 'accepted' and en_route_at is not null) then
    raise exception 'No ride in progress';
  end if;
  insert into public.driver_positions (driver_id, lat, lng, speed, heading, accuracy, updated_at)
    values (d, p_lat, p_lng, greatest(0, least(coalesce(p_speed, 0), 100)), p_heading, p_accuracy, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, updated_at = now();
end $$;

-- stop_sharing also revokes the token.
create or replace function public.stop_sharing() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.driver_positions where driver_id = auth.uid();
  delete from public.tracking_tokens where driver_id = auth.uid();
end $$;

revoke all on function public.start_tracking() from public, anon;
grant execute on function public.start_tracking() to authenticated;
revoke all on function public.share_position_token(text, double precision, double precision, real, real, real) from public;
grant execute on function public.share_position_token(text, double precision, double precision, real, real, real) to anon, authenticated;
revoke all on function public.stop_sharing() from public, anon;
grant execute on function public.stop_sharing() to authenticated;
