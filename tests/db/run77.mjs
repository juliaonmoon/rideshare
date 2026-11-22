import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const REPO = 'C:/Users/jules/rideshare_repo';
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users(instance_id uuid, id uuid primary key, aud text, role text, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create publication supabase_realtime; alter table auth.users add column last_sign_in_at timestamptz;
grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`);
for (const f of ['supabase/schema.sql', ...fs.readdirSync(REPO + '/supabase/migrations').sort().map((x) => 'supabase/migrations/' + x)]) {
  try { await db.exec(fs.readFileSync(`${REPO}/${f}`, 'utf8')); } catch (e) { console.log('FAIL load ' + f + ' :: ' + e.message); }
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function as(role, id, sql, params) {
  await db.exec("reset role; select set_config('app.uid','" + (id || '') + "',false); set role " + role + ";");
  try { const r = await db.query(sql, params); return { rows: r.rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role;'); }
}
const mk = async (id, em, nm) => { await db.query("insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,now(),'{}',$3,now(),now())", [id, em, JSON.stringify({ full_name: nm })]); };
const d = '11111111-1111-1111-1111-111111111111', r1 = '22222222-2222-2222-2222-222222222221', r2 = '22222222-2222-2222-2222-222222222222';
await mk(d, 'drv@example.com', 'Dee'); await mk(r1, 'r1@example.com', 'Rae'); await mk(r2, 'r2@example.com', 'Rob');
const res = []; const ok = (n, c, y) => { res.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (y ? ' :: ' + y : '')); };
const today = "(now() at time zone 'America/Vancouver')::date";
await q("insert into profile_cards (user_id, photo, car_plate) values ($1,'https://x.example/p.jpg','ABC123'), ($2,'https://x.example/r.jpg',null), ($3,'https://x.example/r2.jpg',null)", [d, r1, r2]);
await db.exec("create schema if not exists vault; create table if not exists vault.decrypted_secrets (name text, decrypted_secret text); delete from vault.decrypted_secrets;");
const vnow = Number((await q("select floor(extract(hour from now() at time zone 'America/Vancouver') * 60 + extract(minute from now() at time zone 'America/Vancouver')) v"))[0].v);
console.log('minute of day in Vancouver: ' + vnow);

await q("insert into wallets (user_id, points) values ($1, 100), ($2, 100) on conflict (user_id) do update set points = 100", [r1, d]);
const tid = (await q("insert into trips (user_id, origin, dest, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',480,60,90,0,'either', current_date + 30, 3, 0.2) returning id", [d]))[0].id;
const mkm = async (pickupMinsFromNow, arrivedMinsAgo) => {
  const rq = (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, pickup_lat, pickup_lng) values ($1,'A','B',470,500,'points', false, 49.2665, -123.0007) returning id", [r1]))[0].id;
  await db.exec("set session_replication_role = replica");
  const mid = (await q("insert into matches (trip_id, request_id, driver_id, rider_id, status, ride_date, pay_with, points, pickup_time, detour_min, en_route_at, arrived_at) values ($1,$2,$3,$4,'accepted', current_date + 30, 'points', 10, now() + ($5 || ' minutes')::interval, 5, now() - interval '30 minutes', case when $6::int is null then null else now() - ($6 || ' minutes')::interval end) returning id", [tid, rq, d, r1, String(pickupMinsFromNow), arrivedMinsAgo === null ? null : String(arrivedMinsAgo)]))[0].id;
  await db.exec("set session_replication_role = origin"); return mid;
};
const sr = '33333333-3333-3333-3333-333333333331'; await q("insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','sample-r-1@example.invalid',now(),'{}','{\"full_name\":\"Sam (sample)\"}',now(),now())", [sr]);
const day = "current_date + 3";
const dA='11111111-1111-1111-1111-1111111111a1', dB='11111111-1111-1111-1111-1111111111b1'; for (const [u,e,p] of [[dA,'da@example.com','PLA1'],[dB,'db@example.com','PLB1']]) { await mk(u,e,'Drv'); await q("insert into profile_cards (user_id, photo, car_plate) values ($1,'https://x.example/p.jpg',$2)", [u,p]); }
const mkTrip = async (cap, drv) => (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',49.2600,-123.0000,49.2850,-123.1200,480,20,30,10,'either'," + day + ",$2,0.2) returning id", [drv || d, cap]))[0].id;
const mkReq = async (u, lat, lng) => (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, ride_date, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) values ($1,'A','B',470,520,'cash', true," + day + ",$2,$3,49.2827,-123.1207) returning id", [u, lat, lng]))[0].id;
const ins = async (trip, req, rider) => { try { const id = (await q("insert into matches (trip_id, request_id, driver_id, rider_id, pay_with, points, ride_date) values ($1,$2,(select user_id from trips where id=$1),$3,'cash',0," + day + ") returning id, detour_min", [trip, req, rider]))[0]; return id; } catch (e) { return e.message; } };
const t1 = await mkTrip(3);
let r = await ins(t1, await mkReq(sr, 49.2665, -123.0007), sr); ok('a made-up rider that fits is sent, with its detour filled in', r && r.id && r.detour_min != null, JSON.stringify(r));
const far = await mkReq(sr, 49.0000, -122.0000);
r = await ins(t1, far, sr); ok('a made-up rider far away is refused', typeof r === 'string' && /would not fit/.test(r), JSON.stringify(r));
const t2 = await mkTrip(1, dA);
const rq1 = await mkReq(r1, 49.2665, -123.0007);
await db.exec("set session_replication_role = replica"); await q("insert into matches (trip_id, request_id, driver_id, rider_id, status, ride_date, pay_with, points) values ($1,$2,$3,$4,'accepted'," + day + ",'cash',0)", [t2, rq1, d, r1]); await db.exec("set session_replication_role = origin");
r = await ins(t2, await mkReq(sr, 49.2665, -123.0007), sr); ok('a made-up rider on a full trip is refused', typeof r === 'string' && /full/.test(r), JSON.stringify(r));
const t3 = await mkTrip(3, dB);
r = await ins(t3, await mkReq(r2, 49.0000, -122.0000), r2); ok('a real rider is not touched by this rule', r && r.id, JSON.stringify(r));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL'); process.exit(0);