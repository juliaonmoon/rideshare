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
  const guessMinutes = (a, b) => (roadKm(a, b) / AVG_KMH) * 60;   // fallback only, when Google times are missing for a place
  // Google drive times between the neighbourhood centres (traffic.js). Four tables by time of day.
  let TRAFFIC = null; const AT = new Map(), CENT = [], SNAP = new Map();
  const keyOf = (p) => p.lat.toFixed(4) + '|' + p.lng.toFixed(4);
  function setTraffic(T, locs) {
    TRAFFIC = T; AT.clear(); CENT.length = 0; SNAP.clear();
    if (!T || !locs) return;
    T.names.forEach((n, i) => { if (locs[n]) { AT.set(keyOf(locs[n]), i); CENT.push({ i, lat: locs[n].lat, lng: locs[n].lng }); } });
  }
  // Which table to use: weekends and evenings use "off"; weekdays use morning, midday or afternoon.
  function bucketFor(atMin, dow) {
    if (dow === 0 || dow === 6) return 'off';
    if (atMin >= 330 && atMin < 600) return 'wk_am';
    if (atMin >= 600 && atMin < 900) return 'wk_mid';
    if (atMin >= 900 && atMin < 1140) return 'wk_pm';
    return 'off';
  }
  // The neighbourhood centre closest to any point on the map (remembered, because matching asks many times).
  function snap(p) {
    const k = keyOf(p); let s = SNAP.get(k);
    if (!s) { s = { c: null, km: Infinity }; for (const c of CENT) { const d = haversineKm(p, c); if (d < s.km) s = { c, km: d }; } SNAP.set(k, s); }
    return s;
  }
  // Minutes to drive from a to b: Google's typical-traffic time for that time of day, else the rough estimate.
  // For an address that is not a neighbourhood centre, the straight-line estimate is scaled by how much slower or faster Google says the trip
  // between the two nearest centres is, so rush hour and bridges still count.
  function minutes(a, b, atMin, dow) {
    if (TRAFFIC && AT.size) {
      const bk = TRAFFIC[bucketFor(atMin == null ? 480 : ((atMin % 1440) + 1440) % 1440, dow)];
      const i = AT.get(keyOf(a)), j = AT.get(keyOf(b));
      if (i != null && j != null) { const v = bk[i][j]; if (v != null) return v; }
      else {
        const sa = snap(a), sb = snap(b);
        if (sa.c && sb.c && sa.c.i !== sb.c.i) {
          const v = bk[sa.c.i][sb.c.i], g = guessMinutes(sa.c, sb.c);
          if (v != null && g > 2) return guessMinutes(a, b) * Math.min(3, Math.max(0.5, v / g));
        }
      }
    }
    return guessMinutes(a, b);
  }

  // stops: [{loc, type:'origin'|'pickup'|'dropoff'|'dest', rider?}]
  // Walks the route; returns timing per stop, total minutes, and feasibility.
  function evaluate(stops, departMin, maxWait, dow) {
    let t = departMin, ok = true;
    const timeline = [];
    for (let i = 0; i < stops.length; i++) {
      if (i > 0) t += minutes(stops[i - 1].loc, stops[i].loc, t, dow);
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

  // The most extra minutes ALL pickups together may add. If the driver set no separate total, it is the same as max detour.
  const totalCap = (driver) => (driver.maxTotal == null ? driver.maxDetour : Math.max(driver.maxTotal, driver.maxDetour));
  // Cheapest feasible insertion of a rider's pickup+dropoff into an existing route.
  // relaxed = true is for riders the driver has ALREADY accepted: they stay on the route even if the timing or detour no longer fits.
  function bestInsertion(stops, rider, driver, relaxed) {
    const directMin = minutes(driver.origin, driver.dest, driver.departMin, driver.dow);
    let best = null;
    for (let i = 1; i < stops.length; i++) {
      for (let j = i; j < stops.length; j++) {
        const next = stops.slice();
        next.splice(j, 0, { loc: rider.dropoff, type: 'dropoff', rider });
        next.splice(i, 0, { loc: rider.pickup, type: 'pickup', rider });
        const ev = evaluate(next, driver.departMin, driver.maxWait, driver.dow);
        const detour = ev.totalMin - directMin;
        if ((relaxed || (ev.ok && detour <= totalCap(driver) + 1e-9)) && (!best || detour < best.detour)) {
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
  function buildRoute(driver, accepted, relaxed) {
    let stops = baseStops(driver);
    for (const r of accepted) {
      const b = bestInsertion(stops, r, driver, relaxed);
      if (!b) return null;
      stops = b.stops;
    }
    return stops;
  }

  const compatible = (driverAccepts, riderPays) =>
    driverAccepts === 'either' || driverAccepts === riderPays;

  // Candidates who fit within the driver's max detour / max wait, given riders already accepted.
  // Three driver limits: how many pickups (maxPickups), the most extra minutes for ONE pickup (maxDetour),
  // and the most extra minutes for ALL pickups together (maxTotal).
  function findMatches(driver, riders, accepted) {
    if (driver.maxPickups != null && accepted.length >= driver.maxPickups) return [];
    const current = buildRoute(driver, accepted);
    if (!current) return [];
    const baseDetour = evaluate(current, driver.departMin, driver.maxWait, driver.dow).totalMin -
      minutes(driver.origin, driver.dest, driver.departMin, driver.dow);
    const out = [];
    for (const r of riders) {
      if (accepted.includes(r) || !compatible(driver.accepts, r.pays)) continue;
      const b = bestInsertion(current, r, driver);
      if (!b) continue;
      if (b.detour - baseDetour > driver.maxDetour + 1e-9) continue;   // this one pickup costs more time than the driver allows
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
    const total = Math.round(m);
    const h = Math.floor(total / 60) % 24, mm = total % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  const RS = { setTraffic, haversineKm, roadKm, minutes, evaluate, bestInsertion, buildRoute, findMatches,
    priceRoute, compatible, km, toPoints, money, clock, POINT_VALUE };
  if (typeof module !== 'undefined' && module.exports) module.exports = RS;
  else root.RS = RS;
})(typeof window !== 'undefined' ? window : globalThis);
