-- Migration 027: the SERVER works out each rider's extra minutes, extra km and price. The rider's phone sends only locations.
-- Run once in the Supabase SQL editor (safe to run again). Needs migrations 020, 025 and 026 first.
--   * Live traffic from Google (Routes API) is used when a server key is stored and the usage cap allows it; otherwise the saved
--     typical-traffic drive times (the same numbers the app already has) are used, so the service never stops.
--   * The cost of the whole route is shared by everyone in the car, so riders together never pay more than the trip costs.
--   * When a new rider is accepted, riders who are already booked can only pay less, never more (the difference goes back to them).
--
-- To switch live traffic on (Jules does this once, see docs/TODO_FOR_JULES.md): store the server-only Google key in Supabase Vault:
--   select vault.create_secret('PASTE-THE-KEY-HERE', 'google_routes_key');
-- Without the key everything still works using the saved drive times.

-- ---------- 1. The saved drive times, kept in the database ----------
create table if not exists public.traffic_centres (i integer primary key, name text not null, lat double precision not null, lng double precision not null);
create table if not exists public.traffic_times (bucket text not null, from_i integer not null, to_i integer not null, minutes double precision, primary key (bucket, from_i, to_i));
alter table public.traffic_centres enable row level security;
alter table public.traffic_times enable row level security;
revoke all on public.traffic_centres, public.traffic_times from anon, authenticated;
truncate public.traffic_centres, public.traffic_times;
insert into public.traffic_centres (i, name, lat, lng) values
  (0, 'Surrey Central', 49.189, -122.849),
  (1, 'Guildford (Surrey)', 49.191, -122.801),
  (2, 'Fleetwood (Surrey)', 49.153, -122.795),
  (3, 'Newton (Surrey)', 49.133, -122.845),
  (4, 'Cloverdale (Surrey)', 49.105, -122.735),
  (5, 'South Surrey', 49.05, -122.8),
  (6, 'Port Coquitlam', 49.263, -122.781),
  (7, 'Lougheed (Burnaby)', 49.2484, -122.897),
  (8, 'Production Way (Burnaby)', 49.2539, -122.9181),
  (9, 'SFU Burnaby', 49.2781, -122.9199),
  (10, 'Brentwood (Burnaby)', 49.2665, -123.0007),
  (11, 'BCIT / Willingdon (Burnaby)', 49.249, -123),
  (12, 'Metrotown (Burnaby)', 49.2276, -123.0076),
  (13, 'Whalley (Surrey)', 49.195, -122.865),
  (14, 'Pattullo Bridge (New West)', 49.206, -122.9),
  (15, 'Edmonds (Burnaby)', 49.2124, -122.9591),
  (16, 'Royal Oak (Burnaby)', 49.22, -122.988),
  (17, 'Braid (New West)', 49.233, -122.882),
  (18, 'Sperling (Burnaby)', 49.259, -122.964);
insert into public.traffic_times (bucket, from_i, to_i, minutes) values
  ('wk_am',0,0,0),
  ('wk_am',0,1,9.8),
  ('wk_am',0,2,17.7),
  ('wk_am',0,3,15.8),
  ('wk_am',0,4,29.4),
  ('wk_am',0,5,30.1),
  ('wk_am',0,6,23.3),
  ('wk_am',0,7,25.9),
  ('wk_am',0,8,30.1),
  ('wk_am',0,9,36.3),
  ('wk_am',0,10,38.5),
  ('wk_am',0,11,38),
  ('wk_am',0,12,42.3),
  ('wk_am',0,13,5.7),
  ('wk_am',0,14,19.4),
  ('wk_am',0,15,40.7),
  ('wk_am',0,16,41.8),
  ('wk_am',0,17,23.9),
  ('wk_am',0,18,33.4),
  ('wk_am',1,0,10.1),
  ('wk_am',1,1,0),
  ('wk_am',1,2,10.1),
  ('wk_am',1,3,19.2),
  ('wk_am',1,4,21.8),
  ('wk_am',1,5,26.1),
  ('wk_am',1,6,16.8),
  ('wk_am',1,7,19.6),
  ('wk_am',1,8,24),
  ('wk_am',1,9,30.1),
  ('wk_am',1,10,32.6),
  ('wk_am',1,11,32.3),
  ('wk_am',1,12,36.4),
  ('wk_am',1,13,12.1),
  ('wk_am',1,14,26.3),
  ('wk_am',1,15,36),
  ('wk_am',1,16,35.9),
  ('wk_am',1,17,17.5),
  ('wk_am',1,18,27.6),
  ('wk_am',2,0,18.8),
  ('wk_am',2,1,13.8),
  ('wk_am',2,2,0),
  ('wk_am',2,3,13.7),
  ('wk_am',2,4,16.3),
  ('wk_am',2,5,19.5),
  ('wk_am',2,6,25.9),
  ('wk_am',2,7,28),
  ('wk_am',2,8,32.2),
  ('wk_am',2,9,38.3),
  ('wk_am',2,10,40.2),
  ('wk_am',2,11,40.1),
  ('wk_am',2,12,44.5),
  ('wk_am',2,13,20.7),
  ('wk_am',2,14,33.1),
  ('wk_am',2,15,44),
  ('wk_am',2,16,44),
  ('wk_am',2,17,26.1),
  ('wk_am',2,18,35.5),
  ('wk_am',3,0,17.2),
  ('wk_am',3,1,21),
  ('wk_am',3,2,13.3),
  ('wk_am',3,3,0),
  ('wk_am',3,4,20.6),
  ('wk_am',3,5,18.1),
  ('wk_am',3,6,35.1),
  ('wk_am',3,7,37.8),
  ('wk_am',3,8,41.9),
  ('wk_am',3,9,48.1),
  ('wk_am',3,10,50.1),
  ('wk_am',3,11,48.4),
  ('wk_am',3,12,46.5),
  ('wk_am',3,13,18.7),
  ('wk_am',3,14,36.8),
  ('wk_am',3,15,38.1),
  ('wk_am',3,16,42.4),
  ('wk_am',3,17,35.9),
  ('wk_am',3,18,45),
  ('wk_am',4,0,32),
  ('wk_am',4,1,23.4),
  ('wk_am',4,2,16.9),
  ('wk_am',4,3,17.7),
  ('wk_am',4,4,0),
  ('wk_am',4,5,15.8),
  ('wk_am',4,6,31.6),
  ('wk_am',4,7,33.3),
  ('wk_am',4,8,37.4),
  ('wk_am',4,9,43.7),
  ('wk_am',4,10,45.9),
  ('wk_am',4,11,45.6),
  ('wk_am',4,12,50.3),
  ('wk_am',4,13,33.7),
  ('wk_am',4,14,38.9),
  ('wk_am',4,15,45.4),
  ('wk_am',4,16,49.5),
  ('wk_am',4,17,31.4),
  ('wk_am',4,18,40.9),
  ('wk_am',5,0,32.7),
  ('wk_am',5,1,29),
  ('wk_am',5,2,18.4),
  ('wk_am',5,3,17.2),
  ('wk_am',5,4,15),
  ('wk_am',5,5,0),
  ('wk_am',5,6,41.6),
  ('wk_am',5,7,44.1),
  ('wk_am',5,8,47.8),
  ('wk_am',5,9,54),
  ('wk_am',5,10,56.1),
  ('wk_am',5,11,49),
  ('wk_am',5,12,47.1),
  ('wk_am',5,13,29.7),
  ('wk_am',5,14,37.4),
  ('wk_am',5,15,38.8),
  ('wk_am',5,16,42.8),
  ('wk_am',5,17,42),
  ('wk_am',5,18,49.7),
  ('wk_am',6,0,23.6),
  ('wk_am',6,1,14.8),
  ('wk_am',6,2,23.9),
  ('wk_am',6,3,34.8),
  ('wk_am',6,4,28.3),
  ('wk_am',6,5,42),
  ('wk_am',6,6,0),
  ('wk_am',6,7,17.1),
  ('wk_am',6,8,21.6),
  ('wk_am',6,9,24.7),
  ('wk_am',6,10,30.3),
  ('wk_am',6,11,29.7),
  ('wk_am',6,12,34.1),
  ('wk_am',6,13,23.2),
  ('wk_am',6,14,23.6),
  ('wk_am',6,15,33.4),
  ('wk_am',6,16,33.3),
  ('wk_am',6,17,15),
  ('wk_am',6,18,25.1),
  ('wk_am',7,0,23.6),
  ('wk_am',7,1,15.8),
  ('wk_am',7,2,24.9),
  ('wk_am',7,3,35.1),
  ('wk_am',7,4,29.3),
  ('wk_am',7,5,35.1),
  ('wk_am',7,6,17.1),
  ('wk_am',7,7,0),
  ('wk_am',7,8,9.1),
  ('wk_am',7,9,12),
  ('wk_am',7,10,18.3),
  ('wk_am',7,11,21.3),
  ('wk_am',7,12,25.3),
  ('wk_am',7,13,19.3),
  ('wk_am',7,14,15.4),
  ('wk_am',7,15,22.2),
  ('wk_am',7,16,24.5),
  ('wk_am',7,17,8),
  ('wk_am',7,18,12.2),
  ('wk_am',8,0,24.8),
  ('wk_am',8,1,15),
  ('wk_am',8,2,24.3),
  ('wk_am',8,3,34.9),
  ('wk_am',8,4,28.5),
  ('wk_am',8,5,36.3),
  ('wk_am',8,6,16.4),
  ('wk_am',8,7,9),
  ('wk_am',8,8,0),
  ('wk_am',8,9,10.4),
  ('wk_am',8,10,12.1),
  ('wk_am',8,11,15.5),
  ('wk_am',8,12,20.6),
  ('wk_am',8,13,20.6),
  ('wk_am',8,14,16.7),
  ('wk_am',8,15,19.8),
  ('wk_am',8,16,19.7),
  ('wk_am',8,17,7.7),
  ('wk_am',8,18,8.6),
  ('wk_am',9,0,31.3),
  ('wk_am',9,1,21.3),
  ('wk_am',9,2,30.8),
  ('wk_am',9,3,42.1),
  ('wk_am',9,4,34.6),
  ('wk_am',9,5,42.8),
  ('wk_am',9,6,22.7),
  ('wk_am',9,7,13.4),
  ('wk_am',9,8,10),
  ('wk_am',9,9,0),
  ('wk_am',9,10,15.4),
  ('wk_am',9,11,19.8),
  ('wk_am',9,12,25),
  ('wk_am',9,13,27),
  ('wk_am',9,14,22.7),
  ('wk_am',9,15,25.5),
  ('wk_am',9,16,24),
  ('wk_am',9,17,14.1),
  ('wk_am',9,18,14),
  ('wk_am',10,0,28.3),
  ('wk_am',10,1,19.5),
  ('wk_am',10,2,28.8),
  ('wk_am',10,3,39.4),
  ('wk_am',10,4,32.8),
  ('wk_am',10,5,42.4),
  ('wk_am',10,6,20.9),
  ('wk_am',10,7,17.1),
  ('wk_am',10,8,14.9),
  ('wk_am',10,9,17.2),
  ('wk_am',10,10,0),
  ('wk_am',10,11,7.5),
  ('wk_am',10,12,10.7),
  ('wk_am',10,13,25.1),
  ('wk_am',10,14,20.9),
  ('wk_am',10,15,17.3),
  ('wk_am',10,16,13.7),
  ('wk_am',10,17,12.3),
  ('wk_am',10,18,10.1),
  ('wk_am',11,0,29.2),
  ('wk_am',11,1,19.2),
  ('wk_am',11,2,28.5),
  ('wk_am',11,3,36.6),
  ('wk_am',11,4,32.6),
  ('wk_am',11,5,36),
  ('wk_am',11,6,20.6),
  ('wk_am',11,7,16.8),
  ('wk_am',11,8,13.2),
  ('wk_am',11,9,20),
  ('wk_am',11,10,8.6),
  ('wk_am',11,11,0),
  ('wk_am',11,12,6.1),
  ('wk_am',11,13,25.1),
  ('wk_am',11,14,21.5),
  ('wk_am',11,15,12.5),
  ('wk_am',11,16,7.5),
  ('wk_am',11,17,12),
  ('wk_am',11,18,8),
  ('wk_am',12,0,29.2),
  ('wk_am',12,1,22.4),
  ('wk_am',12,2,31.8),
  ('wk_am',12,3,34.8),
  ('wk_am',12,4,35.7),
  ('wk_am',12,5,34.2),
  ('wk_am',12,6,24),
  ('wk_am',12,7,20.1),
  ('wk_am',12,8,17.8),
  ('wk_am',12,9,23.8),
  ('wk_am',12,10,12),
  ('wk_am',12,11,6.3),
  ('wk_am',12,12,0),
  ('wk_am',12,13,25),
  ('wk_am',12,14,20.4),
  ('wk_am',12,15,10.8),
  ('wk_am',12,16,6.3),
  ('wk_am',12,17,15.3),
  ('wk_am',12,18,13.3),
  ('wk_am',13,0,6.6),
  ('wk_am',13,1,11.2),
  ('wk_am',13,2,19.6),
  ('wk_am',13,3,16.8),
  ('wk_am',13,4,29.4),
  ('wk_am',13,5,25.8),
  ('wk_am',13,6,22.6),
  ('wk_am',13,7,25.2),
  ('wk_am',13,8,29.5),
  ('wk_am',13,9,32),
  ('wk_am',13,10,37.9),
  ('wk_am',13,11,37.5),
  ('wk_am',13,12,41.7),
  ('wk_am',13,13,0),
  ('wk_am',13,14,15.4),
  ('wk_am',13,15,36.2),
  ('wk_am',13,16,41.2),
  ('wk_am',13,17,22.3),
  ('wk_am',13,18,32.8),
  ('wk_am',14,0,18.2),
  ('wk_am',14,1,15.9),
  ('wk_am',14,2,25.3),
  ('wk_am',14,3,29.6),
  ('wk_am',14,4,29.4),
  ('wk_am',14,5,29.7),
  ('wk_am',14,6,17.3),
  ('wk_am',14,7,11.8),
  ('wk_am',14,8,15.5),
  ('wk_am',14,9,21.5),
  ('wk_am',14,10,25.9),
  ('wk_am',14,11,25.4),
  ('wk_am',14,12,25.8),
  ('wk_am',14,13,14),
  ('wk_am',14,14,0),
  ('wk_am',14,15,20.3),
  ('wk_am',14,16,23.8),
  ('wk_am',14,17,12.9),
  ('wk_am',14,18,18.5),
  ('wk_am',15,0,23.4),
  ('wk_am',15,1,23.1),
  ('wk_am',15,2,32.7),
  ('wk_am',15,3,29.5),
  ('wk_am',15,4,36.4),
  ('wk_am',15,5,29),
  ('wk_am',15,6,24.6),
  ('wk_am',15,7,17.5),
  ('wk_am',15,8,18.3),
  ('wk_am',15,9,24.3),
  ('wk_am',15,10,19.9),
  ('wk_am',15,11,13.2),
  ('wk_am',15,12,10.5),
  ('wk_am',15,13,19.2),
  ('wk_am',15,14,14.4),
  ('wk_am',15,15,0),
  ('wk_am',15,16,8.4),
  ('wk_am',15,17,15.9),
  ('wk_am',15,18,13.8),
  ('wk_am',16,0,26.8),
  ('wk_am',16,1,21.4),
  ('wk_am',16,2,31),
  ('wk_am',16,3,31),
  ('wk_am',16,4,34.6),
  ('wk_am',16,5,30.4),
  ('wk_am',16,6,22.8),
  ('wk_am',16,7,19),
  ('wk_am',16,8,16.8),
  ('wk_am',16,9,22.7),
  ('wk_am',16,10,14.7),
  ('wk_am',16,11,7.8),
  ('wk_am',16,12,6.4),
  ('wk_am',16,13,22.6),
  ('wk_am',16,14,17.8),
  ('wk_am',16,15,8.1),
  ('wk_am',16,16,0),
  ('wk_am',16,17,14.2),
  ('wk_am',16,18,12),
  ('wk_am',17,0,17.6),
  ('wk_am',17,1,10.2),
  ('wk_am',17,2,19.3),
  ('wk_am',17,3,28.9),
  ('wk_am',17,4,23.4),
  ('wk_am',17,5,29),
  ('wk_am',17,6,11.5),
  ('wk_am',17,7,6.3),
  ('wk_am',17,8,11.6),
  ('wk_am',17,9,17),
  ('wk_am',17,10,19.8),
  ('wk_am',17,11,20),
  ('wk_am',17,12,24),
  ('wk_am',17,13,13.3),
  ('wk_am',17,14,8.6),
  ('wk_am',17,15,20.1),
  ('wk_am',17,16,24),
  ('wk_am',17,17,0),
  ('wk_am',17,18,14.6),
  ('wk_am',18,0,26.8),
  ('wk_am',18,1,16.9),
  ('wk_am',18,2,26.2),
  ('wk_am',18,3,36.9),
  ('wk_am',18,4,30.3),
  ('wk_am',18,5,38.3),
  ('wk_am',18,6,18.3),
  ('wk_am',18,7,11),
  ('wk_am',18,8,5.1),
  ('wk_am',18,9,12.5),
  ('wk_am',18,10,9),
  ('wk_am',18,11,12.2),
  ('wk_am',18,12,17.4),
  ('wk_am',18,13,22.5),
  ('wk_am',18,14,18.3),
  ('wk_am',18,15,17.8),
  ('wk_am',18,16,16.4),
  ('wk_am',18,17,9.7),
  ('wk_am',18,18,0),
  ('wk_mid',0,0,0),
  ('wk_mid',0,1,10.5),
  ('wk_mid',0,2,18.8),
  ('wk_mid',0,3,20.6),
  ('wk_mid',0,4,29.6),
  ('wk_mid',0,5,29.9),
  ('wk_mid',0,6,23.9),
  ('wk_mid',0,7,22.8),
  ('wk_mid',0,8,24.5),
  ('wk_mid',0,9,31),
  ('wk_mid',0,10,29.4),
  ('wk_mid',0,11,29.6),
  ('wk_mid',0,12,34.3),
  ('wk_mid',0,13,5.7),
  ('wk_mid',0,14,29.2),
  ('wk_mid',0,15,32.5),
  ('wk_mid',0,16,34),
  ('wk_mid',0,17,20.3),
  ('wk_mid',0,18,26),
  ('wk_mid',1,0,11),
  ('wk_mid',1,1,0),
  ('wk_mid',1,2,11.3),
  ('wk_mid',1,3,22),
  ('wk_mid',1,4,22.7),
  ('wk_mid',1,5,29.6),
  ('wk_mid',1,6,16.8),
  ('wk_mid',1,7,15.8),
  ('wk_mid',1,8,17.4),
  ('wk_mid',1,9,24),
  ('wk_mid',1,10,22.7),
  ('wk_mid',1,11,22.6),
  ('wk_mid',1,12,27.3),
  ('wk_mid',1,13,12.7),
  ('wk_mid',1,14,22.3),
  ('wk_mid',1,15,27.7),
  ('wk_mid',1,16,26.9),
  ('wk_mid',1,17,13.3),
  ('wk_mid',1,18,19.1),
  ('wk_mid',2,0,18.6);
insert into public.traffic_times (bucket, from_i, to_i, minutes) values
  ('wk_mid',2,1,12.8),
  ('wk_mid',2,2,0),
  ('wk_mid',2,3,14.6),
  ('wk_mid',2,4,16.2),
  ('wk_mid',2,5,21.9),
  ('wk_mid',2,6,24.4),
  ('wk_mid',2,7,23.2),
  ('wk_mid',2,8,24.9),
  ('wk_mid',2,9,31.5),
  ('wk_mid',2,10,29.9),
  ('wk_mid',2,11,30),
  ('wk_mid',2,12,34.8),
  ('wk_mid',2,13,20.2),
  ('wk_mid',2,14,29.7),
  ('wk_mid',2,15,35.1),
  ('wk_mid',2,16,34.4),
  ('wk_mid',2,17,20.7),
  ('wk_mid',2,18,26.5),
  ('wk_mid',3,0,18.3),
  ('wk_mid',3,1,20.7),
  ('wk_mid',3,2,14.8),
  ('wk_mid',3,3,0),
  ('wk_mid',3,4,20.1),
  ('wk_mid',3,5,19.9),
  ('wk_mid',3,6,35.1),
  ('wk_mid',3,7,33.7),
  ('wk_mid',3,8,35.6),
  ('wk_mid',3,9,42.2),
  ('wk_mid',3,10,40.4),
  ('wk_mid',3,11,39.4),
  ('wk_mid',3,12,36.8),
  ('wk_mid',3,13,18.8),
  ('wk_mid',3,14,29.2),
  ('wk_mid',3,15,29.8),
  ('wk_mid',3,16,33.4),
  ('wk_mid',3,17,31.2),
  ('wk_mid',3,18,36.9),
  ('wk_mid',4,0,30.4),
  ('wk_mid',4,1,21.4),
  ('wk_mid',4,2,16),
  ('wk_mid',4,3,17.9),
  ('wk_mid',4,4,0),
  ('wk_mid',4,5,16.9),
  ('wk_mid',4,6,29),
  ('wk_mid',4,7,27.6),
  ('wk_mid',4,8,29.5),
  ('wk_mid',4,9,36.1),
  ('wk_mid',4,10,34.2),
  ('wk_mid',4,11,34.4),
  ('wk_mid',4,12,39.2),
  ('wk_mid',4,13,31.1),
  ('wk_mid',4,14,34),
  ('wk_mid',4,15,35.3),
  ('wk_mid',4,16,38.8),
  ('wk_mid',4,17,25.6),
  ('wk_mid',4,18,30.8),
  ('wk_mid',5,0,34.5),
  ('wk_mid',5,1,31.4),
  ('wk_mid',5,2,20.5),
  ('wk_mid',5,3,18),
  ('wk_mid',5,4,15.9),
  ('wk_mid',5,5,0),
  ('wk_mid',5,6,43.1),
  ('wk_mid',5,7,41.5),
  ('wk_mid',5,8,43.2),
  ('wk_mid',5,9,49.8),
  ('wk_mid',5,10,43.6),
  ('wk_mid',5,11,38.4),
  ('wk_mid',5,12,35.8),
  ('wk_mid',5,13,27),
  ('wk_mid',5,14,28.9),
  ('wk_mid',5,15,28.8),
  ('wk_mid',5,16,32.4),
  ('wk_mid',5,17,39.1),
  ('wk_mid',5,18,39.2),
  ('wk_mid',6,0,23.8),
  ('wk_mid',6,1,14.3),
  ('wk_mid',6,2,23.7),
  ('wk_mid',6,3,36.2),
  ('wk_mid',6,4,27.7),
  ('wk_mid',6,5,43.8),
  ('wk_mid',6,6,0),
  ('wk_mid',6,7,15.8),
  ('wk_mid',6,8,17.5),
  ('wk_mid',6,9,24.1),
  ('wk_mid',6,10,22.7),
  ('wk_mid',6,11,22.6),
  ('wk_mid',6,12,27.3),
  ('wk_mid',6,13,22.8),
  ('wk_mid',6,14,22.3),
  ('wk_mid',6,15,27.7),
  ('wk_mid',6,16,27),
  ('wk_mid',6,17,13.3),
  ('wk_mid',6,18,19.1),
  ('wk_mid',7,0,23.5),
  ('wk_mid',7,1,15.9),
  ('wk_mid',7,2,25.5),
  ('wk_mid',7,3,39.2),
  ('wk_mid',7,4,29.4),
  ('wk_mid',7,5,35.4),
  ('wk_mid',7,6,18.5),
  ('wk_mid',7,7,0),
  ('wk_mid',7,8,8.4),
  ('wk_mid',7,9,12.7),
  ('wk_mid',7,10,16.8),
  ('wk_mid',7,11,17.8),
  ('wk_mid',7,12,22.4),
  ('wk_mid',7,13,19.2),
  ('wk_mid',7,14,15.5),
  ('wk_mid',7,15,20.1),
  ('wk_mid',7,16,22.2),
  ('wk_mid',7,17,8),
  ('wk_mid',7,18,12.5),
  ('wk_mid',8,0,24.9),
  ('wk_mid',8,1,15.2),
  ('wk_mid',8,2,24.7),
  ('wk_mid',8,3,37.2),
  ('wk_mid',8,4,28.6),
  ('wk_mid',8,5,37),
  ('wk_mid',8,6,17.8),
  ('wk_mid',8,7,9.1),
  ('wk_mid',8,8,0),
  ('wk_mid',8,9,10.7),
  ('wk_mid',8,10,11.1),
  ('wk_mid',8,11,14.5),
  ('wk_mid',8,12,19.1),
  ('wk_mid',8,13,20.8),
  ('wk_mid',8,14,16.7),
  ('wk_mid',8,15,19.5),
  ('wk_mid',8,16,19.5),
  ('wk_mid',8,17,8.2),
  ('wk_mid',8,18,8.6),
  ('wk_mid',9,0,31.9),
  ('wk_mid',9,1,21.9),
  ('wk_mid',9,2,31.4),
  ('wk_mid',9,3,44),
  ('wk_mid',9,4,35.4),
  ('wk_mid',9,5,43.7),
  ('wk_mid',9,6,24.5),
  ('wk_mid',9,7,13.9),
  ('wk_mid',9,8,10.5),
  ('wk_mid',9,9,0),
  ('wk_mid',9,10,15.8),
  ('wk_mid',9,11,19.4),
  ('wk_mid',9,12,25.8),
  ('wk_mid',9,13,27.5),
  ('wk_mid',9,14,23.4),
  ('wk_mid',9,15,26.2),
  ('wk_mid',9,16,24.5),
  ('wk_mid',9,17,14.8),
  ('wk_mid',9,18,14.8),
  ('wk_mid',10,0,29.8),
  ('wk_mid',10,1,20.3),
  ('wk_mid',10,2,29.8),
  ('wk_mid',10,3,42.5),
  ('wk_mid',10,4,33.7),
  ('wk_mid',10,5,44.9),
  ('wk_mid',10,6,22.9),
  ('wk_mid',10,7,18.2),
  ('wk_mid',10,8,15.3),
  ('wk_mid',10,9,17.8),
  ('wk_mid',10,10,0),
  ('wk_mid',10,11,8.1),
  ('wk_mid',10,12,12.5),
  ('wk_mid',10,13,27.2),
  ('wk_mid',10,14,22.3),
  ('wk_mid',10,15,19),
  ('wk_mid',10,16,15.3),
  ('wk_mid',10,17,13.2),
  ('wk_mid',10,18,11.1),
  ('wk_mid',11,0,29),
  ('wk_mid',11,1,19.5),
  ('wk_mid',11,2,29),
  ('wk_mid',11,3,39.3),
  ('wk_mid',11,4,32.9),
  ('wk_mid',11,5,37.5),
  ('wk_mid',11,6,22.1),
  ('wk_mid',11,7,17.4),
  ('wk_mid',11,8,14),
  ('wk_mid',11,9,20.7),
  ('wk_mid',11,10,8.7),
  ('wk_mid',11,11,0),
  ('wk_mid',11,12,7.2),
  ('wk_mid',11,13,27),
  ('wk_mid',11,14,21.5),
  ('wk_mid',11,15,13.3),
  ('wk_mid',11,16,8),
  ('wk_mid',11,17,12.5),
  ('wk_mid',11,18,8.5),
  ('wk_mid',12,0,32.5),
  ('wk_mid',12,1,23.9),
  ('wk_mid',12,2,33.4),
  ('wk_mid',12,3,36.9),
  ('wk_mid',12,4,37.4),
  ('wk_mid',12,5,35.2),
  ('wk_mid',12,6,26.5),
  ('wk_mid',12,7,21.7),
  ('wk_mid',12,8,18.9),
  ('wk_mid',12,9,25.6),
  ('wk_mid',12,10,13.2),
  ('wk_mid',12,11,7),
  ('wk_mid',12,12,0),
  ('wk_mid',12,13,28.1),
  ('wk_mid',12,14,23.6),
  ('wk_mid',12,15,13.5),
  ('wk_mid',12,16,7.9),
  ('wk_mid',12,17,16.9),
  ('wk_mid',12,18,14.4),
  ('wk_mid',13,0,6.6),
  ('wk_mid',13,1,11.6),
  ('wk_mid',13,2,20.7),
  ('wk_mid',13,3,21),
  ('wk_mid',13,4,29),
  ('wk_mid',13,5,25.8),
  ('wk_mid',13,6,22.6),
  ('wk_mid',13,7,21.5),
  ('wk_mid',13,8,23.2),
  ('wk_mid',13,9,27.6),
  ('wk_mid',13,10,28.2),
  ('wk_mid',13,11,28.3),
  ('wk_mid',13,12,33.1),
  ('wk_mid',13,13,0),
  ('wk_mid',13,14,11.6),
  ('wk_mid',13,15,28.2),
  ('wk_mid',13,16,26.9),
  ('wk_mid',13,17,19),
  ('wk_mid',13,18,24.9),
  ('wk_mid',14,0,19.2),
  ('wk_mid',14,1,18.2),
  ('wk_mid',14,2,27.7),
  ('wk_mid',14,3,34.8),
  ('wk_mid',14,4,31.5),
  ('wk_mid',14,5,31.2),
  ('wk_mid',14,6,20.7),
  ('wk_mid',14,7,14.3),
  ('wk_mid',14,8,15.9),
  ('wk_mid',14,9,22.4),
  ('wk_mid',14,10,22.7),
  ('wk_mid',14,11,22.6),
  ('wk_mid',14,12,26.2),
  ('wk_mid',14,13,14.9),
  ('wk_mid',14,14,0),
  ('wk_mid',14,15,19.4),
  ('wk_mid',14,16,25),
  ('wk_mid',14,17,14.9),
  ('wk_mid',14,18,19.1),
  ('wk_mid',15,0,24.8),
  ('wk_mid',15,1,23.3),
  ('wk_mid',15,2,32.8),
  ('wk_mid',15,3,29.4),
  ('wk_mid',15,4,35.3),
  ('wk_mid',15,5,27.6),
  ('wk_mid',15,6,25.9),
  ('wk_mid',15,7,18.4),
  ('wk_mid',15,8,19.7),
  ('wk_mid',15,9,26.4),
  ('wk_mid',15,10,18.3),
  ('wk_mid',15,11,13.3),
  ('wk_mid',15,12,13.9),
  ('wk_mid',15,13,20.6),
  ('wk_mid',15,14,15.8),
  ('wk_mid',15,15,0),
  ('wk_mid',15,16,9.1),
  ('wk_mid',15,17,16.3),
  ('wk_mid',15,18,13.9),
  ('wk_mid',16,0,29.7),
  ('wk_mid',16,1,22.2),
  ('wk_mid',16,2,31.7),
  ('wk_mid',16,3,33.3),
  ('wk_mid',16,4,35.7),
  ('wk_mid',16,5,31.6),
  ('wk_mid',16,6,24.8),
  ('wk_mid',16,7,20.1),
  ('wk_mid',16,8,17.2),
  ('wk_mid',16,9,23.8),
  ('wk_mid',16,10,15.5),
  ('wk_mid',16,11,8.1),
  ('wk_mid',16,12,8.8),
  ('wk_mid',16,13,25.4),
  ('wk_mid',16,14,20),
  ('wk_mid',16,15,9.1),
  ('wk_mid',16,16,0),
  ('wk_mid',16,17,15.2),
  ('wk_mid',16,18,12.8),
  ('wk_mid',17,0,18.5),
  ('wk_mid',17,1,10.2),
  ('wk_mid',17,2,19.6),
  ('wk_mid',17,3,34.1),
  ('wk_mid',17,4,23.7),
  ('wk_mid',17,5,30.4),
  ('wk_mid',17,6,12.7),
  ('wk_mid',17,7,6.7),
  ('wk_mid',17,8,11.3),
  ('wk_mid',17,9,17.8),
  ('wk_mid',17,10,14.7),
  ('wk_mid',17,11,14.6),
  ('wk_mid',17,12,19.3),
  ('wk_mid',17,13,14.2),
  ('wk_mid',17,14,9.2),
  ('wk_mid',17,15,18.2),
  ('wk_mid',17,16,19),
  ('wk_mid',17,17,0),
  ('wk_mid',17,18,11.1),
  ('wk_mid',18,0,27.4),
  ('wk_mid',18,1,17.4),
  ('wk_mid',18,2,27),
  ('wk_mid',18,3,41.4),
  ('wk_mid',18,4,30.8),
  ('wk_mid',18,5,39.2),
  ('wk_mid',18,6,20),
  ('wk_mid',18,7,11.3),
  ('wk_mid',18,8,5.4),
  ('wk_mid',18,9,13.2),
  ('wk_mid',18,10,8.7),
  ('wk_mid',18,11,11.5),
  ('wk_mid',18,12,17.7),
  ('wk_mid',18,13,23),
  ('wk_mid',18,14,18.9),
  ('wk_mid',18,15,18.4),
  ('wk_mid',18,16,16.5),
  ('wk_mid',18,17,10.4),
  ('wk_mid',18,18,0),
  ('wk_pm',0,0,0),
  ('wk_pm',0,1,13.8),
  ('wk_pm',0,2,24.3),
  ('wk_pm',0,3,24.7),
  ('wk_pm',0,4,37.5),
  ('wk_pm',0,5,36.9),
  ('wk_pm',0,6,29.6),
  ('wk_pm',0,7,27),
  ('wk_pm',0,8,27.8),
  ('wk_pm',0,9,34.2),
  ('wk_pm',0,10,33.1),
  ('wk_pm',0,11,33.3),
  ('wk_pm',0,12,40),
  ('wk_pm',0,13,5.7),
  ('wk_pm',0,14,32.3),
  ('wk_pm',0,15,39.1),
  ('wk_pm',0,16,40.1),
  ('wk_pm',0,17,23.3),
  ('wk_pm',0,18,29.5),
  ('wk_pm',1,0,12.5),
  ('wk_pm',1,1,0),
  ('wk_pm',1,2,15.4),
  ('wk_pm',1,3,27.5),
  ('wk_pm',1,4,29.1),
  ('wk_pm',1,5,34),
  ('wk_pm',1,6,20.2),
  ('wk_pm',1,7,17.1),
  ('wk_pm',1,8,17.9),
  ('wk_pm',1,9,24.4),
  ('wk_pm',1,10,23.3),
  ('wk_pm',1,11,23.7),
  ('wk_pm',1,12,30.3),
  ('wk_pm',1,13,15.3),
  ('wk_pm',1,14,22.9),
  ('wk_pm',1,15,31.6),
  ('wk_pm',1,16,30.4),
  ('wk_pm',1,17,13.5),
  ('wk_pm',1,18,19.8),
  ('wk_pm',2,0,21.5),
  ('wk_pm',2,1,14.2),
  ('wk_pm',2,2,0),
  ('wk_pm',2,3,16.2),
  ('wk_pm',2,4,18.5),
  ('wk_pm',2,5,23),
  ('wk_pm',2,6,28.2),
  ('wk_pm',2,7,26),
  ('wk_pm',2,8,26.8),
  ('wk_pm',2,9,33.3),
  ('wk_pm',2,10,32.1),
  ('wk_pm',2,11,32.4),
  ('wk_pm',2,12,39.1),
  ('wk_pm',2,13,23.5),
  ('wk_pm',2,14,31.3),
  ('wk_pm',2,15,40.2),
  ('wk_pm',2,16,39.2),
  ('wk_pm',2,17,22.3),
  ('wk_pm',2,18,28.6),
  ('wk_pm',3,0,19.3),
  ('wk_pm',3,1,25.1),
  ('wk_pm',3,2,15),
  ('wk_pm',3,3,0),
  ('wk_pm',3,4,23.9),
  ('wk_pm',3,5,20.5),
  ('wk_pm',3,6,41.2),
  ('wk_pm',3,7,38.3),
  ('wk_pm',3,8,39.4),
  ('wk_pm',3,9,45.9),
  ('wk_pm',3,10,44.8),
  ('wk_pm',3,11,44.9),
  ('wk_pm',3,12,44.7),
  ('wk_pm',3,13,20.7),
  ('wk_pm',3,14,31.6),
  ('wk_pm',3,15,36.4),
  ('wk_pm',3,16,40.3),
  ('wk_pm',3,17,35.1),
  ('wk_pm',3,18,41.2),
  ('wk_pm',4,0,38.6),
  ('wk_pm',4,1,29);
insert into public.traffic_times (bucket, from_i, to_i, minutes) values
  ('wk_pm',4,2,21.6),
  ('wk_pm',4,3,24.9),
  ('wk_pm',4,4,0),
  ('wk_pm',4,5,19.4),
  ('wk_pm',4,6,36.6),
  ('wk_pm',4,7,33.7),
  ('wk_pm',4,8,34.6),
  ('wk_pm',4,9,41),
  ('wk_pm',4,10,39.9),
  ('wk_pm',4,11,40.1),
  ('wk_pm',4,12,46.5),
  ('wk_pm',4,13,36.6),
  ('wk_pm',4,14,39.2),
  ('wk_pm',4,15,47.3),
  ('wk_pm',4,16,46.6),
  ('wk_pm',4,17,30.2),
  ('wk_pm',4,18,36.3),
  ('wk_pm',5,0,38.6),
  ('wk_pm',5,1,38.3),
  ('wk_pm',5,2,25.4),
  ('wk_pm',5,3,21.3),
  ('wk_pm',5,4,17.7),
  ('wk_pm',5,5,0),
  ('wk_pm',5,6,51.6),
  ('wk_pm',5,7,48.8),
  ('wk_pm',5,8,50.1),
  ('wk_pm',5,9,56.4),
  ('wk_pm',5,10,55),
  ('wk_pm',5,11,45.9),
  ('wk_pm',5,12,44.6),
  ('wk_pm',5,13,31.4),
  ('wk_pm',5,14,35.7),
  ('wk_pm',5,15,36.3),
  ('wk_pm',5,16,40.2),
  ('wk_pm',5,17,45.7),
  ('wk_pm',5,18,49.8),
  ('wk_pm',6,0,28.4),
  ('wk_pm',6,1,18.4),
  ('wk_pm',6,2,30.8),
  ('wk_pm',6,3,46.2),
  ('wk_pm',6,4,33.6),
  ('wk_pm',6,5,51.8),
  ('wk_pm',6,6,0),
  ('wk_pm',6,7,17.9),
  ('wk_pm',6,8,18.7),
  ('wk_pm',6,9,25.1),
  ('wk_pm',6,10,24.1),
  ('wk_pm',6,11,24.4),
  ('wk_pm',6,12,31.1),
  ('wk_pm',6,13,26.4),
  ('wk_pm',6,14,23.2),
  ('wk_pm',6,15,32.3),
  ('wk_pm',6,16,31.1),
  ('wk_pm',6,17,14.2),
  ('wk_pm',6,18,20.5),
  ('wk_pm',7,0,26.8),
  ('wk_pm',7,1,19.8),
  ('wk_pm',7,2,32),
  ('wk_pm',7,3,47.5),
  ('wk_pm',7,4,35.1),
  ('wk_pm',7,5,43.2),
  ('wk_pm',7,6,21),
  ('wk_pm',7,7,0),
  ('wk_pm',7,8,9.1),
  ('wk_pm',7,9,13),
  ('wk_pm',7,10,17.6),
  ('wk_pm',7,11,19.9),
  ('wk_pm',7,12,26.6),
  ('wk_pm',7,13,21.9),
  ('wk_pm',7,14,16.4),
  ('wk_pm',7,15,22.3),
  ('wk_pm',7,16,26.8),
  ('wk_pm',7,17,8.6),
  ('wk_pm',7,18,12.7),
  ('wk_pm',8,0,31.1),
  ('wk_pm',8,1,21.9),
  ('wk_pm',8,2,34.2),
  ('wk_pm',8,3,49.6),
  ('wk_pm',8,4,37.1),
  ('wk_pm',8,5,47.3),
  ('wk_pm',8,6,24.1),
  ('wk_pm',8,7,11.6),
  ('wk_pm',8,8,0),
  ('wk_pm',8,9,11.2),
  ('wk_pm',8,10,11.7),
  ('wk_pm',8,11,16),
  ('wk_pm',8,12,23.4),
  ('wk_pm',8,13,26.2),
  ('wk_pm',8,14,19.9),
  ('wk_pm',8,15,23.6),
  ('wk_pm',8,16,23.8),
  ('wk_pm',8,17,11.3),
  ('wk_pm',8,18,8.8),
  ('wk_pm',9,0,38.5),
  ('wk_pm',9,1,28.9),
  ('wk_pm',9,2,41.2),
  ('wk_pm',9,3,57.3),
  ('wk_pm',9,4,44),
  ('wk_pm',9,5,53.7),
  ('wk_pm',9,6,29),
  ('wk_pm',9,7,16.8),
  ('wk_pm',9,8,11.4),
  ('wk_pm',9,9,0),
  ('wk_pm',9,10,16.4),
  ('wk_pm',9,11,20.9),
  ('wk_pm',9,12,29.4),
  ('wk_pm',9,13,33.7),
  ('wk_pm',9,14,27.9),
  ('wk_pm',9,15,31),
  ('wk_pm',9,16,28.7),
  ('wk_pm',9,17,18.5),
  ('wk_pm',9,18,15.2),
  ('wk_pm',10,0,42.2),
  ('wk_pm',10,1,33.6),
  ('wk_pm',10,2,45.7),
  ('wk_pm',10,3,62),
  ('wk_pm',10,4,48.7),
  ('wk_pm',10,5,59.3),
  ('wk_pm',10,6,36),
  ('wk_pm',10,7,28.6),
  ('wk_pm',10,8,24.5),
  ('wk_pm',10,9,19.9),
  ('wk_pm',10,10,0),
  ('wk_pm',10,11,8.9),
  ('wk_pm',10,12,15.3),
  ('wk_pm',10,13,37.4),
  ('wk_pm',10,14,32.4),
  ('wk_pm',10,15,25.3),
  ('wk_pm',10,16,19.3),
  ('wk_pm',10,17,23.4),
  ('wk_pm',10,18,14.1),
  ('wk_pm',11,0,43.2),
  ('wk_pm',11,1,33.1),
  ('wk_pm',11,2,45.3),
  ('wk_pm',11,3,54),
  ('wk_pm',11,4,48.2),
  ('wk_pm',11,5,51.7),
  ('wk_pm',11,6,35.5),
  ('wk_pm',11,7,26.1),
  ('wk_pm',11,8,18.2),
  ('wk_pm',11,9,24.5),
  ('wk_pm',11,10,10),
  ('wk_pm',11,11,0),
  ('wk_pm',11,12,8.8),
  ('wk_pm',11,13,38.4),
  ('wk_pm',11,14,30.1),
  ('wk_pm',11,15,16.3),
  ('wk_pm',11,16,10.3),
  ('wk_pm',11,17,23),
  ('wk_pm',11,18,10.9),
  ('wk_pm',12,0,41.4),
  ('wk_pm',12,1,38.1),
  ('wk_pm',12,2,50.2),
  ('wk_pm',12,3,50.1),
  ('wk_pm',12,4,52.7),
  ('wk_pm',12,5,48.3),
  ('wk_pm',12,6,38),
  ('wk_pm',12,7,33),
  ('wk_pm',12,8,24.8),
  ('wk_pm',12,9,31.2),
  ('wk_pm',12,10,15.1),
  ('wk_pm',12,11,7.5),
  ('wk_pm',12,12,0),
  ('wk_pm',12,13,36.7),
  ('wk_pm',12,14,28.3),
  ('wk_pm',12,15,13.7),
  ('wk_pm',12,16,7.8),
  ('wk_pm',12,17,25.4),
  ('wk_pm',12,18,17.5),
  ('wk_pm',13,0,6.6),
  ('wk_pm',13,1,14.3),
  ('wk_pm',13,2,29.1),
  ('wk_pm',13,3,27.4),
  ('wk_pm',13,4,36.1),
  ('wk_pm',13,5,33.1),
  ('wk_pm',13,6,28.3),
  ('wk_pm',13,7,25.7),
  ('wk_pm',13,8,26.5),
  ('wk_pm',13,9,32.9),
  ('wk_pm',13,10,31.8),
  ('wk_pm',13,11,32.1),
  ('wk_pm',13,12,38.8),
  ('wk_pm',13,13,0),
  ('wk_pm',13,14,30.9),
  ('wk_pm',13,15,35.1),
  ('wk_pm',13,16,38.8),
  ('wk_pm',13,17,21.9),
  ('wk_pm',13,18,28.1),
  ('wk_pm',14,0,24.5),
  ('wk_pm',14,1,24.7),
  ('wk_pm',14,2,37),
  ('wk_pm',14,3,42.3),
  ('wk_pm',14,4,39.8),
  ('wk_pm',14,5,41.1),
  ('wk_pm',14,6,26.6),
  ('wk_pm',14,7,18.4),
  ('wk_pm',14,8,21.6),
  ('wk_pm',14,9,28),
  ('wk_pm',14,10,26.2),
  ('wk_pm',14,11,26.5),
  ('wk_pm',14,12,33.3),
  ('wk_pm',14,13,19.6),
  ('wk_pm',14,14,0),
  ('wk_pm',14,15,24.6),
  ('wk_pm',14,16,30.1),
  ('wk_pm',14,17,18.5),
  ('wk_pm',14,18,22.7),
  ('wk_pm',15,0,31.7),
  ('wk_pm',15,1,34.5),
  ('wk_pm',15,2,46.6),
  ('wk_pm',15,3,39.6),
  ('wk_pm',15,4,47.8),
  ('wk_pm',15,5,38.3),
  ('wk_pm',15,6,36.9),
  ('wk_pm',15,7,27.4),
  ('wk_pm',15,8,25.4),
  ('wk_pm',15,9,31.8),
  ('wk_pm',15,10,21.6),
  ('wk_pm',15,11,15.1),
  ('wk_pm',15,12,14.8),
  ('wk_pm',15,13,26.8),
  ('wk_pm',15,14,17.9),
  ('wk_pm',15,15,0),
  ('wk_pm',15,16,9.9),
  ('wk_pm',15,17,24.3),
  ('wk_pm',15,18,17.4),
  ('wk_pm',16,0,38),
  ('wk_pm',16,1,33.6),
  ('wk_pm',16,2,45.7),
  ('wk_pm',16,3,45.9),
  ('wk_pm',16,4,48.7),
  ('wk_pm',16,5,44.6),
  ('wk_pm',16,6,36),
  ('wk_pm',16,7,28.5),
  ('wk_pm',16,8,23.9),
  ('wk_pm',16,9,30.2),
  ('wk_pm',16,10,18.4),
  ('wk_pm',16,11,9.5),
  ('wk_pm',16,12,9.6),
  ('wk_pm',16,13,33.1),
  ('wk_pm',16,14,24.3),
  ('wk_pm',16,15,9.8),
  ('wk_pm',16,16,0),
  ('wk_pm',16,17,23.4),
  ('wk_pm',16,18,16.6),
  ('wk_pm',17,0,19.1),
  ('wk_pm',17,1,13.5),
  ('wk_pm',17,2,26.1),
  ('wk_pm',17,3,37.2),
  ('wk_pm',17,4,29.1),
  ('wk_pm',17,5,36.2),
  ('wk_pm',17,6,15.6),
  ('wk_pm',17,7,7),
  ('wk_pm',17,8,9.5),
  ('wk_pm',17,9,16),
  ('wk_pm',17,10,14.8),
  ('wk_pm',17,11,15.3),
  ('wk_pm',17,12,21.8),
  ('wk_pm',17,13,14.1),
  ('wk_pm',17,14,9.1),
  ('wk_pm',17,15,20.3),
  ('wk_pm',17,16,22),
  ('wk_pm',17,17,0),
  ('wk_pm',17,18,11.4),
  ('wk_pm',18,0,34.4),
  ('wk_pm',18,1,25.1),
  ('wk_pm',18,2,37.4),
  ('wk_pm',18,3,53.6),
  ('wk_pm',18,4,40.1),
  ('wk_pm',18,5,49.9),
  ('wk_pm',18,6,27),
  ('wk_pm',18,7,14.9),
  ('wk_pm',18,8,6.8),
  ('wk_pm',18,9,13.3),
  ('wk_pm',18,10,8.9),
  ('wk_pm',18,11,12.8),
  ('wk_pm',18,12,21.2),
  ('wk_pm',18,13,29.5),
  ('wk_pm',18,14,23.2),
  ('wk_pm',18,15,22.7),
  ('wk_pm',18,16,20.6),
  ('wk_pm',18,17,14.4),
  ('wk_pm',18,18,0),
  ('off',0,0,0),
  ('off',0,1,10.5),
  ('off',0,2,18.1),
  ('off',0,3,17),
  ('off',0,4,28.9),
  ('off',0,5,32.4),
  ('off',0,6,23.1),
  ('off',0,7,22.3),
  ('off',0,8,23.4),
  ('off',0,9,30.1),
  ('off',0,10,28.3),
  ('off',0,11,28.7),
  ('off',0,12,33.7),
  ('off',0,13,5.7),
  ('off',0,14,27.9),
  ('off',0,15,30.8),
  ('off',0,16,33.1),
  ('off',0,17,19.8),
  ('off',0,18,25.1),
  ('off',1,0,10.8),
  ('off',1,1,0),
  ('off',1,2,10.7),
  ('off',1,3,19.9),
  ('off',1,4,21.6),
  ('off',1,5,26.7),
  ('off',1,6,16.6),
  ('off',1,7,15.9),
  ('off',1,8,16.9),
  ('off',1,9,23.6),
  ('off',1,10,21.9),
  ('off',1,11,22.1),
  ('off',1,12,27.1),
  ('off',1,13,12.7),
  ('off',1,14,21.4),
  ('off',1,15,26.9),
  ('off',1,16,26.5),
  ('off',1,17,13.3),
  ('off',1,18,18.6),
  ('off',2,0,18.3),
  ('off',2,1,12.7),
  ('off',2,2,0),
  ('off',2,3,14),
  ('off',2,4,16.5),
  ('off',2,5,19.9),
  ('off',2,6,24),
  ('off',2,7,23.5),
  ('off',2,8,24.5),
  ('off',2,9,31.2),
  ('off',2,10,29.4),
  ('off',2,11,29.7),
  ('off',2,12,34.8),
  ('off',2,13,19.9),
  ('off',2,14,29.5),
  ('off',2,15,34.5),
  ('off',2,16,34.3),
  ('off',2,17,20.8),
  ('off',2,18,26.2),
  ('off',3,0,17.3),
  ('off',3,1,20.3),
  ('off',3,2,13.1),
  ('off',3,3,0),
  ('off',3,4,19.4),
  ('off',3,5,19.4),
  ('off',3,6,34.6),
  ('off',3,7,33.8),
  ('off',3,8,34.9),
  ('off',3,9,41.5),
  ('off',3,10,38.7),
  ('off',3,11,38.2),
  ('off',3,12,36.4),
  ('off',3,13,17.9),
  ('off',3,14,28.8),
  ('off',3,15,28.8),
  ('off',3,16,32.4),
  ('off',3,17,31.3),
  ('off',3,18,36.5),
  ('off',4,0,29.2),
  ('off',4,1,20.3),
  ('off',4,2,16),
  ('off',4,3,16.8),
  ('off',4,4,0),
  ('off',4,5,15.9),
  ('off',4,6,27.6),
  ('off',4,7,26.8),
  ('off',4,8,27.8),
  ('off',4,9,34.5),
  ('off',4,10,33),
  ('off',4,11,33.1),
  ('off',4,12,38.1),
  ('off',4,13,28.7),
  ('off',4,14,33.5),
  ('off',4,15,33.4),
  ('off',4,16,37.5),
  ('off',4,17,24.3),
  ('off',4,18,29.5),
  ('off',5,0,32.8),
  ('off',5,1,29.9),
  ('off',5,2,19.2),
  ('off',5,3,17.5),
  ('off',5,4,15.1),
  ('off',5,5,0),
  ('off',5,6,41.6),
  ('off',5,7,40.9),
  ('off',5,8,42),
  ('off',5,9,48.6),
  ('off',5,10,42.6),
  ('off',5,11,37.1),
  ('off',5,12,35.2),
  ('off',5,13,25.7),
  ('off',5,14,27.6),
  ('off',5,15,27.6),
  ('off',5,16,31.2),
  ('off',5,17,38.4),
  ('off',5,18,38.3),
  ('off',6,0,23.7),
  ('off',6,1,14.3),
  ('off',6,2,23.6);
insert into public.traffic_times (bucket, from_i, to_i, minutes) values
  ('off',6,3,34.3),
  ('off',6,4,27.4),
  ('off',6,5,41.5),
  ('off',6,6,0),
  ('off',6,7,16.1),
  ('off',6,8,17.1),
  ('off',6,9,23.8),
  ('off',6,10,22.1),
  ('off',6,11,22.4),
  ('off',6,12,27.3),
  ('off',6,13,22.8),
  ('off',6,14,21.6),
  ('off',6,15,27.1),
  ('off',6,16,26.7),
  ('off',6,17,13.5),
  ('off',6,18,18.9),
  ('off',7,0,22.9),
  ('off',7,1,15.5),
  ('off',7,2,24.8),
  ('off',7,3,34.8),
  ('off',7,4,28.6),
  ('off',7,5,34),
  ('off',7,6,18.1),
  ('off',7,7,0),
  ('off',7,8,8.6),
  ('off',7,9,12.4),
  ('off',7,10,16.6),
  ('off',7,11,17.7),
  ('off',7,12,22.6),
  ('off',7,13,18.4),
  ('off',7,14,15),
  ('off',7,15,19.5),
  ('off',7,16,22.1),
  ('off',7,17,7.7),
  ('off',7,18,12.3),
  ('off',8,0,24.2),
  ('off',8,1,14.6),
  ('off',8,2,24),
  ('off',8,3,34.7),
  ('off',8,4,27.8),
  ('off',8,5,35.3),
  ('off',8,6,17.2),
  ('off',8,7,9.1),
  ('off',8,8,0),
  ('off',8,9,10.3),
  ('off',8,10,10.6),
  ('off',8,11,13.9),
  ('off',8,12,18.8),
  ('off',8,13,19.7),
  ('off',8,14,15.8),
  ('off',8,15,19.1),
  ('off',8,16,18.9),
  ('off',8,17,7.7),
  ('off',8,18,8.2),
  ('off',9,0,31.3),
  ('off',9,1,21.5),
  ('off',9,2,30.8),
  ('off',9,3,41.7),
  ('off',9,4,34.7),
  ('off',9,5,42.3),
  ('off',9,6,24.1),
  ('off',9,7,14.3),
  ('off',9,8,10.3),
  ('off',9,9,0),
  ('off',9,10,15.4),
  ('off',9,11,19.1),
  ('off',9,12,25.7),
  ('off',9,13,26.6),
  ('off',9,14,22.7),
  ('off',9,15,25.6),
  ('off',9,16,24.1),
  ('off',9,17,14.6),
  ('off',9,18,14.5),
  ('off',10,0,29.1),
  ('off',10,1,19.7),
  ('off',10,2,29),
  ('off',10,3,39.9),
  ('off',10,4,32.8),
  ('off',10,5,43.3),
  ('off',10,6,22.2),
  ('off',10,7,17.8),
  ('off',10,8,14.6),
  ('off',10,9,17.6),
  ('off',10,10,0),
  ('off',10,11,7.7),
  ('off',10,12,12.3),
  ('off',10,13,25.6),
  ('off',10,14,21.2),
  ('off',10,15,18.2),
  ('off',10,16,14.9),
  ('off',10,17,12.8),
  ('off',10,18,10.5),
  ('off',11,0,28),
  ('off',11,1,18.6),
  ('off',11,2,27.9),
  ('off',11,3,37.5),
  ('off',11,4,31.9),
  ('off',11,5,36.2),
  ('off',11,6,21.2),
  ('off',11,7,16.8),
  ('off',11,8,13.3),
  ('off',11,9,20.6),
  ('off',11,10,7.5),
  ('off',11,11,0),
  ('off',11,12,7.1),
  ('off',11,13,25.9),
  ('off',11,14,19.8),
  ('off',11,15,13.1),
  ('off',11,16,7.8),
  ('off',11,17,11.8),
  ('off',11,18,8.2),
  ('off',12,0,32),
  ('off',12,1,23.1),
  ('off',12,2,32.3),
  ('off',12,3,35.4),
  ('off',12,4,36.3),
  ('off',12,5,34.1),
  ('off',12,6,25.7),
  ('off',12,7,21.2),
  ('off',12,8,18),
  ('off',12,9,24.7),
  ('off',12,10,11.9),
  ('off',12,11,7),
  ('off',12,12,0),
  ('off',12,13,27.3),
  ('off',12,14,22.6),
  ('off',12,15,13),
  ('off',12,16,7.7),
  ('off',12,17,16.2),
  ('off',12,18,14),
  ('off',13,0,6.6),
  ('off',13,1,11.5),
  ('off',13,2,19.8),
  ('off',13,3,17.9),
  ('off',13,4,27.5),
  ('off',13,5,25.1),
  ('off',13,6,22.4),
  ('off',13,7,21.6),
  ('off',13,8,22.7),
  ('off',13,9,29.4),
  ('off',13,10,27.6),
  ('off',13,11,27.9),
  ('off',13,12,33),
  ('off',13,13,0),
  ('off',13,14,27.2),
  ('off',13,15,26.7),
  ('off',13,16,32.2),
  ('off',13,17,19.1),
  ('off',13,18,24.4),
  ('off',14,0,18.4),
  ('off',14,1,14.9),
  ('off',14,2,24.3),
  ('off',14,3,30.3),
  ('off',14,4,28.1),
  ('off',14,5,29.5),
  ('off',14,6,17.5),
  ('off',14,7,11.9),
  ('off',14,8,14.5),
  ('off',14,9,21.1),
  ('off',14,10,19.1),
  ('off',14,11,19.3),
  ('off',14,12,24.3),
  ('off',14,13,13.8),
  ('off',14,14,0),
  ('off',14,15,18.2),
  ('off',14,16,23.9),
  ('off',14,17,11.8),
  ('off',14,18,15.9),
  ('off',15,0,24.1),
  ('off',15,1,23),
  ('off',15,2,32.3),
  ('off',15,3,29.7),
  ('off',15,4,35.7),
  ('off',15,5,28.6),
  ('off',15,6,25.7),
  ('off',15,7,17.7),
  ('off',15,8,18.5),
  ('off',15,9,25.4),
  ('off',15,10,17.9),
  ('off',15,11,13.4),
  ('off',15,12,14),
  ('off',15,13,19.6),
  ('off',15,14,15.6),
  ('off',15,15,0),
  ('off',15,16,8.7),
  ('off',15,17,16.2),
  ('off',15,18,13.9),
  ('off',16,0,29.2),
  ('off',16,1,21.6),
  ('off',16,2,30.6),
  ('off',16,3,31.8),
  ('off',16,4,34.8),
  ('off',16,5,30.7),
  ('off',16,6,24.2),
  ('off',16,7,19.7),
  ('off',16,8,16.5),
  ('off',16,9,23.2),
  ('off',16,10,14.2),
  ('off',16,11,8),
  ('off',16,12,8.7),
  ('off',16,13,24.4),
  ('off',16,14,19.2),
  ('off',16,15,9),
  ('off',16,16,0),
  ('off',16,17,14.7),
  ('off',16,18,12.4),
  ('off',17,0,17.4),
  ('off',17,1,9.7),
  ('off',17,2,19.1),
  ('off',17,3,29.4),
  ('off',17,4,22.7),
  ('off',17,5,28.5),
  ('off',17,6,12.7),
  ('off',17,7,6.4),
  ('off',17,8,10.5),
  ('off',17,9,17.1),
  ('off',17,10,13.9),
  ('off',17,11,14.1),
  ('off',17,12,19),
  ('off',17,13,12.9),
  ('off',17,14,8.1),
  ('off',17,15,16.9),
  ('off',17,16,18.5),
  ('off',17,17,0),
  ('off',17,18,10.7),
  ('off',18,0,26.7),
  ('off',18,1,16.8),
  ('off',18,2,26.1),
  ('off',18,3,36.9),
  ('off',18,4,29.9),
  ('off',18,5,37.6),
  ('off',18,6,19.4),
  ('off',18,7,11.4),
  ('off',18,8,5.2),
  ('off',18,9,12.5),
  ('off',18,10,8.4),
  ('off',18,11,11.1),
  ('off',18,12,17.4),
  ('off',18,13,21.9),
  ('off',18,14,18),
  ('off',18,15,17.7),
  ('off',18,16,16.1),
  ('off',18,17,10),
  ('off',18,18,0);

-- ---------- 2. Route maths (the same as the app's matching engine in prototype/matching.js) ----------
do $$ begin
  create type public.route_stop as (lat double precision, lng double precision, kind text, rid uuid, rf integer, rt integer);
exception when duplicate_object then null; end $$;

create or replace function public._hav_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(least(1, power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))));
$$;
create or replace function public._road_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$ select public._hav_km(a_lat, a_lng, b_lat, b_lng) * 1.35; $$;
create or replace function public._guess_min(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$ select public._road_km(a_lat, a_lng, b_lat, b_lng) / 40 * 60; $$;

create or replace function public._bucket(at_min double precision, dow integer) returns text language plpgsql immutable as $$
declare m double precision;
begin
  if dow in (0, 6) then return 'off'; end if;
  m := at_min - 1440 * floor(at_min / 1440);
  if m >= 330 and m < 600 then return 'wk_am'; end if;
  if m >= 600 and m < 900 then return 'wk_mid'; end if;
  if m >= 900 and m < 1140 then return 'wk_pm'; end if;
  return 'off';
end $$;

create or replace function public._centre_idx(p_lat double precision, p_lng double precision) returns integer language sql stable as $$
  select i from public.traffic_centres where round(lat::numeric, 4) = round(p_lat::numeric, 4) and round(lng::numeric, 4) = round(p_lng::numeric, 4) limit 1;
$$;

-- Minutes to drive from a to b: the saved Google time for that time of day; for a point that is not a neighbourhood centre,
-- the straight-line estimate scaled by how much slower or faster Google says the trip between the two nearest centres is.
create or replace function public._minutes(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision, at_min double precision, dow integer)
returns double precision language plpgsql stable as $$
declare bk text; i integer; j integer; v double precision; sa record; sb record; g double precision;
begin
  bk := public._bucket(at_min, dow);
  i := public._centre_idx(a_lat, a_lng); j := public._centre_idx(b_lat, b_lng);
  if i is not null and j is not null then
    select minutes into v from public.traffic_times where bucket = bk and from_i = i and to_i = j;
    if v is not null then return v; end if;
  else
    select c.i, c.lat, c.lng into sa from public.traffic_centres c order by public._hav_km(a_lat, a_lng, c.lat, c.lng) limit 1;
    select c.i, c.lat, c.lng into sb from public.traffic_centres c order by public._hav_km(b_lat, b_lng, c.lat, c.lng) limit 1;
    if sa.i is not null and sb.i is not null and sa.i <> sb.i then
      select minutes into v from public.traffic_times where bucket = bk and from_i = sa.i and to_i = sb.i;
      g := public._guess_min(sa.lat, sa.lng, sb.lat, sb.lng);
      if v is not null and g > 2 then return public._guess_min(a_lat, a_lng, b_lat, b_lng) * least(3, greatest(0.5, v / g)); end if;
    end if;
  end if;
  return public._guess_min(a_lat, a_lng, b_lat, b_lng);
end $$;

create or replace function public._route_km(p_stops public.route_stop[]) returns double precision language plpgsql immutable as $$
declare i integer; s double precision := 0; a public.route_stop; b public.route_stop;
begin
  for i in 2 .. coalesce(array_length(p_stops, 1), 0) loop
    a := p_stops[i - 1]; b := p_stops[i];
    s := s + public._road_km(a.lat, a.lng, b.lat, b.lng);
  end loop;
  return s;
end $$;

create or replace function public._evaluate(p_stops public.route_stop[], p_depart double precision, p_wait double precision, p_dow integer, out ok boolean, out total_min double precision)
language plpgsql stable as $$
declare t double precision := p_depart; i integer; w double precision; s public.route_stop; prev public.route_stop;
begin
  ok := true;
  for i in 1 .. coalesce(array_length(p_stops, 1), 0) loop
    s := p_stops[i];
    if i > 1 then prev := p_stops[i - 1]; t := t + public._minutes(prev.lat, prev.lng, s.lat, s.lng, t, p_dow); end if;
    w := 0;
    if s.kind = 'pickup' then
      w := greatest(0, s.rf - t);
      if t > s.rt then ok := false; end if;
      if w > p_wait then ok := false; end if;
      t := t + w;
    end if;
  end loop;
  total_min := t - p_depart;
end $$;

-- Cheapest feasible way to add a rider's pickup and drop-off to a route (relaxed = a rider who is already booked stays on the route).
create or replace function public._best_insertion(p_stops public.route_stop[], p_pick public.route_stop, p_drop public.route_stop, p_depart double precision, p_wait double precision, p_dow integer,
  p_direct_min double precision, p_direct_km double precision, p_cap_min double precision, p_cap_km double precision, p_relaxed boolean)
returns table (stops public.route_stop[], total_min double precision, detour double precision, detour_km double precision)
language plpgsql stable as $$
declare L integer := array_length(p_stops, 1); i integer; j integer; nxt public.route_stop[]; ev record; d double precision; dk double precision; best double precision := null;
begin
  for i in 1 .. L - 1 loop
    for j in i .. L - 1 loop
      nxt := p_stops[1:j] || p_drop || p_stops[j + 1:L];
      nxt := nxt[1:i] || p_pick || nxt[i + 1:L + 1];
      select * into ev from public._evaluate(nxt, p_depart, p_wait, p_dow);
      d := ev.total_min - p_direct_min; dk := public._route_km(nxt) - p_direct_km;
      if (p_relaxed or (ev.ok and d <= p_cap_min + 1e-9 and (p_cap_km is null or dk <= p_cap_km + 1e-9))) and (best is null or d < best) then
        best := d; stops := nxt; total_min := ev.total_min; detour := d; detour_km := dk;
      end if;
    end loop;
  end loop;
  if best is not null then return next; end if;
end $$;

-- ---------- 3. Live traffic from Google, with a usage cap ----------
create table if not exists public.app_limits (key text primary key, value double precision not null);
insert into public.app_limits (key, value) values ('route_calls_per_day', 150), ('route_calls_per_month', 4000) on conflict (key) do nothing;
create table if not exists public.route_usage (day date primary key, calls integer not null default 0);
create table if not exists public.route_cache (sig text primary key, result jsonb not null, at timestamptz not null default now());
alter table public.app_limits enable row level security; alter table public.route_usage enable row level security; alter table public.route_cache enable row level security;
revoke all on public.app_limits, public.route_usage, public.route_cache from anon, authenticated;

-- Live lookups stay under Google's free monthly allowance (5,000). The limits are rows in app_limits.
create or replace function public._route_budget_ok() returns boolean language plpgsql stable security definer set search_path = public as $$
declare d double precision; m double precision; today date := (now() at time zone 'America/Vancouver')::date;
begin
  select value into d from public.app_limits where key = 'route_calls_per_day';
  select value into m from public.app_limits where key = 'route_calls_per_month';
  if coalesce((select calls from public.route_usage where day = today), 0) >= coalesce(d, 150) then return false; end if;
  if coalesce((select sum(calls) from public.route_usage where day >= date_trunc('month', today)::date), 0) >= coalesce(m, 4000) then return false; end if;
  return true;
end $$;

-- One small web call to Google. Written with EXECUTE so this file also installs where the http extension is not available.
do $$ begin
  create extension if not exists http with schema extensions;
exception when others then raise notice 'The http extension is not available: live traffic stays off and the saved drive times are used.';
end $$;
create or replace function public._http_post_json(p_url text, p_key text, p_mask text, p_body text) returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  execute 'select content from extensions.http((''POST'', $1, array[extensions.http_header(''X-Goog-Api-Key'', $2), extensions.http_header(''X-Goog-FieldMask'', $3)], ''application/json'', $4)::extensions.http_request)'
    into r using p_url, p_key, p_mask, p_body;
  return r;
exception when others then return null;
end $$;
revoke all on function public._http_post_json(text, text, text, text) from public, anon, authenticated;

-- Drive time and distance for a list of stops with live traffic, or null when live traffic is off, over the cap, or Google does not answer.
create or replace function public._live_route(p_stops public.route_stop[], p_depart timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; sig text; c jsonb; n integer := coalesce(array_length(p_stops, 1), 0); i integer; body jsonb; mids jsonb := '[]'::jsonb; txt text; j jsonb; leg jsonb; legs jsonb := '[]'::jsonb;
        mins double precision := 0; kms double precision := 0; dep timestamptz; today date := (now() at time zone 'America/Vancouver')::date;
begin
  if n < 2 then return null; end if;
  begin select decrypted_secret into k from vault.decrypted_secrets where name = 'google_routes_key' limit 1; exception when others then k := null; end;
  if k is null or k = '' then return null; end if;
  dep := greatest(p_depart, now() + interval '30 seconds');
  if dep > now() + interval '6 days' then return null; end if;
  select string_agg(round(s.lat::numeric, 4) || ',' || round(s.lng::numeric, 4), ';') into sig from unnest(p_stops) s;
  sig := md5(sig || '@' || to_char(dep at time zone 'America/Vancouver', 'YYYY-MM-DD-HH24') || (extract(minute from dep at time zone 'America/Vancouver')::int / 15)::text);
  select result into c from public.route_cache where sig = _live_route.sig and at > now() - interval '15 minutes';
  if c is not null then return c; end if;
  if not public._route_budget_ok() then return null; end if;
  for i in 2 .. n - 1 loop
    mids := mids || jsonb_build_array(jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', p_stops[i].lat, 'longitude', p_stops[i].lng))));
  end loop;
  body := jsonb_build_object(
    'origin', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', p_stops[1].lat, 'longitude', p_stops[1].lng))),
    'destination', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', p_stops[n].lat, 'longitude', p_stops[n].lng))),
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
  insert into public.route_cache (sig, result, at) values (_live_route.sig, c, now()) on conflict (sig) do update set result = excluded.result, at = now();
  return c;
end $$;
revoke all on function public._live_route(public.route_stop[], timestamptz) from public, anon, authenticated;

-- ---------- 4. The quote: extra minutes, extra km, fit with the driver's limits, and the fair share of the cost for everyone ----------
alter table public.matches add column if not exists cash_cents integer, add column if not exists price_dollars numeric(8,2), add column if not exists quote_source text;

create or replace function public._quote_trip(p_trip uuid, p_date date, p_new uuid default null, p_live boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.trips; olat double precision; olng double precision; dlat double precision; dlng double precision; dow integer; depart double precision; vnow double precision;
  direct_min double precision; direct_km double precision; cap_min double precision; cap_km double precision;
  cur public.route_stop[]; nxt public.route_stop[]; base public.route_stop[]; rec record; pk public.route_stop; dp public.route_stop; b record; ev record;
  n_acc integer := 0; base_detour double precision; base_detour_km double precision; added_min double precision; added_km double precision; total_min double precision; total_km double precision;
  source text := 'tables'; dep_ts timestamptz; lD jsonb; l0 jsonb; l1 jsonb; legkm double precision[] := '{}'; i integer; aboard uuid[] := '{}'; seg double precision; share double precision;
  total_cost double precision := 0; driver_share double precision := 0; owed jsonb := '{}'::jsonb; shares jsonb := '[]'::jsonb; fin public.route_stop[]; prev public.route_stop; cur_s public.route_stop; new_dollars double precision;
begin
  select * into t from public.trips where id = p_trip;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'trip'); end if;
  select coalesce(t.origin_lat, a.lat), coalesce(t.origin_lng, a.lng) into olat, olng from public.areas a where a.name = t.origin;
  select coalesce(t.dest_lat, a.lat), coalesce(t.dest_lng, a.lng) into dlat, dlng from public.areas a where a.name = t.dest;
  olat := coalesce(t.origin_lat, olat); olng := coalesce(t.origin_lng, olng); dlat := coalesce(t.dest_lat, dlat); dlng := coalesce(t.dest_lng, dlng);
  if olat is null or dlat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
  dow := extract(dow from p_date)::int;
  vnow := extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver');
  depart := case when t.live then vnow + 2 else t.depart_min end;
  direct_min := public._minutes(olat, olng, dlat, dlng, depart, dow);
  direct_km := public._road_km(olat, olng, dlat, dlng);
  cap_min := case when t.max_total_detour is null then t.max_detour else greatest(t.max_total_detour, t.max_detour) end;
  cap_km := case when t.max_total_detour_km is null and t.max_detour_km is null then null else greatest(coalesce(t.max_total_detour_km, t.max_detour_km), coalesce(t.max_detour_km, 0)) end;
  base := array[(olat, olng, 'origin', null, 0, 0)::public.route_stop, (dlat, dlng, 'dest', null, 0, 0)::public.route_stop];
  cur := base;
  for rec in
    select r.id as rid, r.ready_from, r.ready_to,
           coalesce(m.meet_lat, r.pickup_lat, pa.lat) as plat, coalesce(m.meet_lng, r.pickup_lng, pa.lng) as plng,
           coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
      from public.matches m join public.ride_requests r on r.id = m.request_id
      left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff
     where m.trip_id = p_trip and m.ride_date = p_date and m.status = 'accepted' and m.dropped_off_at is null
     order by m.created_at, m.id
  loop
    n_acc := n_acc + 1;
    pk := (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop;
    dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
    select * into b from public._best_insertion(cur, pk, dp, depart, t.max_wait, dow, direct_min, direct_km, cap_min, cap_km, true);
    if b.stops is null then return jsonb_build_object('ok', false, 'reason', 'route'); end if;
    cur := b.stops;
  end loop;
  select * into ev from public._evaluate(cur, depart, t.max_wait, dow);
  base_detour := ev.total_min - direct_min; base_detour_km := public._route_km(cur) - direct_km;
  fin := cur; total_min := ev.total_min; total_km := public._route_km(cur); added_min := 0; added_km := 0;

  if p_new is not null then
    if n_acc >= coalesce(t.max_pickups, 3) then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
    select r.id as rid, r.ready_from, r.ready_to, coalesce(r.pickup_lat, pa.lat) as plat, coalesce(r.pickup_lng, pa.lng) as plng, coalesce(r.dropoff_lat, da.lat) as qlat, coalesce(r.dropoff_lng, da.lng) as qlng
      into rec from public.ride_requests r left join public.areas pa on pa.name = r.pickup left join public.areas da on da.name = r.dropoff where r.id = p_new;
    if rec.rid is null or rec.plat is null or rec.qlat is null then return jsonb_build_object('ok', false, 'reason', 'unknown_area'); end if;
    pk := (rec.plat, rec.plng, 'pickup', rec.rid, rec.ready_from, rec.ready_to)::public.route_stop;
    dp := (rec.qlat, rec.qlng, 'dropoff', rec.rid, 0, 0)::public.route_stop;
    select * into b from public._best_insertion(cur, pk, dp, depart, t.max_wait, dow, direct_min, direct_km, cap_min, cap_km, false);
    if b.stops is null then return jsonb_build_object('ok', false, 'reason', 'fit'); end if;
    added_min := b.detour - base_detour; added_km := b.detour_km - base_detour_km;
    if added_min > t.max_detour + 1e-9 then return jsonb_build_object('ok', false, 'reason', 'fit_one'); end if;
    if t.max_detour_km is not null and added_km > t.max_detour_km + 1e-9 then return jsonb_build_object('ok', false, 'reason', 'fit_one_km'); end if;
    fin := b.stops; total_min := b.total_min; total_km := public._route_km(fin);
  end if;

  -- live traffic for the real answer (when it is switched on and under the cap); the order of stops is the one chosen above
  if p_live then
    dep_ts := ((p_date::timestamp + (depart::text || ' minutes')::interval) at time zone 'America/Vancouver');
    lD := public._live_route(base, dep_ts);
    if lD is not null then
      l0 := case when n_acc = 0 then lD else public._live_route(cur, dep_ts) end;
      l1 := case when p_new is null then l0 else public._live_route(fin, dep_ts) end;
      if l0 is not null and l1 is not null then
        source := 'live';
        added_min := case when p_new is null then 0 else (l1->>'minutes')::double precision - (l0->>'minutes')::double precision end;
        added_km := case when p_new is null then 0 else (l1->>'km')::double precision - (l0->>'km')::double precision end;
        total_min := (l1->>'minutes')::double precision; total_km := (l1->>'km')::double precision;
        if p_new is not null then
          if added_min > t.max_detour + 1e-9 or (t.max_detour_km is not null and added_km > t.max_detour_km + 1e-9) then return jsonb_build_object('ok', false, 'reason', 'fit_one', 'source', 'live'); end if;
          if ((l1->>'minutes')::double precision - (lD->>'minutes')::double precision) > cap_min + 1e-9
             or (cap_km is not null and ((l1->>'km')::double precision - (lD->>'km')::double precision) > cap_km + 1e-9) then return jsonb_build_object('ok', false, 'reason', 'fit', 'source', 'live'); end if;
        end if;
        select array_agg(x::text::double precision order by ord) into legkm from jsonb_array_elements(l1->'legs') with ordinality as e(x, ord);
      end if;
    end if;
  end if;

  -- fair split: each stretch of road is shared equally by everyone in the car, the driver included
  for i in 2 .. array_length(fin, 1) loop
    prev := fin[i - 1]; cur_s := fin[i];
    if prev.kind = 'pickup' then aboard := aboard || prev.rid; end if;
    if prev.kind = 'dropoff' then aboard := array_remove(aboard, prev.rid); end if;
    seg := (case when source = 'live' then legkm[i - 1] else public._road_km(prev.lat, prev.lng, cur_s.lat, cur_s.lng) end) * t.cost_per_km;
    share := seg / (coalesce(array_length(aboard, 1), 0) + 1);
    total_cost := total_cost + seg; driver_share := driver_share + share;
    if coalesce(array_length(aboard, 1), 0) > 0 then
      for rec in select unnest(aboard) as rid loop
        owed := jsonb_set(owed, array[rec.rid::text], to_jsonb(coalesce((owed->>(rec.rid::text))::double precision, 0) + share));
      end loop;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('request_id', k, 'dollars', round(v::numeric, 4))), '[]'::jsonb) into shares from jsonb_each_text(owed) as e(k, v) where v is not null;
  new_dollars := case when p_new is null then null else coalesce((owed->>(p_new::text))::double precision, 0) end;
  return jsonb_build_object('ok', true, 'source', source, 'added_min', round(added_min::numeric, 2), 'added_km', round(added_km::numeric, 3),
    'total_min', round(total_min::numeric, 2), 'total_km', round(total_km::numeric, 3), 'shares', shares, 'total_cost', round(total_cost::numeric, 4),
    'driver_share', round(driver_share::numeric, 4), 'new_dollars', case when new_dollars is null then null else round(new_dollars::numeric, 4) end);
end $$;
revoke all on function public._quote_trip(uuid, date, uuid, boolean) from public, anon, authenticated;

-- ---------- 5. Asking for a seat: the rider sends only the trip, the request, how to pay and the date ----------
drop function if exists public.request_seat(uuid, uuid, text, integer, date, numeric, numeric);
drop function if exists public.request_seat(uuid, uuid, text, date);
create or replace function public.request_seat(p_trip uuid, p_request uuid, p_pay_with text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trips; r public.ride_requests; m uuid; q jsonb; pts integer; dollars double precision;
begin
  select * into t from public.trips where id = p_trip and active;
  select * into r from public.ride_requests where id = p_request and user_id = auth.uid() and active;
  if t.id is null or r.id is null then raise exception 'Trip or request not found'; end if;
  if t.expires_at is not null and t.expires_at < now() then raise exception 'That live trip has ended'; end if;
  if r.expires_at is not null and r.expires_at < now() then raise exception 'Your live request has ended'; end if;
  if t.user_id = auth.uid() then raise exception 'You cannot ride with yourself'; end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 31 then raise exception 'Pick a date within the next 30 days'; end if;
  if not public.occurs_on(p_date, t.trip_date, t.repeat_days) or not public.occurs_on(p_date, r.ride_date, r.repeat_days) then
    raise exception 'That trip or request does not run on that date';
  end if;
  if p_pay_with not in ('points', 'cash') then raise exception 'Bad payment type'; end if;
  if t.accepts <> 'either' and t.accepts <> p_pay_with then raise exception 'Driver does not accept that payment'; end if;
  q := public._quote_trip(p_trip, p_date, p_request, true);
  if not coalesce((q->>'ok')::boolean, false) then
    if q->>'reason' = 'full' then raise exception 'This trip has no seat left'; end if;
    if q->>'reason' = 'unknown_area' then raise exception 'Unknown area'; end if;
    raise exception 'This trip is outside the driver''s detour limits';
  end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := greatest(1, floor(dollars / 0.10 + 0.0001))::int;
  insert into public.matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date, detour_min, detour_km, cash_cents, price_dollars, quote_source)
    values (p_trip, p_request, t.user_id, auth.uid(), p_pay_with, case when p_pay_with = 'points' then pts else 0 end, p_date,
            (q->>'added_min')::numeric, (q->>'added_km')::numeric, floor(dollars * 100)::int, round(dollars::numeric, 2), q->>'source')
    returning id into m;
  return m;
end $$;
revoke all on function public.request_seat(uuid, uuid, text, date) from public, anon;
grant execute on function public.request_seat(uuid, uuid, text, date) to authenticated;

-- ---------- 6. Accepting a seat: re-checked with the whole route; riders already booked can only pay less ----------
create or replace function public._respond_match(p_driver uuid, p_match uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches; t public.trips; r public.ride_requests; bal integer; taken integer; q jsonb; dollars double precision; pts integer; a record; nd double precision; npts integer; diff integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.driver_id <> p_driver then raise exception 'Not your request'; end if;
  if m.status <> 'requested' then raise exception 'Already %', m.status; end if;
  if p_accept and m.ride_date < current_date - 1 then raise exception 'That ride date has passed'; end if;
  if not p_accept then
    update public.matches set status = 'declined' where id = p_match;
    return 'declined';
  end if;
  select * into t from public.trips where id = m.trip_id for update;
  if t.id is null or not t.active or (t.expires_at is not null and t.expires_at < now()) then raise exception 'This trip is no longer on'; end if;
  select * into r from public.ride_requests where id = m.request_id;
  if r.id is null or not r.active or (r.expires_at is not null and r.expires_at < now()) then raise exception 'This request is no longer active'; end if;
  if exists (select 1 from public.matches x where x.request_id = m.request_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id) then
    raise exception 'This rider already has a confirmed seat for that day';
  end if;
  select count(*) into taken from public.matches where trip_id = m.trip_id and ride_date = m.ride_date and status in ('accepted', 'completed') and id <> m.id;
  if taken >= coalesce(t.max_pickups, 3) then raise exception 'You already have % pickup(s) for this trip. Raise the limit on the trip to take more.', coalesce(t.max_pickups, 3); end if;
  -- the server works out the route and everyone's share again with the riders who are booked now
  q := public._quote_trip(m.trip_id, m.ride_date, m.request_id, true);
  if not coalesce((q->>'ok')::boolean, false) then raise exception 'This request no longer fits your detour limits'; end if;
  dollars := coalesce((q->>'new_dollars')::double precision, 0);
  pts := case when m.pay_with = 'points' then greatest(1, floor(dollars / 0.10 + 0.0001))::int else 0 end;
  update public.matches set points = pts, cash_cents = floor(dollars * 100)::int, price_dollars = round(dollars::numeric, 2),
    detour_min = (q->>'added_min')::numeric, detour_km = (q->>'added_km')::numeric, quote_source = q->>'source' where id = p_match;
  if m.pay_with = 'points' and pts > 0 then
    select points into bal from public.wallets where user_id = m.rider_id for update;
    if bal < pts then raise exception 'Rider does not have enough points'; end if;
    update public.wallets set points = points - pts where user_id = m.rider_id;
    insert into public.ledger (user_id, delta, reason, match_id) values (m.rider_id, -pts, 'Ride paid with points (held until the ride)', m.id);
  end if;
  -- riders who were already booked: their share can only go down; the difference goes back to them
  for a in select x.id, x.rider_id, x.request_id, x.pay_with, x.points, x.cash_cents from public.matches x
            where x.trip_id = m.trip_id and x.ride_date = m.ride_date and x.status = 'accepted' and x.id <> m.id order by x.created_at, x.id loop
    nd := coalesce((select (e->>'dollars')::double precision from jsonb_array_elements(q->'shares') e where e->>'request_id' = a.request_id::text limit 1), null);
    if nd is null then continue; end if;
    if a.pay_with = 'points' and a.points > 0 then
      npts := greatest(1, floor(nd / 0.10 + 0.0001))::int;
      if npts < a.points then
        diff := a.points - npts;
        update public.wallets set points = points + diff where user_id = a.rider_id;
        insert into public.ledger (user_id, delta, reason, match_id) values (a.rider_id, diff, 'Refund: your share went down because another rider joined', a.id);
        update public.matches set points = npts, price_dollars = round(nd::numeric, 2) where id = a.id;
      end if;
    elsif a.pay_with = 'cash' then
      update public.matches set cash_cents = least(coalesce(a.cash_cents, 2147483647), floor(nd * 100)::int), price_dollars = least(coalesce(price_dollars, 99999), round(nd::numeric, 2)) where id = a.id;
    end if;
  end loop;
  update public.matches set status = 'accepted' where id = p_match;
  return 'accepted';
end $$;
revoke all on function public._respond_match(uuid, uuid, boolean) from public, anon, authenticated;
