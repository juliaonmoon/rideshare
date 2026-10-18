-- Sample data for pre-launch testing. Run once in Supabase > SQL Editor (after schema.sql and migrations 002 and 003).
-- Creates made-up people (emails end in @example.invalid, they cannot sign in) with trips and ride requests that repeat every day, starting today.
-- Safe to re-run: it removes the old sample people first. Delete them all with the first statement alone.
delete from auth.users where email like 'sample-%@example.invalid';

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-taylor@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Taylor (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-robin@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Robin (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-kim@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Kim (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-lee@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Lee (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-ana@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Ana (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-d-omar@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Omar (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-alex@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Alex (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-priya@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Priya (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-sam@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Sam (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-jordan@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Jordan (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-dana@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Dana (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-mei@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Mei (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-chris@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Chris (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-noor@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Noor (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-pat@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Pat (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-samt@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Sam T. (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-jo@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Jo (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-leah@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Leah (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-riley@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Riley (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-casey@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Casey (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-avery@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Avery (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-blake@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Blake (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-ellis@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Ellis (sample)"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'sample-r-frankie@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Frankie (sample)"}'::jsonb, now(), now());

insert into public.trips (user_id, origin, dest, depart_min, max_detour, max_wait, accepts, cost_per_km, trip_date, repeat_days)
select u.id, v.o, v.d, v.t, v.dt, v.w, v.a, 0.20, current_date, '{1,2,3,4,5,6,7}'::smallint[] from (values
  ('sample-d-taylor@example.invalid', 'Surrey Central', 'BCIT / Willingdon (Burnaby)', 450, 8, 5, 'either'),
  ('sample-d-robin@example.invalid', 'Fleetwood (Surrey)', 'Brentwood (Burnaby)', 440, 10, 8, 'points'),
  ('sample-d-kim@example.invalid', 'Newton (Surrey)', 'Metrotown (Burnaby)', 435, 6, 5, 'cash'),
  ('sample-d-lee@example.invalid', 'Guildford (Surrey)', 'SFU Burnaby', 480, 12, 10, 'either'),
  ('sample-d-ana@example.invalid', 'Whalley (Surrey)', 'Brentwood (Burnaby)', 445, 9, 6, 'either'),
  ('sample-d-omar@example.invalid', 'Guildford (Surrey)', 'Production Way (Burnaby)', 440, 8, 6, 'points')
) as v(em, o, d, t, dt, w, a) join auth.users u on u.email = v.em;

insert into public.ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, ride_date, repeat_days)
select u.id, v.p, v.d, v.f, v.t, v.pay, current_date, '{1,2,3,4,5,6,7}'::smallint[] from (values
  ('sample-r-alex@example.invalid', 'Whalley (Surrey)', 'BCIT / Willingdon (Burnaby)', 445, 470, 'points'),
  ('sample-r-priya@example.invalid', 'Surrey Central', 'Edmonds (Burnaby)', 440, 465, 'cash'),
  ('sample-r-sam@example.invalid', 'Pattullo Bridge (New West)', 'BCIT / Willingdon (Burnaby)', 455, 485, 'points'),
  ('sample-r-jordan@example.invalid', 'Whalley (Surrey)', 'Royal Oak (Burnaby)', 450, 475, 'either'),
  ('sample-r-dana@example.invalid', 'Surrey Central', 'Brentwood (Burnaby)', 445, 485, 'cash'),
  ('sample-r-mei@example.invalid', 'Edmonds (Burnaby)', 'BCIT / Willingdon (Burnaby)', 465, 495, 'points'),
  ('sample-r-chris@example.invalid', 'South Surrey', 'Brentwood (Burnaby)', 390, 420, 'points'),
  ('sample-r-noor@example.invalid', 'Guildford (Surrey)', 'Production Way (Burnaby)', 435, 470, 'points'),
  ('sample-r-pat@example.invalid', 'Fleetwood (Surrey)', 'BCIT / Willingdon (Burnaby)', 440, 465, 'cash'),
  ('sample-r-samt@example.invalid', 'Newton (Surrey)', 'Metrotown (Burnaby)', 430, 460, 'points'),
  ('sample-r-jo@example.invalid', 'Cloverdale (Surrey)', 'Lougheed (Burnaby)', 420, 440, 'cash'),
  ('sample-r-leah@example.invalid', 'Port Coquitlam', 'SFU Burnaby', 450, 480, 'either'),
  ('sample-r-riley@example.invalid', 'Surrey Central', 'BCIT / Willingdon (Burnaby)', 450, 465, 'points'),
  ('sample-r-casey@example.invalid', 'Whalley (Surrey)', 'Metrotown (Burnaby)', 445, 475, 'cash'),
  ('sample-r-avery@example.invalid', 'Pattullo Bridge (New West)', 'Royal Oak (Burnaby)', 460, 490, 'either'),
  ('sample-r-blake@example.invalid', 'Braid (New West)', 'BCIT / Willingdon (Burnaby)', 465, 495, 'points'),
  ('sample-r-ellis@example.invalid', 'Surrey Central', 'BCIT / Willingdon (Burnaby)', 360, 390, 'points'),
  ('sample-r-frankie@example.invalid', 'Port Coquitlam', 'BCIT / Willingdon (Burnaby)', 450, 480, 'cash')
) as v(em, p, d, f, t, pay) join auth.users u on u.email = v.em;
