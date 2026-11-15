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
const pkOf = async (id) => (await q("select pickup_time, prop_time, pickup_changes, pickup_declined, status, refunded from matches where id=$1", [id]))[0];
m = await mkm(30, null);
const pk0 = (await pkOf(m)).pickup_time;
e = await as('authenticated', r1, "select propose_pickup_time($1, now() + interval '45 minutes') r", [m]); ok('rider cannot propose', !!e.error, JSON.stringify(e));
e = await as('authenticated', d, "select propose_pickup_time($1, now() + interval '10 minutes') r", [m]); ok('earlier than the agreed time: refused', !!e.error && /later than the agreed/.test(e.error), JSON.stringify(e));
e = await as('authenticated', d, "select propose_pickup_time($1, now() + interval '120 minutes') r", [m]); ok('more than an hour later: refused', !!e.error && /more than an hour/.test(e.error), JSON.stringify(e));
e = await as('authenticated', d, "select propose_pickup_time($1, now() + interval '45 minutes') r", [m]); row = await pkOf(m);
ok('driver proposes +15 min', e.rows && e.rows[0].r === 'proposed' && !!row.prop_time && row.pickup_changes === 1 && +row.pickup_time === +pk0, JSON.stringify([e, row]));
const nrider = (await q("select count(*)::int c from notices where user_id=$1 and kind='pickup_time_proposed' and match_id=$2", [r1, m]))[0].c; ok('rider got a notice', nrider === 1, String(nrider));
e = await as('authenticated', d, "select answer_pickup_time($1,'accept') r", [m]); ok('driver cannot answer', !!e.error, JSON.stringify(e));
e = await as('authenticated', r1, "select answer_pickup_time($1,'decline') r", [m]); row = await pkOf(m);
ok('decline: agreed time unchanged, proposal cleared, decline counted', e.rows && e.rows[0].r === 'declined' && row.prop_time === null && +row.pickup_time === +pk0 && row.pickup_declined === 1, JSON.stringify([e, row]));
const ndr = (await q("select count(*)::int c from notices where user_id=$1 and kind='pickup_time_declined'", [d]))[0].c; ok('driver told the time stays', ndr === 1, String(ndr));
e = await as('authenticated', r1, "select answer_pickup_time($1,'accept') r", [m]); ok('nothing to answer now', !!e.error && /no new time/.test(e.error), JSON.stringify(e));

await as('authenticated', d, "select propose_pickup_time($1, now() + interval '45 minutes') r", [m]);
e = await as('authenticated', r1, "select answer_pickup_time($1,'accept') r", [m]); row = await pkOf(m);
ok('accept: new time becomes the agreed time', e.rows && e.rows[0].r === 'accepted' && row.prop_time === null && +row.pickup_time > +pk0 + 14 * 60000, JSON.stringify([e, row]));

// silence = no change
m = await mkm(30, null);
await as('authenticated', d, "select propose_pickup_time($1, now() + interval '45 minutes') r", [m]);
row = await pkOf(m); ok('no answer: agreed time still the old one', +row.pickup_time < +row.prop_time, JSON.stringify(row));
// proposal that has passed expires
await q("update matches set prop_time = now() - interval '1 minute' where id=$1", [m]);
e = await as('authenticated', r1, "select answer_pickup_time($1,'accept') r", [m]); ok('expired proposal cannot be accepted', !!e.error && /expired/.test(e.error), JSON.stringify(e));

// free cancel
m = await mkm(30, null);
await as('authenticated', d, "select propose_pickup_time($1, now() + interval '33 minutes') r", [m]);
await q("update wallets set points = 100 where user_id=$1", [r1]);
e = await as('authenticated', r1, "select answer_pickup_time($1,'cancel') r", [m]); row = await pkOf(m);
ok('cancel free when 3+ minutes later: all points back', e.rows && e.rows[0].r === 'cancelled_free' && row.status === 'cancelled' && row.refunded === 10, JSON.stringify([e, row]));
const wr = (await q("select points from wallets where user_id=$1", [r1]))[0].points; ok('rider wallet +10', wr === 110, String(wr));
const dl = (await q("select late, driver_late from matches where id=$1", [m]))[0]; ok('no mark on the driver', !dl.late && !dl.driver_late, JSON.stringify(dl));
m = await mkm(30, null);
await as('authenticated', d, "select propose_pickup_time($1, now() + interval '31 minutes') r", [m]);
e = await as('authenticated', r1, "select answer_pickup_time($1,'cancel') r", [m]); ok('only 1 minute later: free cancel refused', !!e.error && /less than 3 minutes/.test(e.error), JSON.stringify(e));
// driver already arrived
m = await mkm(30, 1);
e = await as('authenticated', d, "select propose_pickup_time($1, now() + interval '45 minutes') r", [m]); ok('after Arrived: cannot propose', !!e.error && /already arrived/.test(e.error), JSON.stringify(e));
console.log(res.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
process.exit(0);