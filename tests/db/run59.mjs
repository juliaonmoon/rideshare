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
const mkMatch = async (minsToPickup, detour, arrived) => {
  const rq = (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active) values ($1,'A','B',470,500,'points', false) returning id", [r1]))[0].id;
  await db.exec("set session_replication_role = replica"); const mid = (await q("insert into matches (trip_id, request_id, driver_id, rider_id, status, ride_date, pay_with, points, pickup_time, detour_min, arrived_at) values ($1,$2,$3,$4,'accepted', current_date + 30, 'points', 10, now() + ($5 || ' minutes')::interval, $6, " + (arrived ? 'now()' : 'null') + ") returning id", [tid, rq, d, r1, String(minsToPickup), detour]))[0].id; await db.exec("set session_replication_role = origin"); return mid;
};
const cancel = async (mid, who) => (await as('authenticated', who, "select cancel_ride($1) r", [mid]));
const row = async (mid) => (await q("select status, late, driver_late, refunded from matches where id=$1", [mid]))[0];
let m, c, r;
m = await mkMatch(60, 5, false); c = await cancel(m, r1); r = await row(m); ok('60 min before pickup, 5 min detour: free, all points back', c.rows && c.rows[0].r === 'cancelled_full' && r.refunded === 10 && !r.late, JSON.stringify([c, r]));
m = await mkMatch(3, 5, false); c = await cancel(m, r1); r = await row(m); ok('3 min before pickup, 5 min detour (detour started): driver keeps all', c.rows && c.rows[0].r === 'cancelled_kept' && r.refunded === 0 && r.late, JSON.stringify([c, r]));
m = await mkMatch(4, 1, false); c = await cancel(m, r1); r = await row(m); ok('1 min detour uses the 3 min minimum: 4 min before pickup is still free', c.rows && c.rows[0].r === 'cancelled_full', JSON.stringify([c, r]));
m = await mkMatch(2, 1, false); c = await cancel(m, r1); r = await row(m); ok('2 min before pickup, 1 min detour: past the 3 min minimum, all kept', c.rows && c.rows[0].r === 'cancelled_kept', JSON.stringify([c, r]));
m = await mkMatch(-10, 5, false); c = await cancel(m, r1); r = await row(m); ok('driver 10 min late, not arrived: free, all points back, driver late mark', c.rows && c.rows[0].r === 'cancelled_driver_late' && r.refunded === 10 && r.driver_late, JSON.stringify([c, r]));
m = await mkMatch(-3, 5, false); c = await cancel(m, r1); r = await row(m); ok('3 min past pickup, not arrived: driver did not arrive, free', c.rows && c.rows[0].r === 'cancelled_driver_late' && r.refunded === 10, JSON.stringify([c, r]));
m = await mkMatch(-2, 5, false); c = await cancel(m, r1); r = await row(m); ok('2 min past pickup: rider should wait, all kept', c.rows && c.rows[0].r === 'cancelled_kept', JSON.stringify([c, r]));
m = await mkMatch(-10, 5, true); c = await cancel(m, r1); r = await row(m); ok('driver arrived, rider cancels 10 min after pickup time: allowed, all kept (not a late driver)', c.rows && c.rows[0].r === 'cancelled_kept', JSON.stringify([c, r]));
m = await mkMatch(1, 5, false); c = await cancel(m, d); r = await row(m); ok('driver cancels: rider gets everything back', c.rows && r.refunded === 10, JSON.stringify([c, r]));
const w = (await q("select points from wallets where user_id=$1", [d]))[0].points; ok('driver wallet only gained the two half-keeps (4 x 10 = 140)', w === 140, String(w));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);





