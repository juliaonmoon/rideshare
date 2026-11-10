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
const ins = (o) => q("insert into trips (user_id, origin, dest, depart_min, max_detour, max_total_detour, max_wait, accepts, trip_date, repeat_days, repeat_until, max_pickups, cost_per_km, origin_lat, origin_lng, dest_lat, dest_lng) values ($1,'Surrey Central','Brentwood (Burnaby)',$2,60,90,0,'either'," + dayN(o.day) + ",'{}',null,3,0.20,49.189,-122.849,49.2665,-123.0007) returning id", [o.who || d, o.at]);
const tryIns = async (o) => { try { return { id: (await ins(o))[0].id }; } catch (e) { return { error: e.message }; } };
let a = await tryIns({ day: 5, at: 1410 }); ok('late trip 23:30 on day 5', !a.error, a.error);
a = await tryIns({ day: 6, at: 10 }); ok('00:10 next day is refused (late trip still driving)', !!a.error && /past midnight/.test(a.error), JSON.stringify(a));
a = await tryIns({ day: 6, at: 420 }); ok('07:00 next day is fine', !a.error, a.error);
a = await tryIns({ day: 9, at: 10 }); ok('00:10 on day 9 is fine', !a.error, a.error);
a = await tryIns({ day: 8, at: 1410 }); ok('23:30 the day before it is refused (runs into the 00:10 trip)', !!a.error && /past midnight/.test(a.error), JSON.stringify(a));
a = await tryIns({ day: 8, at: 1200 }); ok('20:00 the day before is fine', !a.error, a.error);
await q("update profile_cards set car_plate='XYZ789' where user_id=$1", [r1]); a = await tryIns({ day: 6, at: 10, who: r1 }); ok('another driver can drive at 00:10', !a.error, a.error);
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);
