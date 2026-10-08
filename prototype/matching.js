// Core logic for the RideShare prototype: travel estimates, detour-aware matching, fair cost split, points.
// No dependencies. Runs in the browser (window.RS) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const CIRCUITY = 1.35;   // straight-line distance -> rough road distance
  const AVG_KMH = 40;      // rough average commute speed
  const POINT_VALUE = 0.10; // 1 point = $0.10 of trip cost (closed loop, no cash-out)

  function haversineKm(a, b) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const roadKm = (a, b) => haversineKm(a, b) * CIRCUITY;
  const minutes = (a, b) => (roadKm(a, b) / AVG_KMH) * 60;

  // stops: [{loc, type:'origin'|'pickup'|'dropoff'|'dest', rider?}]
  // Walks the route; returns timing per stop, total minutes, and feasibility.
  function evaluate(stops, departMin, maxWait) {
    let t = departMin, ok = true;
    const timeline = [];
    for (let i = 0; i < stops.length; i++) {
      if (i > 0) t += minutes(stops[i - 1].loc, stops[i].loc);
      const s = stops[i];
      let wait = 0;
      if (s.type === 'pickup') {
        wait = Math.max(0, s.rider.readyFrom - t);
        if (t > s.rider.readyTo) ok = false;   // would arrive after rider's window closes
        if (wait > maxWait) ok = false;        // driver would wait too long
        t += wait;
      }
      timeline.push({ stop: s, arrive: t - wait, depart: t, wait });
    }
    return { ok, timeline, totalMin: t - departMin };
  }

  // Cheapest feasible insertion of a rider's pickup+dropoff into an existing route.
  function bestInsertion(stops, rider, driver) {
    const directMin = minutes(driver.origin, driver.dest);
    let best = null;
    for (let i = 1; i < stops.length; i++) {
      for (let j = i; j < stops.length; j++) {
        const next = stops.slice();
        next.splice(j, 0, { loc: rider.dropoff, type: 'dropoff', rider });
        next.splice(i, 0, { loc: rider.pickup, type: 'pickup', rider });
        const ev = evaluate(next, driver.departMin, driver.maxWait);
        const detour = ev.totalMin - directMin;
        if (ev.ok && detour <= driver.maxDetour + 1e-9 && (!best || detour < best.detour)) {
          best = { stops: next, ev, detour };
        }
      }
    }
    return best;
  }

  function baseStops(driver) {
    return [{ loc: driver.origin, type: 'origin' }, { loc: driver.dest, type: 'dest' }];
  }

  // Build the current route from accepted riders (greedy cheapest insertion, in acceptance order).
  function buildRoute(driver, accepted) {
    let stops = baseStops(driver);
    for (const r of accepted) {
      const b = bestInsertion(stops, r, driver);
      if (!b) return null;
      stops = b.stops;
    }
    return stops;
  }

  const compatible = (driverAccepts, riderPays) =>
    driverAccepts === 'either' || driverAccepts === riderPays;

  // Candidates who fit within the driver's max detour / max wait, given riders already accepted.
  function findMatches(driver, riders, accepted) {
    const current = buildRoute(driver, accepted);
    if (!current) return [];
    const baseDetour = evaluate(current, driver.departMin, driver.maxWait).totalMin -
      minutes(driver.origin, driver.dest);
    const out = [];
    for (const r of riders) {
      if (accepted.includes(r) || !compatible(driver.accepts, r.pays)) continue;
      const b = bestInsertion(current, r, driver);
      if (!b) continue;
      const pick = b.ev.timeline.find((x) => x.stop.type === 'pickup' && x.stop.rider === r);
      const drop = b.ev.timeline.find((x) => x.stop.type === 'dropoff' && x.stop.rider === r);
      out.push({ rider: r, stops: b.stops, detour: b.detour, addedDetour: b.detour - baseDetour,
        pickupAt: pick.depart, wait: pick.wait, dropAt: drop.arrive });
    }
    return out.sort((a, b) => a.addedDetour - b.addedDetour);
  }

  // Fair split: each route segment's operating cost is shared equally by everyone aboard (driver included).
  // Rider payments can never exceed the real cost of the route, so the driver never profits.
  function priceRoute(stops, costPerKm) {
    const riderPay = new Map();
    let aboard = [], total = 0, driverShare = 0;
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      if (prev.type === 'pickup') aboard.push(prev.rider);
      if (prev.type === 'dropoff') aboard = aboard.filter((r) => r !== prev.rider);
      const seg = roadKm(prev.loc, stops[i].loc) * costPerKm;
      const share = seg / (aboard.length + 1);
      total += seg;
      driverShare += share;
      for (const r of aboard) riderPay.set(r, (riderPay.get(r) || 0) + share);
    }
    return { total, driverShare, riderPay };
  }

  const km = (stops) => stops.slice(1).reduce((s, x, i) => s + roadKm(stops[i].loc, x.loc), 0);
  const toPoints = (dollars) => Math.max(1, Math.round(dollars / POINT_VALUE));
  const money = (n) => '$' + n.toFixed(2);
  const clock = (m) => {
    const h = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
    return String(h).padStart(2, '0') + ':' + String(mm === 60 ? 0 : mm).padStart(2, '0');
  };

  const RS = { haversineKm, roadKm, minutes, evaluate, bestInsertion, buildRoute, findMatches,
    priceRoute, compatible, km, toPoints, money, clock, POINT_VALUE };
  if (typeof module !== 'undefined' && module.exports) module.exports = RS;
  else root.RS = RS;
})(typeof window !== 'undefined' ? window : globalThis);
