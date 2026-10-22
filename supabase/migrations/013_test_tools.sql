-- Migration 013: test tools for the app owner (run once in Supabase > SQL Editor, after 012). Safe to run twice.
-- A tiny list of "test accounts". Only those accounts get a "Send a test request" button (Settings tab), which makes one of the
-- made-up sample riders (emails sample-r-...@example.invalid) ask for a seat on YOUR OWN most recent active trip, optionally after a
-- delay (so you can start driving first). Nobody else can use it, and it only ever touches your own trips.
-- TEST MODE: a switch (Settings > Test tools). While it is ON and the Android driving mode is running, the phone helper's regular check
-- also makes a made-up rider ask for a seat on your trip, about every 2 minutes, so you can test alerts while navigating.
-- The statements at the end enable the account juliaonmoon@gmail.com.

create table if not exists public.test_accounts (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.test_accounts add column if not exists test_mode boolean not null default false;
alter table public.test_accounts add column if not exists last_test_at timestamptz;
alter table public.test_accounts enable row level security;
drop policy if exists "test accounts own read" on public.test_accounts;
create policy "test accounts own read" on public.test_accounts for select to authenticated using (user_id = auth.uid());
revoke all on public.test_accounts from anon, authenticated;
grant select on public.test_accounts to authenticated;

-- Internal: a sample rider asks for a seat on this driver's most recent active trip (p_delay seconds from now). Not callable by anyone directly.
create or replace function public._make_test_request(p_driver uuid, p_delay integer)
returns text language plpgsql security definer set search_path = public as $$
declare t record; r record; today date := (now() at time zone 'America/Vancouver')::date; nm text;
begin
  select * into t from public.trips where user_id = p_driver and active and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
  if t.id is null then raise exception 'Post a trip (or switch on Offer a ride now) first'; end if;
  select rq.id as request_id, rq.user_id as rider_id into r
    from public.ride_requests rq join auth.users u on u.id = rq.user_id
    where u.email like 'sample-r-%@example.invalid' and rq.active
    order by (exists (select 1 from public.matches m where m.trip_id = t.id and m.request_id = rq.id and m.ride_date = today and m.status in ('requested','accepted'))), random()
    limit 1;
  if r.request_id is null then raise exception 'No made-up riders found. Run the sample data first.'; end if;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, created_at)
    values (t.id, r.request_id, t.user_id, r.rider_id, 'cash', 0, today, now() + (p_delay * interval '1 second'))
  on conflict (trip_id, request_id, ride_date) do update set status = 'requested', created_at = excluded.created_at;
  select display_name into nm from public.profiles where id = r.rider_id;
  return coalesce(nm, 'A sample rider');
end $$;
revoke all on function public._make_test_request(uuid, integer) from public, anon, authenticated;

-- A sample rider asks for a seat on my trip (p_delay seconds from now; 0 = right away).
create or replace function public.send_test_request(p_delay integer default 0)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.test_accounts where user_id = auth.uid()) then raise exception 'Test tools are not enabled for your account'; end if;
  if p_delay is null or p_delay < 0 or p_delay > 300 then raise exception 'Delay must be between 0 and 300 seconds'; end if;
  return public._make_test_request(auth.uid(), p_delay);
end $$;

-- Turn test mode on or off for me.
create or replace function public.set_test_mode(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.test_accounts where user_id = auth.uid()) then raise exception 'Test tools are not enabled for your account'; end if;
  update public.test_accounts set test_mode = coalesce(p_on, false), last_test_at = null where user_id = auth.uid();
  return coalesce(p_on, false);
end $$;
revoke all on function public.set_test_mode(boolean) from public, anon;
grant execute on function public.set_test_mode(boolean) to authenticated;

-- Remove all test requests on my trips.
create or replace function public.clear_test_requests() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.test_accounts where user_id = auth.uid()) then raise exception 'Test tools are not enabled for your account'; end if;
  delete from public.matches where driver_id = auth.uid() and pay_with = 'cash' and points = 0
    and rider_id in (select id from auth.users where email like 'sample-r-%@example.invalid');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.send_test_request(integer) from public, anon;
revoke all on function public.clear_test_requests() from public, anon;
grant execute on function public.send_test_request(integer) to authenticated;
grant execute on function public.clear_test_requests() to authenticated;

-- Phone alerts only announce requests whose time has come (so a test request with a delay stays quiet until then).
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
  -- Test mode: about every 2 minutes, while nothing is waiting, a made-up rider asks (it appears 20 seconds later).
  if active and exists (select 1 from public.test_accounts ta where ta.user_id = d and ta.test_mode and (ta.last_test_at is null or ta.last_test_at < now() - interval '2 minutes'))
     and not exists (select 1 from public.matches m where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1) then
    begin
      perform public._make_test_request(d, 20);
      update public.test_accounts set last_test_at = now() where user_id = d;
    exception when others then null;   -- never let a test problem break the real alert check
    end;
  end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into pend from (
    select m.id, p.display_name as name, r.pickup, r.dropoff, m.ride_date, m.created_at
    from public.matches m
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.rider_id
    where m.driver_id = d and m.status = 'requested' and m.ride_date >= today - 1 and m.created_at <= now()
    order by m.created_at desc limit 5) x;
  return jsonb_build_object('ride', ride, 'active', active, 'pending', pend);
end $$;

-- Enable the owner's account (add more emails here if you sign in with another Google account).
insert into public.test_accounts (user_id)
  select id from auth.users where email in ('juliaonmoon@gmail.com')
on conflict do nothing;
select u.email as test_account_enabled_for, t.test_mode from public.test_accounts t join auth.users u on u.id = t.user_id;
