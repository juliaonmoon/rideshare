-- Migration 029: blocking a person has real effect, people can block someone for themselves, and the database insists on a photo and car plate.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 021, 024, 025 first.

-- ---------- 1. Blocking an account (by the administrator) also cancels its future bookings and hides its offers ----------
create or replace function public._admin_cancel_match(p_match uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null then return; end if;
  if m.status = 'requested' then
    update public.matches set status = 'cancelled', cancelled_at = now() where id = p_match;
  elsif m.status = 'accepted' and m.picked_up_at is null then
    if m.pay_with = 'points' and m.points > 0 and not coalesce(m.settled, false) then
      update public.wallets set points = points + m.points where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, m.points, left('Refund: ' || coalesce(p_reason, 'the ride was cancelled'), 200), m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_at = now(), refunded = m.points, settled = true where id = p_match;
  end if;
end $$;
revoke all on function public._admin_cancel_match(uuid, text) from public, anon, authenticated;

create or replace function public._apply_block(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x record;
begin
  perform set_config('app.cancel_ok', '1', true);
  for x in select id from public.matches where (driver_id = p_user or rider_id = p_user) and status in ('requested', 'accepted') and picked_up_at is null loop
    perform public._admin_cancel_match(x.id, 'the other person''s account was suspended');
  end loop;
  update public.trips set active = false where user_id = p_user and active;
  update public.ride_requests set active = false where user_id = p_user and active;
  delete from public.tracking_tokens where driver_id = p_user;   -- the phone helper's access is switched off
end $$;
revoke all on function public._apply_block(uuid) from public, anon, authenticated;

create or replace function public.admin_resolve_report(p_id uuid, p_note text, p_block boolean)
returns void language plpgsql security definer set search_path = public as $$
declare rep public.reports;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into rep from public.reports where id = p_id for update;
  if rep.id is null then raise exception 'No such report'; end if;
  update public.reports set resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_id;
  if p_block then
    insert into public.blocked_users (user_id, reason, blocked_by) values (rep.reported_id, left(coalesce(p_note, rep.reason), 500), auth.uid()) on conflict (user_id) do nothing;
    perform public._apply_block(rep.reported_id);
  end if;
end $$;
revoke all on function public.admin_resolve_report(uuid, text, boolean) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, boolean) to authenticated;

create or replace function public.admin_block_user(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  insert into public.blocked_users (user_id, reason, blocked_by) values (p_user, left(coalesce(p_reason, 'blocked'), 500), auth.uid()) on conflict (user_id) do nothing;
  perform public._apply_block(p_user);
end $$;
revoke all on function public.admin_block_user(uuid, text) from public, anon;
grant execute on function public.admin_block_user(uuid, text) to authenticated;

-- ---------- 2. "Never match me with this person": any user can block someone for themselves ----------
create table if not exists public.user_blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.user_blocks enable row level security;
drop policy if exists "user_blocks read own" on public.user_blocks;
create policy "user_blocks read own" on public.user_blocks for select to authenticated using (blocker = auth.uid());
revoke insert, update, delete on public.user_blocks from anon, authenticated;

create or replace function public._pair_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public._pair_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.block_person(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  insert into public.user_blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  -- requests that are still waiting between the two of you are withdrawn
  for x in select id from public.matches where status = 'requested' and ((driver_id = auth.uid() and rider_id = p_user) or (driver_id = p_user and rider_id = auth.uid())) loop
    update public.matches set status = 'cancelled', cancelled_at = now() where id = x.id;
  end loop;
end $$;
revoke all on function public.block_person(uuid) from public, anon;
grant execute on function public.block_person(uuid) to authenticated;

create or replace function public.unblock_person(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker = auth.uid() and blocked = p_user;
$$;
revoke all on function public.unblock_person(uuid) from public, anon;
grant execute on function public.unblock_person(uuid) to authenticated;

-- The account block and the personal block are both checked when a seat is asked for or accepted.
create or replace function public._block_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if tg_table_name = 'matches' then
    if tg_op = 'INSERT' then u := new.rider_id; else u := case when new.status = 'accepted' then new.driver_id else null end; end if;
    if (tg_op = 'INSERT' or new.status = 'accepted') and public._pair_blocked(new.driver_id, new.rider_id) then
      raise exception 'This trip is not available to you.';
    end if;
  else
    u := new.user_id;
    if tg_op = 'UPDATE' and new.active is false then return new; end if;   -- switching something off is always allowed
  end if;
  if u is not null and exists (select 1 from public.blocked_users b where b.user_id = u) then
    raise exception 'This account is suspended. Please contact support.';
  end if;
  return new;
end $$;

-- ---------- 3. A photo (and a car plate for drivers) is required by the database, not only by the app ----------
create or replace function public._need_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.profile_cards; is_trip boolean := (tg_table_name = 'trips');
begin
  if tg_op = 'UPDATE' and not (new.active and not old.active) then return new; end if;   -- only when something is posted or switched on
  if not new.active then return new; end if;
  if exists (select 1 from public.test_accounts t where t.user_id = new.user_id)
     or exists (select 1 from auth.users u where u.id = new.user_id and u.email like 'sample-r-%@example.invalid') then return new; end if;
  select * into c from public.profile_cards where user_id = new.user_id;
  if c.user_id is null or c.photo is null or c.photo = '' then raise exception 'Add your photo in the Me tab first.'; end if;
  if is_trip and (c.car_plate is null or trim(c.car_plate) = '') then raise exception 'Add your car details in the Me tab first.'; end if;
  return new;
end $$;
drop trigger if exists need_profile_trips on public.trips;
create trigger need_profile_trips before insert or update on public.trips for each row execute function public._need_profile();
drop trigger if exists need_profile_requests on public.ride_requests;
create trigger need_profile_requests before insert or update on public.ride_requests for each row execute function public._need_profile();
