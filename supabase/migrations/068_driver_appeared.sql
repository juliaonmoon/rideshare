-- 068: "A driver appeared". When a driver posts a trip that fits a rider's waiting request, the rider gets a notice
-- (shown in the app, and as a phone alert on Android). The server uses the same fit check as when a driver accepts.
-- Needs 042 and 066. Run once in the Supabase SQL editor (safe to run again).

create table if not exists public.driver_finds (
  request_id uuid not null references public.ride_requests(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  ride_date date not null,
  notice_id uuid references public.notices(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, trip_id, ride_date)
);
alter table public.driver_finds enable row level security;
revoke all on public.driver_finds from anon, authenticated;

create or replace function public._tell_riders_of_trip() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; d date; today date := (now() at time zone 'America/Vancouver')::date; q jsonb; nid uuid; n integer := 0; who text; route text;
begin
  if not new.active or (new.expires_at is not null and new.expires_at < now()) then return new; end if;
  if tg_op = 'UPDATE' and old.active and old.depart_min is not distinct from new.depart_min and old.origin is not distinct from new.origin and old.dest is not distinct from new.dest then return new; end if;
  select coalesce(nullif(display_name, ''), 'A driver') into who from public.profiles where id = new.user_id;
  route := coalesce(new.origin, 'the start') || ' to ' || coalesce(new.dest, 'the destination');
  for r in
    select rq.* from public.ride_requests rq
     where rq.active and rq.user_id <> new.user_id and (rq.expires_at is null or rq.expires_at > now())
       and (rq.pays = 'either' or new.accepts = 'either' or rq.pays = new.accepts)
       and not exists (select 1 from public.matches m where m.request_id = rq.id and m.status in ('requested', 'accepted', 'completed') and m.ride_date >= today - 1)
     order by rq.created_at desc limit 60
  loop
    for d in select g::date from generate_series(greatest(today, r.ride_date), today + 13, interval '1 day') g loop
      exit when n >= 120;
      continue when not public._on_day(d, r.ride_date, r.repeat_days, r.repeat_until);
      continue when not public._on_day(d, coalesce(new.trip_date, today), new.repeat_days, new.repeat_until);
      continue when exists (select 1 from public.driver_finds f where f.request_id = r.id and f.trip_id = new.id and f.ride_date = d);
      n := n + 1;
      begin
        q := public._quote_trip(new.id, d, r.id, false);
      exception when others then q := null;
      end;
      if q is null or not coalesce((q->>'ok')::boolean, false) then continue; end if;
      insert into public.notices (user_id, kind, title, body)
        values (r.user_id, 'driver_found', 'A driver fits your ride',
                coalesce(who, 'A driver') || ' posted a trip (' || route || ') on ' || to_char(d, 'Dy Mon FMDD') || ' that fits your request. Open the app to ask for a seat.')
        returning id into nid;
      insert into public.driver_finds (request_id, trip_id, ride_date, notice_id) values (r.id, new.id, d, nid) on conflict do nothing;
      exit;   -- one alert per request per trip is enough
    end loop;
  end loop;
  return new;
exception when others then
  return new;   -- never block a driver from posting a trip because of this
end $$;
revoke all on function public._tell_riders_of_trip() from public, anon, authenticated;
drop trigger if exists trips_tell_riders on public.trips;
create trigger trips_tell_riders after insert or update on public.trips for each row execute function public._tell_riders_of_trip();

-- phone alerts: also hand over unread "driver appeared" notices, and keep the phone check running while a request waits
create or replace function public.rider_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; rides jsonb; finds jsonb; active boolean; today date := (now() at time zone 'America/Vancouver')::date;
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
      case when m.prop_time is not null and m.prop_time > now() then (extract(epoch from m.prop_time) * 1000)::bigint end as prop_ms
    from public.matches m
    join public.trips t on t.id = m.trip_id
    join public.ride_requests r on r.id = m.request_id
    left join public.profiles p on p.id = m.driver_id
    left join public.profile_cards pc on pc.user_id = m.driver_id
    where m.rider_id = u and m.status = 'accepted' and m.dropped_off_at is null and m.ride_date >= today - 1
    limit 6) y;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body) order by n.created_at), '[]'::jsonb) into finds
    from (select * from public.notices where user_id = u and kind = 'driver_found' and read_at is null and created_at > now() - interval '12 hours' order by created_at desc limit 3) n;
  return jsonb_build_object('active', active, 'rides', rides, 'finds', finds);
end $$;
revoke all on function public.rider_alerts_token(text) from public;
grant execute on function public.rider_alerts_token(text) to anon, authenticated;