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

const dayN = (n) => "((now() at time zone 'America/Vancouver')::date + " + n + ")";
const ins = (o) => q("insert into trips (user_id, origin, dest, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, repeat_days, repeat_until, max_pickups, cost_per_km, origin_lat, origin_lng, dest_lat, dest_lng, flex_from, flex_to) values ($1,'Surrey Central','Brentwood (Burnaby)',$2,60,90,0,'either'," + dayN(o.day) + ",$3," + (o.until ? dayN(o.until) : 'null') + ",3,0.20,49.189,-122.849,49.2665,-123.0007,$4,$5) returning id", [o.who || d, o.at, o.days || '{}', o.ff || null, o.ft || null]);
const tryIns = async (o) => { try { return { id: (await ins(o))[0].id }; } catch (e) { return { error: e.message }; } };
const dow = (await q("select extract(dow from " + dayN(2) + ")::int w"))[0].w, iso = dow === 0 ? 7 : dow;
let a = await tryIns({ day: 2, at: 480 }); ok('first trip, 8:00', !a.error, a.error);
const t1 = a.id;
a = await tryIns({ day: 2, at: 510 }); ok('a second trip at 8:30 the same day is refused', !!a.error && /overlaps your other trip/.test(a.error), JSON.stringify(a));
ok('and the message names the trip', /Surrey Central to Brentwood/.test(a.error || ''), a.error);
a = await tryIns({ day: 3, at: 480 }); ok('the same time on another day is fine', !a.error, a.error);
a = await tryIns({ day: 2, at: 1200 }); ok('the same day in the evening is fine', !a.error, a.error);
a = await tryIns({ day: 2, at: 0, ff: 360, ft: 720 }); ok('a time window that covers 8:00 is refused', !!a.error && /overlaps/.test(a.error), JSON.stringify(a));
a = await tryIns({ day: 1, at: 480, days: '{' + iso + '}', until: 30 }); ok('a repeating trip with one clashing date is refused', !!a.error && /overlaps/.test(a.error), JSON.stringify(a));
a = await tryIns({ day: 1, at: 900, days: '{' + iso + '}', until: 30 }); ok('the same repeating trip at 15:00 is fine', !a.error, a.error);
const rep = a.id;
a = await as('authenticated', d, "update trips set depart_min=480 where id=$1", [rep]); ok('editing it into a clash is refused', !!a.error && /overlaps/.test(a.error), JSON.stringify(a));
a = await as('authenticated', d, "update trips set depart_min=930 where id=$1", [rep]); ok('editing it to another free time is fine', !a.error, a.error);
a = await as('authenticated', d, "update trips set max_pickups=2 where id=$1", [rep]); ok('changing a rule (not the time) is never blocked', !a.error, a.error);
const d2 = (await q("select " + dayN(2) + "::text s"))[0].s;
a = await as('authenticated', d, "select edit_trip_day($1,$2::date,$3::jsonb) c", [rep, d2, JSON.stringify({ depart_min: 480 })]);
ok('changing one repeat date into a clash is refused (or not a repeat day)', dow === iso % 7 ? (!!a.error && /overlaps/.test(a.error)) : true, JSON.stringify(a));
await q("update trips set active=false where id=$1", [t1]);
a = await tryIns({ day: 2, at: 480 }); ok('after the first trip is cancelled the time is free again', !a.error, a.error);
await q("update profile_cards set car_plate='XYZ789' where user_id=$1", [r1]); a = await tryIns({ day: 2, at: 480, who: r1 }); ok('another driver can drive at the same time', !a.error, a.error);
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);

