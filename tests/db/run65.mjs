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
let m, e, row;
const mkm0 = mkm; const mkmT = async (a, b) => { const id = await mkm0(a, b); await db.exec("set session_replication_role = replica"); await q("update matches set ride_date = current_date where id=$1", [id]); await db.exec("set session_replication_role = origin"); return id; };
const st = async (id) => (await q("select status, driver_late, late, refunded, settled from matches where id=$1", [id]))[0];
await q("update wallets set points = 100 where user_id=$1", [r1]);
m = await mkmT(-45, null);
e = await as('authenticated', r2, "select expire_missing_arrivals() r"); row = await st(m);
ok('45 min past pickup, driver never arrived: closes, driver late, 10 back', e.rows && e.rows[0].r >= 1 && row.status === 'cancelled' && row.driver_late && !row.late && row.refunded === 10, JSON.stringify([e, row]));
const w = (await q("select points from wallets where user_id=$1", [r1]))[0].points; ok('rider wallet +10', w === 110, String(w));
const nt = (await q("select count(*)::int c from notices where user_id=$1 and match_id=$2", [r1, m]))[0].c; ok('rider got a notice', nt === 1, String(nt));
e = await as('authenticated', r2, "select expire_missing_arrivals() r"); ok('running again does nothing more', e.rows && e.rows[0].r === 0 && (await q("select points from wallets where user_id=$1", [r1]))[0].points === 110, JSON.stringify(e));
m = await mkmT(-20, null); await as('authenticated', r2, "select expire_missing_arrivals()"); row = await st(m); ok('only 20 min past pickup: still open', row.status === 'accepted', JSON.stringify(row));
m = await mkmT(-45, 40); await as('authenticated', r2, "select expire_missing_arrivals()"); row = await st(m); ok('driver tapped Arrived: left alone', row.status === 'accepted', JSON.stringify(row));
m = await mkmT(-45, null); await q("update matches set rider_confirmed_at = now() where id=$1", [m]); await as('authenticated', r2, "select expire_missing_arrivals()"); row = await st(m); ok('rider confirmed being in the car: left alone', row.status === 'accepted', JSON.stringify(row));
e = await as('anon', null, "select expire_missing_arrivals() r"); ok('signed-out cannot run it', !!e.error, JSON.stringify(e));
const rl = (await q("select driver_cancels from reliability where user_id=$1", [d]))[0]; ok('counts in the driver record', rl.driver_cancels >= 1, JSON.stringify(rl));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL'); process.exit(0);