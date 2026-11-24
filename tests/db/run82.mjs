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

await q("insert into wallets (user_id, points) values ($1, 100) on conflict (user_id) do update set points = 100", [r1]);
await q("insert into tracking_tokens (driver_id, token_hash, expires_at) values ($1, encode(sha256(convert_to('tok','UTF8')),'hex'), now() + interval '1 hour')", [d]);
const tid = (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'A','B',49.066,-122.801,49.2276,-123.0076,$2,15,30,0,'either', " + today + ", 3, 0.2) returning id", [d, Math.max(0, vnow - 20)]))[0].id;
const rq = (await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) values ($1,'Newton (Surrey)','Q',0,1439,'points', true, 49.08, -122.81, 49.2276, -123.0076) returning id", [r1]))[0].id;
// (2) driver on the road, no position: the rider is told why
let e = await as('authenticated', r1, "select request_seat($1,$2,'points'," + today + ") r", [tid, rq]);
ok('rider told the driver cannot be located', !!e.error && /cannot be located/.test(e.error), e.error);
// (1) accepted ride: I'm here and sharing reach the driver's phone helper
await q("insert into driver_positions (driver_id, lat, lng, updated_at) values ($1, 49.07, -122.80, now()) on conflict (driver_id) do update set updated_at=now()", [d]);
e = await as('authenticated', r1, "select request_seat($1,$2,'points'," + today + ") r", [tid, rq]);
ok('seat requested once the car has a position', !!e.rows, e.error);
const mid = (await q("select id from matches where trip_id=$1", [tid]))[0].id;
await q("update matches set status='accepted', pickup_time = now() + interval '5 minutes' where id=$1", [mid]);
await q("update matches set rider_here_at = now() where id=$1", [mid]);
await q("update matches set rider_share = true where id=$1", [mid]);
const a = (await as('anon', null, "select driver_notice_alerts_token('tok') r")).rows[0].r;
ok('helper gets the I\'m here alert', a.some((x) => x.kind === 'rider_here' && /Newton/.test(x.body)), JSON.stringify(a.map((x) => x.kind)));
ok('helper gets the sharing alert', a.some((x) => x.kind === 'rider_sharing'));
await q("update matches set rider_here_at = now() where id=$1", [mid]);
ok('no second I\'m here alert', (await q("select count(*)::int c from notices where match_id=$1 and kind='rider_here'", [mid]))[0].c === 1);
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);
