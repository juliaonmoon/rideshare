-- Migration 007: abuse limits, account deletion, and tidier permissions (run once in Supabase > SQL Editor, after 006).
--   * Limits so nobody can spam: at most 20 trips, 20 ride requests and 15 seat requests per hour, and at most 5 active trips
--     and 5 active requests at a time per person.
--   * delete_my_account(): the signed-in person can erase their account and everything attached to it (profile, wallet, history,
--     trips, requests, rides, live position). Refused while a ride is accepted and not finished, so nobody is left stranded.
--   * Names are cleaned of control characters and angle brackets.
--   * Helper functions can only be called by signed-in people.
-- Safe to run twice.

create or replace function public.limit_trips() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.trips where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have posted too many trips in the last hour. Please try again later.';
  end if;
  if new.active and (select count(*) from public.trips where user_id = new.user_id and active) >= 5 then
    raise exception 'You already have 5 active trips. Take one down first.';
  end if;
  return new;
end $$;
drop trigger if exists trips_limit on public.trips;
create trigger trips_limit before insert on public.trips for each row execute function public.limit_trips();

create or replace function public.limit_requests() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.ride_requests where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have posted too many requests in the last hour. Please try again later.';
  end if;
  if new.active and (select count(*) from public.ride_requests where user_id = new.user_id and active) >= 5 then
    raise exception 'You already have 5 active requests. Take one down first.';
  end if;
  return new;
end $$;
drop trigger if exists requests_limit on public.ride_requests;
create trigger requests_limit before insert on public.ride_requests for each row execute function public.limit_requests();

create or replace function public.limit_matches() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.matches where rider_id = new.rider_id and created_at > now() - interval '1 hour') >= 15 then
    raise exception 'You have asked for too many seats in the last hour. Please try again later.';
  end if;
  return new;
end $$;
drop trigger if exists matches_limit on public.matches;
create trigger matches_limit before insert on public.matches for each row execute function public.limit_matches();

-- Clean names (no control characters or angle brackets).
create or replace function public.clean_name() returns trigger language plpgsql as $$
begin
  new.display_name := left(btrim(regexp_replace(new.display_name, '[\x00-\x1f<>]', '', 'g')), 30);
  if new.display_name = '' then new.display_name := 'Rider'; end if;
  return new;
end $$;
drop trigger if exists profiles_clean on public.profiles;
create trigger profiles_clean before insert or update of display_name on public.profiles for each row execute function public.clean_name();

-- Erase my account and all my data.
create or replace function public.delete_my_account() returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.matches where (rider_id = auth.uid() or driver_id = auth.uid()) and status = 'accepted' and not settled) then
    raise exception 'You have an accepted ride that is not finished yet. Finish or cancel it first.';
  end if;
  delete from auth.users where id = auth.uid();
  return 'deleted';
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Helper functions: signed-in people only.
revoke all on function public.area_km(text, text) from public, anon;
revoke all on function public.occurs_on(date, date, smallint[]) from public, anon;
revoke all on function public.pickup_at(date, integer) from public, anon;
grant execute on function public.area_km(text, text) to authenticated;
grant execute on function public.occurs_on(date, date, smallint[]) to authenticated;
grant execute on function public.pickup_at(date, integer) to authenticated;
