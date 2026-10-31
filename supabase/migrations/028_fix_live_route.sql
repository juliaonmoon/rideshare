-- Migration 028: fixes two mistakes in the live-traffic lookup from migration 027 (an ambiguous name and a field access). Run once (safe to run again).

create or replace function public._live_route(p_stops public.route_stop[], p_depart timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v_sig text; c jsonb; n integer := coalesce(array_length(p_stops, 1), 0); i integer; body jsonb; mids jsonb := '[]'::jsonb; txt text; j jsonb; leg jsonb; legs jsonb := '[]'::jsonb;
        mins double precision := 0; kms double precision := 0; dep timestamptz; today date := (now() at time zone 'America/Vancouver')::date;
begin
  if n < 2 then return null; end if;
  begin select decrypted_secret into k from vault.decrypted_secrets where name = 'google_routes_key' limit 1; exception when others then k := null; end;
  if k is null or k = '' then return null; end if;
  dep := greatest(p_depart, now() + interval '30 seconds');
  if dep > now() + interval '6 days' then return null; end if;
  select string_agg(round(s.lat::numeric, 4) || ',' || round(s.lng::numeric, 4), ';') into v_sig from unnest(p_stops) s;
  v_sig := md5(v_sig || '@' || to_char(dep at time zone 'America/Vancouver', 'YYYY-MM-DD-HH24') || (extract(minute from dep at time zone 'America/Vancouver')::int / 15)::text);
  select result into c from public.route_cache where route_cache.sig = v_sig and route_cache.at > now() - interval '15 minutes';
  if c is not null then return c; end if;
  if not public._route_budget_ok() then return null; end if;
  for i in 2 .. n - 1 loop
    mids := mids || jsonb_build_array(jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', (p_stops[i]).lat, 'longitude', (p_stops[i]).lng))));
  end loop;
  body := jsonb_build_object(
    'origin', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', (p_stops[1]).lat, 'longitude', (p_stops[1]).lng))),
    'destination', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', (p_stops[n]).lat, 'longitude', (p_stops[n]).lng))),
    'intermediates', mids, 'travelMode', 'DRIVE', 'routingPreference', 'TRAFFIC_AWARE', 'departureTime', to_char(dep at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  insert into public.route_usage (day, calls) values (today, 1) on conflict (day) do update set calls = public.route_usage.calls + 1;
  txt := public._http_post_json('https://routes.googleapis.com/directions/v2:computeRoutes', k, 'routes.legs.duration,routes.legs.distanceMeters', body::text);
  if txt is null then return null; end if;
  begin j := txt::jsonb; exception when others then return null; end;
  if j->'routes'->0->'legs' is null then return null; end if;
  for leg in select * from jsonb_array_elements(j->'routes'->0->'legs') loop
    mins := mins + coalesce(nullif(rtrim(leg->>'duration', 's'), '')::double precision, 0) / 60;
    kms := kms + coalesce((leg->>'distanceMeters')::double precision, 0) / 1000;
    legs := legs || jsonb_build_array(round(coalesce((leg->>'distanceMeters')::numeric, 0) / 1000, 3));
  end loop;
  if jsonb_array_length(legs) <> n - 1 then return null; end if;
  c := jsonb_build_object('minutes', round(mins::numeric, 2), 'km', round(kms::numeric, 3), 'legs', legs);
  insert into public.route_cache (sig, result, at) values (v_sig, c, now()) on conflict (sig) do update set result = excluded.result, at = now();
  return c;
end $$;
revoke all on function public._live_route(public.route_stop[], timestamptz) from public, anon, authenticated;
