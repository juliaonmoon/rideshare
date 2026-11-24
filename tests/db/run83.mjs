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

const s1 = '33333333-3333-3333-3333-333333333331';
await db.query("insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','sample-r-1@example.invalid',now(),'{}','{\"full_name\":\"Noor (sample)\"}',now(),now())", [s1]);
await q("insert into ride_requests (user_id, pickup, dropoff, ready_from, ready_to, pays, active) values ($1,'A','B',0,1439,'cash', true)", [s1]);
const tid = (await q("insert into trips (user_id, origin, dest, origin_lat, origin_lng, dest_lat, dest_lng, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, max_pickups, cost_per_km) values ($1,'South Surrey','Metrotown (Burnaby)',49.066,-122.801,49.2276,-123.0076,$2,15,30,0,'either', " + today + ", 3, 0.2) returning id", [d, Math.min(1400, vnow + 20)]))[0].id;
await db.exec("set session_replication_role = replica");
const who = await q("select public._make_test_request($1, 0) n", [d]);
await db.exec("set session_replication_role = origin");
const rq = (await q("select pickup, dropoff, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng from ride_requests where user_id=$1", [s1]))[0];
const f = (rq.pickup_lat - 49.066) / (49.2276 - 49.066), g = (rq.dropoff_lat - 49.066) / (49.2276 - 49.066);
ok('sample rider returned', !!who[0].n, who[0].n);
ok('pickup is in the middle of the trip (about 40%)', f > 0.35 && f < 0.45, 'fraction ' + f.toFixed(2) + ' at ' + rq.pickup);
ok('drop-off is near the end but not at it (about 85%)', g > 0.8 && g < 0.9, 'fraction ' + g.toFixed(2) + ' at ' + rq.dropoff);
ok('place names are real areas, not the trip start', rq.pickup !== 'South Surrey' || f < 0.1, rq.pickup + ' -> ' + rq.dropoff);
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);
