-- 078: when the driver is running late, the new pickup time takes effect right away. The rider does not have to agree (the driver cannot undo being late).
--   * The driver picks a later time (1 to 60 minutes later, only before tapping Arrived). The agreed pickup time changes at once.
--   * The rider is told (a card, and a phone alert on Android). The rider can tap OK, or cancel for free if the new time is 3 or more minutes later.
--   * Every change is counted (private stat), and the first agreed time is kept (pickup_orig) for the team.
-- Run once in the Supabase SQL editor (safe to run again). Needs 063, 072.

alter table public.matches add column if not exists time_prev timestamptz;
alter table public.matches add column if not exists time_changed_at timestamptz;
alter table public.matches add column if not exists pickup_orig timestamptz;

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
  update public.matches set pickup_orig = coalesce(pickup_orig, pk), time_prev = pk, time_changed_at = now(), pickup_time = p_time,
    pickup_changes = pickup_changes + 1, prop_time = null, prop_at = null where id = p_match;
  select coalesce(nullif(display_name, ''), 'Your driver') into who from public.profiles where id = m.driver_id;
  insert into public.notices (user_id, kind, title, body, match_id) values (m.rider_id, 'pickup_time_proposed', 'Your driver is running late',
    coalesce(who, 'Your driver') || ' is running late. New pickup time: ' || public._van_clock(p_time) || ' (was ' || public._van_clock(pk) || ').'
    || case when p_time >= pk + interval '3 minutes' then ' You can keep your ride, or cancel for free.' else '' end, m.id);
  return 'changed';
end $$;
revoke all on function public.propose_pickup_time(uuid, timestamptz) from public, anon;
grant execute on function public.propose_pickup_time(uuid, timestamptz) to authenticated;

-- the rider's answer: OK (keep the ride) or cancel for free. "decline" now means the same as OK, because the late time cannot be undone.
create or replace function public.answer_pickup_time(p_match uuid, p_choice text)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; refund integer := 0; who text;
begin
  if p_choice not in ('accept', 'decline', 'cancel') then raise exception 'Choose OK or cancel'; end if;
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.rider_id <> auth.uid() then raise exception 'Not your ride'; end if;
  if m.status <> 'accepted' then raise exception 'This ride is %', m.status; end if;
  if m.picked_up_at is not null then raise exception 'The ride has already started'; end if;
  if m.time_prev is null then raise exception 'There is no new time to answer'; end if;
  select coalesce(nullif(display_name, ''), 'The rider') into who from public.profiles where id = m.rider_id;
  if p_choice in ('accept', 'decline') then
    update public.matches set time_prev = null where id = p_match;
    insert into public.notices (user_id, kind, title, body, match_id) values (m.driver_id, 'pickup_time_accepted', 'New pickup time noted',
      coalesce(who, 'The rider') || ' saw the new pickup time (' || public._van_clock(m.pickup_time) || ') and is keeping the ride.', m.id);
    return 'accepted';
  else
    if m.pickup_time < m.time_prev + interval '3 minutes' then raise exception 'The new time is less than 3 minutes later, so this is not a free cancel'; end if;
    if m.pay_with = 'points' and m.points > 0 then
      refund := m.points;
      update public.wallets set points = points + refund where user_id = m.rider_id;
      insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, refund, 'Pickup time changed (points returned)', m.id);
    end if;
    update public.matches set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), late = false, settled = true, refunded = refund,
      time_prev = null where id = p_match;
    return 'cancelled_free';
  end if;
end $$;
revoke all on function public.answer_pickup_time(uuid, text) from public, anon;
grant execute on function public.answer_pickup_time(uuid, text) to authenticated;

-- the rider's phone check: tell the phone about a recent late-change (chg_ms = new time, prev_ms = the time before)
create or replace function public.rider_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; rides jsonb; finds jsonb; shm uuid; active boolean; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  active := exists (select 1 from public.matches m where m.rider_id = u and m.status in ('requested', 'accepted') and m.ride_date >= today - 1)
         or exists (select 1 from public.ride_requests r where r.user_id = u and r.active and (r.expires_at is null or r.expires_at > now())
                      and (r.live or r.ride_date >= today or coalesce(array_length(r.repeat_days, 1), 0) > 0));
  select coalesce(jsonb_agg(y order by y.ride_date, y.id), '[]'::jsonb) into rides from (
    select m.id, m.ride_date, coalesce(p.display_name, 'Your driver') as driver_name,
      case when m.picked_up_at is not null then 'picked_up' when m.arrived_at is not null then 'arrived'
           when m.en_route_at is not null then 'on_my_way' else 'accepted' end as stage,
      m.arrived_at, t.max_wait as wait_min,
      (extract(epoch from coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min))) * 1000)::bigint as pickup_ms,
      (m.arrived_at is null and m.picked_up_at is null and now() >= coalesce(m.pickup_time, public.pickup_at(m.ride_date, t.depart_min)) + interval '1 minute') as late,
      nullif(trim(concat_ws(' ', pc.car_color, pc.car_make, case when pc.car_plate is not null then '(' || pc.car_plate || ')' end)), '') as car,
      coalesce(r.pickup_label, r.pickup) as pickup_name, m.meet_note,
      public._pickup_late_min(m) as late_min,
      case when m.time_prev is not null and m.time_changed_at > now() - interval '60 minutes' then (extract(epoch from m.pickup_time) * 1000)::bigint end as chg_ms,
      case when m.time_prev is not null and m.time_changed_at > now() - interval '60 minutes' then (extract(epoch from m.time_prev) * 1000)::bigint end as prev_ms
    from public.matches m
    join public.trips t on t.id = m.trip_id
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.driver_id
    left join public.profile_cards pc on pc.user_id = m.driver_id
    where m.rider_id = u and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1
    limit 6) y;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body) order by n.created_at), '[]'::jsonb) into finds
    from (select * from public.notices where user_id = u and kind = 'driver_found' and read_at is null and created_at > now() - interval '12 hours' order by created_at desc limit 3) n;
  select m.id into shm from public.matches m where m.rider_id = u and m.rider_share and public._share_window_ok(m) limit 1;
  return jsonb_build_object('active', active, 'rides', rides, 'finds', finds, 'share_match', shm);
end $$;
revoke all on function public.rider_alerts_token(text) from public;
grant execute on function public.rider_alerts_token(text) to anon, authenticated;