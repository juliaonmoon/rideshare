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
const tid0 = (await q("insert into trips (user_id, origin, dest, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',480,60,90,0,'either', current_date + 30, 3, 0.2) returning id", [d]))[0].id;
const mkm = async (pickupMinsFromNow, arrivedMinsAgo) => {
  const rq = (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, pickup_lat, pickup_lng) values ($1,'A','B',470,500,'points', false, 49.2665, -123.0007) returning id", [r1]))[0].id;
  await db.exec("set session_replication_role = replica");
  const mid = (await q("insert into matches (trip_id, request_id, driver_id, rider_id, status, ride_date, pay_with, points, pickup_time, detour_min, en_route_at, arrived_at) values ($1,$2,$3,$4,'accepted', current_date + 30, 'points', 10, now() + ($5 || ' minutes')::interval, 5, now() - interval '30 minutes', case when $6::int is null then null else now() - ($6 || ' minutes')::interval end) returning id", [tid, rq, d, r1, String(pickupMinsFromNow), arrivedMinsAgo === null ? null : String(arrivedMinsAgo)]))[0].id;
  await db.exec("set session_replication_role = origin"); return mid;
};
const d2='11111111-1111-1111-1111-111111111112', d3='11111111-1111-1111-1111-111111111113'; await mk(d2,'d2@example.com','Dan'); await mk(d3,'d3@example.com','Dot'); await q("insert into profile_cards (user_id, photo, car_plate) values ($1,'https://x.example/p.jpg','ABC124'), ($2,'https://x.example/p.jpg','ABC125')", [d2, d3]);
const day = "current_date + 3";
const rq = async (user, active, pays) => (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, ride_date, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) values ($1,'A','B',470,520,$2,$3," + day + ",49.2665,-123.0007,49.2827,-123.1207) returning id", [user, pays || 'points', active]))[0].id;
const nt = async (user) => (await q("select count(*)::int c from notices where user_id=$1 and kind='driver_found'", [user]))[0].c;
const post = async (user, extra) => (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',49.2600,-123.0000,49.2850,-123.1200,480,20,30,10,'either'," + (extra || day) + ",3,0.2) returning id", [user]))[0].id;
const wR = await rq(r1, true);
const dR = await rq(r2, false);
const t1 = await post(d);
ok('waiting rider gets a notice when a fitting trip is posted', (await nt(r1)) === 1, String(await nt(r1)));
ok('someone with no waiting request gets nothing', (await nt(r2)) === 0);
const fr = (await q("select count(*)::int c from driver_finds where request_id=$1 and trip_id=$2", [wR, t1]))[0].c; ok('remembered, so no repeat', fr === 1, String(fr));
await q("update trips set max_wait = 11 where id=$1", [t1]); ok('editing the trip does not alert again', (await nt(r1)) === 1, String(await nt(r1)));
await q("update trips set depart_min = 485 where id=$1", [t1]); ok('changing the time does not alert again (already told)', (await nt(r1)) === 1, String(await nt(r1)));
const dr4 = '11111111-1111-1111-1111-111111111118'; await mk(dr4, 'd8@example.com', 'Dax'); await q("insert into profile_cards (user_id, photo, car_plate) values ($1,'https://x.example/p.jpg','ABC128')", [dr4]);
const far = (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',49.0,-122.0,49.1,-122.1,480,5,5,5,'either', " + day + ",3,0.2) returning id", [dr4]))[0].id;
ok('a trip far away does not alert', (await nt(r1)) === 1, String(await nt(r1)));
const dr3 = '11111111-1111-1111-1111-111111111119'; await mk(dr3, 'd9@example.com', 'Dig'); await q("insert into profile_cards (user_id, photo, car_plate) values ($1,'https://x.example/p.jpg','ABC129')", [dr3]);
await post(dr3, "current_date + 6"); ok('a trip on another day does not alert', (await nt(r1)) === 1, String(await nt(r1)));
await q("delete from notices where user_id=$1", [r1]);
await q("insert into tracking_tokens (driver_id, token_hash, expires_at) values ($1, encode(sha256(convert_to('tok','UTF8')),'hex'), now() + interval '1 hour')", [r1]);
const a = await as('anon', null, "select rider_alerts_token('tok') r"); ok('phone check works with no rides and still returns finds list', a.rows && Array.isArray(a.rows[0].r.finds) && a.rows[0].r.finds.length === 0 && a.rows[0].r.active === true, JSON.stringify(a));
await q("insert into notices (user_id, kind, title, body) values ($1,'driver_found','A driver fits your ride','x')", [r1]);
const b = await as('anon', null, "select rider_alerts_token('tok') r"); ok('unread notice is handed to the phone', b.rows && b.rows[0].r.finds.length === 1, JSON.stringify(b));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL'); process.exit(0);