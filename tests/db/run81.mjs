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

const mkTrip = async (dep, date) => (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',49.066,-122.801,49.2276,-123.0076,$2,15,30,0,'either', " + date + ", 3, 0.2) returning id", [d, dep]))[0].id;
const mkReq = async (lat, lng) => (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) values ($1,'P','Q',0,1439,'points', true, $2, $3, 49.2276, -123.0076) returning id", [r1, lat, lng]))[0].id;
const quote = async (tid, rq) => (await q("select public._quote_trip($1, " + today + ", $2, false) j", [tid, rq]))[0].j;
// 1. leave time still ahead: nothing changes, no position needed
const future = await mkTrip(Math.min(1439, vnow + 120), today);
const rqA = await mkReq(49.13, -122.84);
const rqB = await mkReq(49.08, -122.81);
let j = await quote(future, rqB);
ok('before the leave time: measured from the start, no position needed', j.ok === true, JSON.stringify(j));
// 2. leave time passed, no position: refused, and _needs_position says so
const past = await mkTrip(Math.max(0, vnow - 20), today);
j = await quote(past, rqA);
ok('on the road with no position: new rider refused', j.ok === false && j.reason === 'no_position', JSON.stringify(j));
ok('_needs_position true', (await q("select public._needs_position($1, " + today + ") v", [past]))[0].v === true);
// 3. fresh position near the pickup: accepted, measured from the car
await q("insert into driver_positions (driver_id, lat, lng, updated_at) values ($1, 49.10, -122.82, now()) on conflict (driver_id) do update set lat=49.10, lng=-122.82, updated_at=now()", [d]);
j = await quote(past, rqA);
ok('fresh position: rider can be taken', j.ok === true, JSON.stringify(j));
ok('_needs_position false with a fresh position', (await q("select public._needs_position($1, " + today + ") v", [past]))[0].v === false);
// 4. the car is already past the pickup (near the destination): the pickup behind it does not fit
await q("update driver_positions set lat=49.22, lng=-123.0, updated_at=now() where driver_id=$1", [d]);
j = await quote(past, rqA);
ok('pickup behind the car does not fit', j.ok === false, JSON.stringify(j));
// 5. position older than 2 minutes counts as none
await q("update driver_positions set lat=49.10, lng=-122.82, updated_at=now() - interval '3 minutes' where driver_id=$1", [d]);
j = await quote(past, rqA);
ok('stale position (3 min) refused', j.ok === false && j.reason === 'no_position', JSON.stringify(j));
// 6. the seat-request screens hide it too (_reachable)
await db.exec("set session_replication_role = replica");
const mid = (await q("insert into matches (trip_id, request_id, driver_id, rider_id, status, ride_date, pay_with, points, detour_min) values ($1,$2,$3,$4,'requested', " + today + ", 'points', 0, 5) returning id", [past, rqA, d, r1]))[0].id;
await db.exec("set session_replication_role = origin");
ok('_reachable false with no fresh position', (await q("select public._reachable($1) v", [mid]))[0].v === false);
await q("update driver_positions set updated_at=now() where driver_id=$1", [d]);
ok('_reachable back once the position returns', (await q("select public._reachable($1) v", [mid]))[0].v === true);
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);
