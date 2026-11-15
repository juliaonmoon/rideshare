-- New pickup time: the driver proposes a later time, the rider says Accept / Decline / Cancel for free.
--   * Doing nothing = no change: the agreed pickup time stays as it was.
--   * Accept: the proposed time becomes the agreed pickup time (matches.pickup_time).
--   * Decline: the agreed time stays. Cancel for free: only when the new time is 3+ minutes later; all points back, no mark on the driver.
--   * The driver can only propose before tapping Arrived, 1 to 60 minutes later than the agreed time. Each proposal is counted (private stat).
-- Run once in the Supabase SQL editor (safe to run again). Needs 062.

alter table public.matches add column if not exists prop_time timestamptz;
alter table public.matches add column if not exists prop_at timestamptz;
alter table public.matches add column if not exists pickup_changes integer not null default 0;
alter table public.matches add column if not exists pickup_declined integer not null default 0;

create or replace function public._van_clock(p timestamptz) returns text
language sql immutable as $$ select ltrim(to_char(p at time zone 'America/Vancouver', 'HH12:MI am'), '0') $$;
revoke all on function public._van_clock(timestamptz) from public, anon, authenticated;

create or replace function public.propose_pickup_time(p_match uuid, p_time timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; who text;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.arrived_at is not null or m.picked_up_at is not null then raise exception 'You have already arrived, so the time can no longer change'; end if;
  select * into t from public.trips where id = m.trip_id;
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  if p_time < pk + interval '1 minute' then raise exception 'The new time must be later than the agreed time (%)', public._van_clock(pk); end if;
  if p_time > pk + interval '60 minutes' then raise exception 'That is more than an hour later. Cancel the pickup instead'; end if;
  update public.matches set prop_time = p_time, prop_at = now(), pickup_changes = pickup_changes + 1 where id = p_match;
  select coalesce(nullif(display_name, ''), 'Your driver') into who from public.profiles where id = m.driver_id;
  insert into public.notices (user_id, kind, title, body, match_id) values (m.rider_id, 'pickup_time_proposed', 'New pickup time proposed',
    coalesce(who, 'Your driver') || ' asks to pick you up at ' || public._van_clock(p_time) || ' instead of ' || public._van_clock(pk) || '. Open your ride to accept or decline. If you do nothing, the time stays ' || public._van_clock(pk) || '.', m.id);
  return 'proposed';
end $$;
revoke all on function public.propose_pickup_time(uuid, timestamptz) from public, anon;
grant execute on function public.propose_pickup_time(uuid, timestamptz) to authenticated;

create or replace function public.answer_pickup_time(p_match uuid, p_choice text)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; pk timestamptz; refund integer := 0; who text;
begin
  if p_choice not in ('accept', 'decline', 'cancel') then raise exception 'Choose accept, decline or cancel'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'The ride has already started'; end if;
  if m.prop_time is null then raise exception 'There is no new time to answer'; end if;
  if m.prop_time <= now() then
    update public.matches set prop_time = null, prop_at = null where id = p_match;
    raise exception 'That proposal has expired. The agreed time did not change';
  end if;
  select * into t from public.trips where id = m.trip_id;
  pk := coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min));
  select coalesce(nullif(display_name, ''), 'The rider') into who from public.profiles where id = m.rider_id;
  if p_choice = 'accept' then
    update public.matches set pickup_time = m.prop_time, prop_time = null, prop_at = null where id = p_match;
    insert into public.notices (user_id, kind, title, body, match_id) values (m.driver_id, 'pickup_time_accepted', 'New pickup time agreed',
      coalesce(who, 'The rider') || ' agreed to the new pickup time: ' || public._van_clock(m.prop_time) || '.', m.id);
    return 'accepted';
  elsif p_choice = 'decline' then
    update public.matches set prop_time = null, prop_at = null, pickup_declined = pickup_declined + 1 where id = p_match;
    insert into public.notices (user_id, kind, title, body, match_id) values (m.driver_id, 'pickup_time_declined', 'Pickup time stays',
      coalesce(who, 'The rider') || ' did not agree to a later time. The pickup time stays ' || public._van_clock(pk) || '.', m.id);
    return 'declined';
  else
    if m.prop_time < pk + interval '3 minutes' then raise exception 'The new time is less than 3 minutes later, so this is not a free cancel'; end if;
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Pickup time changed (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), late = false, settled = true, refunded = refund,
      prop_time = null, prop_at = null where id = p_match;
    return 'cancelled_free';
  end if;
end $$;
revoke all on function public.answer_pickup_time(uuid, text) from public, anon;
grant execute on function public.answer_pickup_time(uuid, text) to authenticated;