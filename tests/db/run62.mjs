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
m = await mkm(-10, 3);
e = await as('authenticated', d, "select mark_no_show($1) r", [m]); ok('3 min after arriving: too early to close as missed pickup', !!e.error && /Wait 5 minutes/.test(e.error), JSON.stringify(e));
await q("update matches set arrived_at = now() - interval '6 minutes' where id=$1", [m]);
e = await as('authenticated', r2, "select mark_no_show($1) r", [m]); ok('a stranger cannot close it', !!e.error, JSON.stringify(e));
e = await as('authenticated', d, "select mark_no_show($1) r", [m]); row = (await q("select status, no_show_disputed from matches where id=$1", [m]))[0];
ok('6 min after arriving: driver closes it, driver keeps points, not disputed', e.rows && e.rows[0].r === 'no_show' && row.status === 'no_show' && !row.no_show_disputed, JSON.stringify([e, row]));
const dw = (await q("select points from wallets where user_id=$1", [d]))[0].points; ok('driver wallet got the 10 points', dw === 110, String(dw));

m = await mkm(-10, 6);
e = await as('authenticated', d, "select rider_here($1) r", [m]); ok('driver cannot tap I am here', !!e.error, JSON.stringify(e));
e = await as('authenticated', r1, "select rider_here($1) r", [m]); row = (await q("select rider_here_at from matches where id=$1", [m]))[0]; ok('rider taps I am here', e.rows && e.rows[0].r === 'ok' && !!row.rider_here_at, JSON.stringify([e, row]));
e = await as('authenticated', d, "select mark_no_show($1) r", [m]); ok('rider said here: 6 min is not enough, needs 10', !!e.error && /Wait 10 minutes/.test(e.error), JSON.stringify(e));
await q("update matches set arrived_at = now() - interval '11 minutes' where id=$1", [m]);
e = await as('authenticated', d, "select mark_no_show($1) r", [m]); row = (await q("select status, no_show_disputed from matches where id=$1", [m]))[0];
ok('after 10 min the driver can close it, and it is flagged disputed', e.rows && e.rows[0].r === 'no_show_disputed' && row.no_show_disputed === true, JSON.stringify([e, row]));

m = await mkm(120, null);
e = await as('authenticated', r1, "select rider_here($1) r", [m]); ok('2 hours before pickup: too early to say I am here', !!e.error && /too early/.test(e.error), JSON.stringify(e));
m = await mkm(20, null);
e = await as('authenticated', r1, "select rider_here($1) r", [m]); ok('20 min before pickup: allowed', e.rows && e.rows[0].r === 'ok', JSON.stringify(e));
m = await mkm(-10, null);
e = await as('authenticated', d, "select mark_no_show($1) r", [m]); ok('driver has not tapped Arrived: cannot close', !!e.error && /arrived/.test(e.error), JSON.stringify(e));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);