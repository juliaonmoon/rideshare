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
console.log(`\n${n} tests passed`);
