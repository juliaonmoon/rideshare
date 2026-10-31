-- Migration 024: short messages between a matched driver and rider, thumbs up / down ratings, and an admin view of reports with a block option.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 021 and 023 first.

-- ---------- 1. Messages: only the driver and the rider of a seat, only while the seat is accepted (or finished in the last 2 days) ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_match_idx on public.messages (match_id, created_at);
create index if not exists messages_unread_idx on public.messages (recipient_id) where read_at is null;
alter table public.messages enable row level security;
drop policy if exists "messages read mine" on public.messages;
create policy "messages read mine" on public.messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
revoke insert, update, delete on public.messages from anon, authenticated;

-- ---------- 2. Blocked accounts and admin ----------
create table if not exists public.blocked_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  blocked_by uuid,
  created_at timestamptz not null default now()
);
alter table public.blocked_users enable row level security;
revoke all on public.blocked_users from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.test_accounts where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.reports
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolution text;

-- A blocked account cannot post or switch on a trip or ride request, get a new seat, or accept one.
create or replace function public._block_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if tg_table_name = 'matches' then
    if tg_op = 'INSERT' then u := new.rider_id; else u := case when new.status = 'accepted' then new.driver_id else null end; end if;
  else
    u := new.user_id;
    if tg_op = 'UPDATE' and new.active is false then return new; end if;   -- switching something off is always allowed
  end if;
  if u is not null and exists (select 1 from public.blocked_users b where b.user_id = u) then
    raise exception 'This account is suspended. Please contact support.';
  end if;
  return new;
end $$;
drop trigger if exists block_check_trips on public.trips;
create trigger block_check_trips before insert or update on public.trips for each row execute function public._block_check();
drop trigger if exists block_check_requests on public.ride_requests;
create trigger block_check_requests before insert or update on public.ride_requests for each row execute function public._block_check();
drop trigger if exists block_check_matches on public.matches;
create trigger block_check_matches before insert or update on public.matches for each row execute function public._block_check();

create or replace function public.admin_reports(p_open boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into j from (
    select r.id, r.created_at, r.reason, r.details, r.match_id, r.reported_id, r.reporter_id, r.resolved_at, r.resolution,
      coalesce(pr.display_name, 'Someone') as reporter_name, coalesce(pd.display_name, 'Someone') as reported_name,
      exists (select 1 from public.blocked_users b where b.user_id = r.reported_id) as reported_blocked,
      (select count(*) from public.reports r2 where r2.reported_id = r.reported_id) as reports_about_them
    from public.reports r
    left join public.profiles pr on pr.id = r.reporter_id
    left join public.profiles pd on pd.id = r.reported_id
    where (p_open and r.resolved_at is null) or (not p_open)
    order by r.created_at desc limit 100) x;
  return j;
end $$;
revoke all on function public.admin_reports(boolean) from public, anon;
grant execute on function public.admin_reports(boolean) to authenticated;

create or replace function public.admin_resolve_report(p_id uuid, p_note text, p_block boolean)
returns void language plpgsql security definer set search_path = public as $$
declare rep public.reports;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into rep from public.reports where id = p_id for update;
  if rep.id is null then raise exception 'No such report'; end if;
  update public.reports set resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_id;
  if p_block then
    insert into public.blocked_users (user_id, reason, blocked_by) values (rep.reported_id, left(coalesce(p_note, rep.reason), 500), auth.uid())
    on conflict (user_id) do nothing;
  end if;
end $$;
revoke all on function public.admin_resolve_report(uuid, text, boolean) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, boolean) to authenticated;

create or replace function public.admin_unblock(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.blocked_users where user_id = p_user;
end $$;
revoke all on function public.admin_unblock(uuid) from public, anon;
grant execute on function public.admin_unblock(uuid) to authenticated;

-- ---------- 3. Sending and reading messages ----------
create or replace function public.send_message(p_match uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.matches; other uuid; today date := (now() at time zone 'America/Vancouver')::date; new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or auth.uid() not in (m.driver_id, m.rider_id) then raise exception 'Not your ride'; end if;
  if not (m.status = 'accepted' or (m.status = 'completed' and m.ride_date >= today - 2)) then raise exception 'You can message each other while the seat is accepted'; end if;
  if exists (select 1 from public.blocked_users b where b.user_id = auth.uid()) then raise exception 'This account is suspended. Please contact support.'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message first'; end if;
  if (select count(*) from public.messages x where x.match_id = p_match and x.sender_id = auth.uid() and x.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'That is a lot of messages. Please wait a little.';
  end if;
  other := case when auth.uid() = m.driver_id then m.rider_id else m.driver_id end;
  insert into public.messages (match_id, sender_id, recipient_id, body) values (p_match, auth.uid(), other, left(trim(p_body), 500)) returning messages.id into new_id;
  return new_id;
end $$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create or replace function public.mark_messages_read(p_match uuid) returns void
language sql security definer set search_path = public as $$
  update public.messages set read_at = now() where match_id = p_match and recipient_id = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- The phone helper asks for new messages with its token, to show a notification.
create or replace function public.messages_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; j jsonb;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into j from (
    select m.id, m.match_id, m.body, m.created_at, coalesce(p.display_name, 'Your ride') as from_name
    from public.messages m left join public.profiles p on p.id = m.sender_id
    where m.recipient_id = u and m.read_at is null and m.created_at > now() - interval '3 hours'
    order by m.created_at desc limit 10) x;
  return j;
end $$;
revoke all on function public.messages_token(text) from public;
grant execute on function public.messages_token(text) to anon, authenticated;

-- ---------- 4. Ratings: thumbs up or down after a finished ride ----------
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  rater_id uuid not null references auth.users(id) on delete cascade,
  rated_id uuid not null references auth.users(id) on delete cascade,
  up boolean not null,
  comment text check (comment is null or length(comment) <= 300),
  created_at timestamptz not null default now(),
  unique (match_id, rater_id),
  check (rater_id <> rated_id)
);
alter table public.ratings enable row level security;
drop policy if exists "ratings read mine" on public.ratings;
create policy "ratings read mine" on public.ratings for select to authenticated using (rater_id = auth.uid());
revoke insert, update, delete on public.ratings from anon, authenticated;

create or replace function public.rate_ride(p_match uuid, p_up boolean, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; other uuid;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or auth.uid() not in (m.driver_id, m.rider_id) then raise exception 'Not your ride'; end if;
  if m.status <> 'completed' then raise exception 'You can rate a ride after it is finished'; end if;
  other := case when auth.uid() = m.driver_id then m.rider_id else m.driver_id end;
  insert into public.ratings (match_id, rater_id, rated_id, up, comment) values (p_match, auth.uid(), other, p_up, nullif(left(trim(coalesce(p_comment, '')), 300), ''))
  on conflict (match_id, rater_id) do update set up = excluded.up, comment = excluded.comment;
end $$;
revoke all on function public.rate_ride(uuid, boolean, text) from public, anon;
grant execute on function public.rate_ride(uuid, boolean, text) to authenticated;

-- A person's score is shown only as a count and a percentage (never who said what).
create or replace function public.rating_summaries(p_ids uuid[])
returns table (user_id uuid, n integer, up integer) language sql stable security definer set search_path = public as $$
  select r.rated_id, count(*)::int, count(*) filter (where r.up)::int from public.ratings r where r.rated_id = any (p_ids) group by r.rated_id;
$$;
revoke all on function public.rating_summaries(uuid[]) from public, anon;
grant execute on function public.rating_summaries(uuid[]) to authenticated;
