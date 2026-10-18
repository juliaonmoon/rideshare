// Run: node prototype/test.js
const assert = require('assert');
const RS = require('./matching.js');
const L = {
  A: { lat: 49.1890, lng: -122.8490 },   // Surrey Central
  B: { lat: 49.2490, lng: -123.0000 },   // BCIT
  onWay: { lat: 49.2200, lng: -122.9200 },
  far: { lat: 49.0500, lng: -122.8000 },  // South Surrey, off the line
};
const driver = { origin: L.A, dest: L.B, departMin: 450, maxDetour: 10, maxWait: 5, accepts: 'either' };
const mk = (id, pickup, dropoff, from, to, pays) => ({ id, pickup, dropoff, readyFrom: from, readyTo: to, pays: pays || 'cash' });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('rider on the route fits within detour limit', () => {
  const r = mk('on', L.onWay, L.B, 440, 470);
  const m = RS.findMatches(driver, [r], []);
  assert.strictEqual(m.length, 1);
  assert.ok(m[0].detour <= driver.maxDetour);
});
t('rider far from the route is filtered out', () => {
  const m = RS.findMatches(driver, [mk('far', L.far, L.B, 440, 470)], []);
  assert.strictEqual(m.length, 0);
});
t('tighter max detour excludes a borderline rider', () => {
  const r = mk('on', { lat: 49.2000, lng: -122.9000 }, L.B, 440, 470);
  const loose = RS.findMatches({ ...driver, maxDetour: 20 }, [r], []);
  const tight = RS.findMatches({ ...driver, maxDetour: 0.1 }, [r], []);
  assert.strictEqual(loose.length, 1);
  assert.ok(tight.length <= 1 && (tight.length === 0 || tight[0].detour <= 0.1));
});
t('rider window that closes before arrival is excluded', () => {
  const m = RS.findMatches(driver, [mk('early', L.onWay, L.B, 400, 410)], []);
  assert.strictEqual(m.length, 0);
});
t('driver waiting longer than max wait is excluded', () => {
  const m = RS.findMatches(driver, [mk('late', L.onWay, L.B, 520, 540)], []);
  assert.strictEqual(m.length, 0);
});
t('payment methods must be compatible', () => {
  const r = mk('p', L.onWay, L.B, 440, 470, 'points');
  assert.strictEqual(RS.findMatches({ ...driver, accepts: 'cash' }, [r], []).length, 0);
  assert.strictEqual(RS.findMatches({ ...driver, accepts: 'points' }, [r], []).length, 1);
});
t('costs are capped: riders never pay more than the route costs; driver never profits', () => {
  const a = mk('a', L.onWay, L.B, 440, 470), b = mk('b', { lat: 49.2100, lng: -122.8800 }, L.B, 430, 480);
  const stops = RS.buildRoute(driver, [a, b]);
  assert.ok(stops);
  const p = RS.priceRoute(stops, 0.2);
  const paid = [...p.riderPay.values()].reduce((s, x) => s + x, 0);
  assert.ok(paid < p.total);
  assert.ok(Math.abs(paid + p.driverShare - p.total) < 1e-9);
});
t('more riders in the car lowers each rider\'s price on the same segment', () => {
  const a = mk('a', L.onWay, L.B, 440, 470), b = mk('b', L.onWay, L.B, 440, 470);
  const one = RS.priceRoute(RS.buildRoute(driver, [a]), 0.2).riderPay.get(a);
  const stops2 = RS.buildRoute(driver, [a, b]);
  const two = RS.priceRoute(stops2, 0.2).riderPay.get(a);
  assert.ok(two < one);
});
t('points conversion is closed-loop and at least 1', () => {
  assert.strictEqual(RS.toPoints(0.01), 1);
  assert.strictEqual(RS.toPoints(5), 50);
});
t('clock rolls the hour when minutes round up to 60 (07:59.6 -> 08:00)', () => {
  assert.strictEqual(RS.clock(7 * 60 + 59.6), '08:00');
  assert.strictEqual(RS.clock(7 * 60 + 30), '07:30');
  assert.strictEqual(RS.clock(23 * 60 + 59.6), '00:00');
});
t('points asked for never exceed the server-side fair limit (supabase/migrations/002)', () => {
  global.window = global.window || {}; require('./data.js'); const D = window.DEMO;
  let pairs = 0;
  for (const d of D.drivers) for (const r of D.riders) {
    const m = RS.findMatches({ ...d, cpk: 0.2 }, [r], []); if (!m.length) continue; pairs++;
    const pts = RS.toPoints(RS.priceRoute(m[0].stops, 0.2).riderPay.get(r) || 0);
    const max = Math.ceil(((RS.roadKm(r.pickup, r.dropoff) + d.maxDetour * 40 / 60) * 0.2 / 2) / 0.10) + 1;
    assert.ok(pts >= 1 && pts <= max, `${d.name}/${r.name}: ${pts} > ${max}`);
  }
  assert.ok(pairs > 20);
});
t('dates: one-off and weekly repeat occurrences (ISO days, Mon=1)', () => {
  const D = require('./dates.js');
  assert.strictEqual(D.isoDow('2026-10-18'), 7);            // Sunday
  assert.strictEqual(D.isoDow('2026-10-19'), 1);            // Monday
  assert.ok(D.occursOn('2026-10-19', [], '2026-10-19'));
  assert.ok(!D.occursOn('2026-10-19', [], '2026-10-20'));
  assert.ok(D.occursOn('2026-10-19', [1, 2, 3, 4, 5], '2026-10-23'));   // Fri after start
  assert.ok(!D.occursOn('2026-10-19', [1, 2, 3, 4, 5], '2026-10-24'));  // Sat not in list
  assert.ok(!D.occursOn('2026-10-19', [1, 2, 3, 4, 5], '2026-10-16'));  // before start
  const now = new Date(2026, 9, 18, 10, 0);
  assert.deepStrictEqual(D.nextOccurrences('2026-10-18', [1, 2, 3, 4, 5], now, 3), ['2026-10-18', '2026-10-19', '2026-10-20']);
  assert.strictEqual(D.label('2026-10-18', now), 'Today');
  assert.strictEqual(D.label('2026-10-19', now), 'Tomorrow');
  assert.strictEqual(D.label('2026-10-22', now), 'Thu Oct 22');
  assert.strictEqual(D.repeatText([3, 1, 5]), 'Mon Wed Fri');
});
t('dates: booking rules (30 min ahead, 30 days max, no past)', () => {
  const D = require('./dates.js'), now = new Date(2026, 9, 18, 10, 0);
  assert.strictEqual(D.check('2026-10-18', 10 * 60 + 29, now), 'Pick a time at least 30 minutes from now');
  assert.strictEqual(D.check('2026-10-18', 10 * 60 + 30, now), '');
  assert.strictEqual(D.check('2026-10-17', 600, now), 'That date has passed');
  assert.strictEqual(D.check('2026-11-17', 600, now), '');
  assert.strictEqual(D.check('2026-11-18', 600, now), 'You can book up to 30 days ahead');
  assert.strictEqual(D.check('', 600, now), 'Pick a date');
});
t('dates: Vancouver pickup time handles summer and winter time', () => {
  const D = require('./dates.js');
  assert.strictEqual(D.vanEpoch('2026-10-19', 450), Date.UTC(2026, 9, 19, 14, 30));   // PDT = UTC-7
  assert.strictEqual(D.vanEpoch('2026-12-01', 450), Date.UTC(2026, 11, 1, 15, 30));   // PST = UTC-8
  assert.strictEqual(D.vanEpoch('2026-11-01', 60), Date.UTC(2026, 10, 1, 8, 0));      // 01:00 on the day clocks go back
  assert.strictEqual(D.vanMonth(Date.UTC(2026, 9, 31, 20, 0)), '2026-10');
  assert.strictEqual(D.vanMonth(Date.UTC(2026, 10, 1, 3, 0)), '2026-10');            // 20:00 on Oct 31 in Vancouver
});
console.log(`\n${n} tests passed`);
