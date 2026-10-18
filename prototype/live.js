// RideShare app logic: real sign-in, real trips and requests (with dates and weekly repeat) stored in Supabase.
// Only the public Project URL + publishable key (config.js) are used here. Never put a secret key in this repo.
// Maps and the moving car come from window.RS_UI (defined in index.html). Date helpers are in dates.js (window.RSD).
(function () {
  'use strict';
  const RS = window.RS, RSD = window.RSD, LOC = window.DEMO.locations, CFG = window.RS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hmIn = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const areas = Object.keys(LOC);
  const opts = (sel) => areas.map((a) => `<option ${a === sel ? 'selected' : ''}>${esc(a)}</option>`).join('');
  const INPUT = 'width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit';
  const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
  const hint = '<div class="card"><p class="mut">Sign in at the top of the page to use RideShare.</p></div>';
  const todayStr = () => RSD.today();
  const maxDate = () => RSD.addDays(todayStr(), RSD.MAX_AHEAD_DAYS);
  const dayChips = (id, sel) => `<div class="days" id="${id}">${RSD.DAY_NAMES.map((n, i) => `<button type="button" data-day="${i + 1}" class="${(sel || []).includes(i + 1) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const readDays = (id) => [...document.querySelectorAll('#' + id + ' button.on')].map((b) => +b.dataset.day);
  const whenText = (date, mins, days) => RSD.label(date) + ' at ' + RS.clock(mins) + (days && days.length ? ' &middot; repeats ' + RSD.repeatText(days) : ' &middot; one time');

  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    $('auth-bar').innerHTML = '<div class="card"><p class="mut">The app could not connect. Please reload the page.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  let user = null, me = { name: '', points: 0 }, myTrip = null, myReq = null, ledger = [], matches = [];
  let otherTrips = [], otherReqs = [], extraTrips = [], extraReqs = [], names = {}, timer = null, busy = false, formSig = '', mapSig = {};
  let pending = null, viewD = null, viewR = null, askCancel = null, rel = {};
  const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong');
  const nm = (id) => esc(names[id] || 'Someone');
  // Small warning next to a name when someone has recent cancellations (counts only, last 30 days).
  const badge = (id, role) => {
    const r = rel[id]; if (!r) return '';
    const bits = role === 'driver' ? (r.driver_cancels ? [r.driver_cancels + ' cancelled ride' + (r.driver_cancels > 1 ? 's' : '')] : [])
      : [r.late_cancels ? r.late_cancels + ' late cancel' + (r.late_cancels > 1 ? 's' : '') : '', r.no_shows ? r.no_shows + ' no-show' + (r.no_shows > 1 ? 's' : '') : ''].filter(Boolean);
    return bits.length ? ` <span class="tag" style="background:var(--warnbg);color:var(--warn)">${bits.join(', ')} (30 days)</span>` : '';
  };
  const who = (id, role) => nm(id) + badge(id, role);
  const LATE_MIN = 120;
  const tripBy = (id) => [...otherTrips, ...extraTrips, ...(myTrip ? [myTrip] : [])].find((t) => t.id === id);
  const pickupMs = (m) => { const t = tripBy(m.trip_id); return t ? RSD.vanEpoch(m.ride_date, t.depart_min) : null; };
  const lateUsedThisMonth = (excludeId) => matches.some((x) => x.rider_id === user.id && x.id !== excludeId && x.late && x.cancelled_by === user.id && x.cancelled_at && RSD.vanMonth(Date.parse(x.cancelled_at)) === RSD.vanMonth(Date.now()));
  // Plain-language result of cancelling this match now (mirrors the database rules).
  function cancelInfo(m) {
    const isRider = m.rider_id === user.id, pts = m.pay_with === 'points' ? m.points : 0;
    if (m.status === 'requested') return { ok: true, text: 'Free to cancel. No points have moved.' };
    if (!isRider) return { ok: true, text: 'If you cancel, ' + nm(m.rider_id) + ' gets ' + (pts ? 'all ' + pts + ' points' : 'nothing charged') + ' back. Cancelling often shows as a warning next to your name.' };
    const pk = pickupMs(m); if (pk == null) return { ok: true, text: 'Cancel this ride.' };
    if (Date.now() >= pk) return { ok: false, text: 'The pickup time has passed, so this ride can no longer be cancelled. Your driver can mark a no-show.' };
    const late = pk - Date.now() < LATE_MIN * 60000;
    if (!pts) return { ok: true, text: late ? 'Late cancel (within 2 hours). No points involved, but it counts toward your cancellation record.' : 'Free to cancel. No points involved.' };
    if (!late) return { ok: true, text: 'Free to cancel: you get all ' + pts + ' points back.' };
    if (!lateUsedThisMonth(m.id)) return { ok: true, text: 'This is a late cancel (within 2 hours), but your one free late cancel this month covers it: you get all ' + pts + ' points back.' };
    const keep = Math.floor(pts / 2);
    return { ok: true, text: 'Late cancel (within 2 hours) and your free one this month is used: your driver keeps ' + keep + ' points and you get ' + (pts - keep) + ' back.' };
  }
  const canNoShow = (m) => { const t = tripBy(m.trip_id), pk = pickupMs(m); return m.status === 'accepted' && m.driver_id === user.id && t && pk != null && Date.now() >= pk + t.max_wait * 60000; };
  const statusText = (s) => ({ requested: 'requested', accepted: 'accepted', completed: 'completed', cancelled: 'cancelled', declined: 'declined', no_show: 'no-show' }[s] || s);

  const driverObj = (t) => ({ origin: LOC[t.origin], dest: LOC[t.dest], departMin: t.depart_min, maxDetour: t.max_detour, maxWait: t.max_wait, accepts: t.accepts, cpk: Number(t.cost_per_km) || 0.2, name: names[t.user_id] || 'Driver' });
  const riderObj = (r) => ({ id: r.id, name: names[r.user_id] || 'Rider', pickup: LOC[r.pickup], dropoff: LOC[r.dropoff], readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];
  const tripOn = (t, d) => RSD.occursOn(t.trip_date, t.repeat_days, d);
  const reqOn = (r, d) => RSD.occursOn(r.ride_date, r.repeat_days, d);

  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      try { await sb.rpc('settle_due'); } catch (e) { /* older database: ignore */ }
      const [p, w, l, t, r, m, ot, orq] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('wallets').select('points').eq('user_id', uid).maybeSingle(),
        sb.from('ledger').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(10),
        sb.from('trips').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('ride_requests').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('matches').select('*').order('created_at', { ascending: false }).limit(60),
        sb.from('trips').select('*').eq('active', true).neq('user_id', uid).limit(100),
        sb.from('ride_requests').select('*').eq('active', true).neq('user_id', uid).limit(100),
      ]);
      me = { name: (p.data && p.data.display_name) || '', points: (w.data && w.data.points) || 0 };
      ledger = l.data || []; myTrip = (t.data || [])[0] || null; myReq = (r.data || [])[0] || null;
      matches = m.data || []; otherTrips = ot.data || []; otherReqs = orq.data || [];
      const tIds = [...new Set(matches.map((x) => x.trip_id))], rIds = [...new Set(matches.map((x) => x.request_id))];
      const [et, er] = await Promise.all([
        tIds.length ? sb.from('trips').select('*').in('id', tIds) : { data: [] },
        rIds.length ? sb.from('ride_requests').select('*').in('id', rIds) : { data: [] },
      ]);
      extraTrips = et.data || []; extraReqs = er.data || [];
      const ids = new Set([uid, ...otherTrips.map((x) => x.user_id), ...otherReqs.map((x) => x.user_id), ...extraTrips.map((x) => x.user_id), ...extraReqs.map((x) => x.user_id), ...matches.flatMap((x) => [x.driver_id, x.rider_id])]);
      const n = await sb.from('profiles').select('id,display_name').in('id', [...ids]);
      (n.data || []).forEach((x) => { names[x.id] = x.display_name; });
      const rl = await sb.from('reliability').select('*'); rel = {}; (rl.data || []).forEach((x) => { rel[x.user_id] = x; });
    } catch (e) { fail(e); } finally { busy = false; }
    render();
  }

  // ---------- sign in ----------
  function renderAuth() {
    const bar = $('auth-bar');
    if (user) {
      bar.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span>Signed in as <b>${esc(me.name || user.email)}</b> <span class="mut">&middot; ${me.points} pts</span></span><button class="btn ghost" id="lv-out">Sign out</button></div>`;
      $('lv-out').onclick = () => sb.auth.signOut();
      return;
    }
    bar.innerHTML = `<div class="card"><h2>Sign in</h2>
      <button class="btn" id="lv-google" style="width:100%;padding:12px;font-size:15px">Continue with Google</button>
      <p class="mut">Others only see your first name and neighbourhood-level areas. Or use an email link:</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="email" id="lv-email" autocomplete="email" placeholder="you@example.com" style="${INPUT};flex:1;min-width:200px"><button class="btn" id="lv-send">Email me a sign-in link</button></div>
      <p class="mut" id="lv-note"></p></div>`;
    $('lv-google').onclick = async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
      if (error) toast(error.message);
    };
    $('lv-send').onclick = async () => {
      const email = $('lv-email').value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Enter a valid email'); return; }
      $('lv-send').disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      $('lv-send').disabled = false;
      if (error) { toast(error.message); return; }
      $('lv-note').textContent = 'Check your email and click the link. It opens this page signed in. Open the link on the same device you want to use.';
    };
  }

  // ---------- date chips ----------
  function dateChips(id, dates, current) {
    if (!dates.length) return '<p class="mut">No upcoming dates in the next 30 days.</p>';
    return `<div class="days" id="${id}">${dates.map((d) => `<button type="button" data-date="${d}" class="${d === current ? 'on' : ''}">${esc(RSD.label(d))}</button>`).join('')}</div>`;
  }
  function pickView(cur, dates) { return dates.includes(cur) ? cur : dates[0] || null; }

  // ---------- driver tab ----------
  function driverForm() {
    if (pending && pending.kind === 'trip') {
      const r = pending.row;
      return card('Confirm your trip', `<p><b>${esc(r.origin)}</b> to <b>${esc(r.dest)}</b></p><p>${whenText(r.trip_date, r.depart_min, r.repeat_days)}</p>
        <p class="mut">Max detour ${r.max_detour} min &middot; max wait ${r.max_wait} min &middot; accepts ${r.accepts === 'either' ? 'points or cash' : r.accepts === 'points' ? 'points only' : 'cash gas-share only'}</p>
        <div style="margin-top:10px"><button class="btn" id="lt-confirm">${myTrip ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lt-back">Back</button></div>`);
    }
    const t = myTrip || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: 10, max_wait: 5, accepts: 'either', trip_date: todayStr(), repeat_days: [] };
    const date = t.trip_date < todayStr() ? todayStr() : t.trip_date;
    return card(myTrip ? 'My trip' : 'Post a trip', `<label>From</label><select id="lt-o">${opts(t.origin)}</select><label>To</label><select id="lt-d">${opts(t.dest)}</select>
      <div class="row"><div><label>Date</label><input type="date" id="lt-date" min="${todayStr()}" max="${maxDate()}" value="${date}"></div><div><label>Leave at</label><input type="time" id="lt-t" value="${hmIn(t.depart_min)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lt-days', t.repeat_days)}
      <label>Max detour (min)</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      <label>Max wait at a pickup (min)</label><input type="number" id="lt-w" min="0" max="60" value="${t.max_wait}">
      <label>I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      <div style="margin-top:10px"><button class="btn" id="lt-review">Review trip</button></div>`);
  }

  function driverLists() {
    if (!myTrip || !known(myTrip)) return card('Riders', '<p class="mut">Post your trip on the left to see riders along your route.</p>');
    const dates = RSD.nextOccurrences(myTrip.trip_date, myTrip.repeat_days, new Date(), 7);
    viewD = pickView(viewD, dates);
    const dr = driverObj(myTrip), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const dateCard = card('Date', dateChips('ld-dates', dates, viewD) + `<p class="mut" style="margin-top:8px">${whenText(myTrip.trip_date, myTrip.depart_min, myTrip.repeat_days)}</p>`);
    if (!viewD) return dateCard;
    const mine = matches.filter((x) => x.driver_id === user.id && x.ride_date === viewD);
    const inc = mine.filter((x) => x.status === 'requested');
    const acc = mine.filter((x) => x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    const accObjs = acc.map((x) => riderObj(reqById[x.request_id]));
    const stops = RS.buildRoute(dr, accObjs) || RS.buildRoute(dr, []);
    const waiting = otherReqs.filter((q) => known(q) && reqOn(q, viewD)).map(riderObj);
    const found = RS.findMatches(dr, waiting, accObjs);
    drawDriverMap(stops, waiting.filter((w) => !found.some((f) => f.rider.id === w.id)), viewD);
    window.__ldStops = stops;
    const pr = RS.priceRoute(stops, dr.cpk);
    const summary = card(RSD.label(viewD) + '\'s trip', `<div class="stat"><div><span class="mut">Cost if driving alone</span><b>${RS.money(RS.priceRoute(RS.buildRoute(dr, []), dr.cpk).total)}</b></div><div><span class="mut">Your share now</span><b>${RS.money(pr.driverShare)}</b></div></div>
      <p class="mut">${RS.km(stops).toFixed(1)} km total &middot; riders pay only their share, never more.</p>
      <button class="btn" id="ld-start">Start trip (watch the car move)</button> <button class="btn ghost" id="ld-stop">Stop</button>`);
    const reqs = card('Seat requests for you', inc.length ? inc.map((x) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b>${badge(x.rider_id, 'rider')} <span class="mut">pays ${x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share'}</span>
        <div style="margin-top:6px"><button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button></div></div>`).join('') : '<p class="mut">None yet. Riders ask you for a seat; you accept here.</p>');
    const riding = card('Riding with me', acc.length ? acc.map((x) => `<div style="padding:4px 0">${nm(x.rider_id)}${badge(x.rider_id, 'rider')} <span class="mut">(${x.pay_with === 'points' ? x.points + ' pts held until the ride' : 'cash'})</span>${canNoShow(x) ? ` <button class="btn ghost" data-noshow="${x.id}">Mark no-show</button>` : ''}</div>`).join('') : '<p class="mut">No riders yet.</p>');
    const near = card('People who need a ride along your route', found.length ? found.map((m) => { const q = reqById[m.rider.id]; return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b>${nm(q.user_id)}</b>${badge(q.user_id, 'rider')} <span class="mut">${esc(q.pickup)} to ${esc(q.dropoff)} &middot; +${Math.round(m.addedDetour)} min detour &middot; pick up ${RS.clock(m.pickupAt)} &middot; drop ${RS.clock(m.dropAt)}</span></div>`; }).join('') : '<p class="mut">Nobody matching on this date.</p>');
    return dateCard + summary + reqs + riding + near;
  }

  function drawDriverMap(stops, grey, date) {
    const sig = routeSig(stops) + grey.map((g) => g.id).join(',') + date;
    if (mapSig.d === sig) return; mapSig.d = sig;
    window.RS_UI.drawMap('map-ld', stops, grey.map((g) => ({ loc: g.pickup, label: g.name + ' (waiting)' })));
  }
  const routeSig = (stops) => stops.map((s) => s.loc.lat + ',' + s.loc.lng).join('|');

  // ---------- rider tab ----------
  function riderForm() {
    if (pending && pending.kind === 'req') {
      const r = pending.row;
      return card('Confirm your request', `<p><b>${esc(r.pickup)}</b> to <b>${esc(r.dropoff)}</b></p><p>${RSD.label(r.ride_date)}, ready ${RS.clock(r.ready_from)} to ${RS.clock(r.ready_to)}${r.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(r.repeat_days) : ' &middot; one time'}</p>
        <p class="mut">Paying with ${r.pays === 'either' ? 'points or cash' : r.pays === 'points' ? 'points' : 'cash gas-share'}</p>
        <div style="margin-top:10px"><button class="btn" id="lr-confirm">${myReq ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lr-back">Back</button></div>`);
    }
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: 'points', ride_date: todayStr(), repeat_days: [] };
    const date = r.ride_date < todayStr() ? todayStr() : r.ride_date;
    return card(myReq ? 'My ride' : 'Where to?', `<label>Pick me up near</label><select id="lr-p">${opts(r.pickup)}</select><label>Drop me near</label><select id="lr-d">${opts(r.dropoff)}</select>
      <label>Date</label><input type="date" id="lr-date" min="${todayStr()}" max="${maxDate()}" value="${date}">
      <div class="row"><div><label>Ready from</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"></div><div><label>Ready until</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lr-days', r.repeat_days)}
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="lr-review">Review request</button></div>
      <div class="mut" style="margin-top:10px">Your points: <b>${me.points} pts</b></div>`);
  }

  function riderLists() {
    if (!myReq || !known(myReq)) return card('Drivers going your way', '<p class="mut">Post your request on the left to see drivers.</p>');
    const dates = RSD.nextOccurrences(myReq.ride_date, myReq.repeat_days, new Date(), 7);
    viewR = pickView(viewR, dates);
    const dateCard = card('Date', dateChips('lr-dates', dates, viewR) + `<p class="mut" style="margin-top:8px">Ready ${RS.clock(myReq.ready_from)} to ${RS.clock(myReq.ready_to)}${myReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(myReq.repeat_days) : ' &middot; one time'}</p>`);
    if (!viewR) return dateCard;
    const meO = riderObj(myReq), tripById = {}; [...otherTrips, ...extraTrips].forEach((t) => { tripById[t.id] = t; });
    const mine = matches.filter((x) => x.rider_id === user.id && x.request_id === myReq.id && x.ride_date === viewR);
    const accepted = mine.find((x) => x.status === 'accepted'), accTrip = accepted && tripById[accepted.trip_id];
    let html = dateCard, mapStops = [{ loc: meO.pickup, type: 'pickup', rider: meO }, { loc: meO.dropoff, type: 'dropoff', rider: meO }];
    if (accepted && accTrip && known(accTrip)) {
      const stops = RS.buildRoute(driverObj(accTrip), [meO]);
      if (stops) { mapStops = stops; window.__lrStops = stops; window.__lrDriver = names[accTrip.user_id] || 'Your driver'; window.__lrMe = meO; }
      html += card('Your ride', `<p><b>${nm(accTrip.user_id)}</b> accepted for ${esc(RSD.label(viewR))}. You paid ${accepted.pay_with === 'points' ? accepted.points + ' pts' : 'cash gas-share (settle with your driver)'}.</p><button class="btn" id="lr-watch">Watch my ride</button> <button class="btn ghost" id="lr-stop">Stop</button><p class="mut" style="margin-top:8px">To cancel, open the Upcoming tab. Your points are held until the ride and refunded if you cancel in time.</p>`);
    }
    let list = '';
    otherTrips.filter((t) => known(t) && tripOn(t, viewR)).forEach((t) => {
      const dr = driverObj(t), found = RS.findMatches(dr, [meO], []); if (!found.length) return;
      const m = found[0], dollars = RS.priceRoute(m.stops, dr.cpk).riderPay.get(meO) || 0, pts = RS.toPoints(dollars);
      const payWith = myReq.pays === 'either' ? (t.accepts === 'cash' ? 'cash' : 'points') : myReq.pays;
      if (!(t.accepts === 'either' || t.accepts === payWith)) return;
      const st = mine.find((x) => x.trip_id === t.id);
      const price = payWith === 'points' ? pts + ' pts' : RS.money(dollars);
      const btn = st ? `<span class="tag">${esc(statusText(st.status))}</span>${st.status === 'requested' ? ` <button class="btn ghost" data-can="${st.id}">Cancel</button>` : ''}` : `<button class="btn" data-req="${t.id}" data-pay="${payWith}" data-pts="${pts}" data-date="${viewR}">Request &middot; ${price}</button>`;
      list += `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(t.user_id)}</b>${badge(t.user_id, 'driver')} <span class="mut">leaves ${RS.clock(t.depart_min)} &middot; picks you up ${RS.clock(m.pickupAt)} &middot; drops ${RS.clock(m.dropAt)} &middot; adds ${Math.round(m.addedDetour)} min for them</span><div style="margin-top:6px">${btn}</div></div>`;
    });
    html += card('Drivers going your way on ' + esc(RSD.label(viewR)), list || '<p class="mut">No drivers match on this date. Check back soon.</p>');
    const sig = routeSig(mapStops) + viewR; if (mapSig.r !== sig) { mapSig.r = sig; window.RS_UI.drawMap('map-lr', mapStops); }
    return html;
  }

  // ---------- upcoming tab ----------
  function upcomingMain() {
    const t0 = todayStr(), tripById = {}, reqById = {};
    [...otherTrips, ...extraTrips].concat(myTrip ? [myTrip] : []).forEach((t) => { tripById[t.id] = t; });
    [...otherReqs, ...extraReqs].concat(myReq ? [myReq] : []).forEach((q) => { reqById[q.id] = q; });
    const mineTrip = myTrip ? `<div style="padding:6px 0"><b>${esc(myTrip.origin)} to ${esc(myTrip.dest)}</b><div class="mut">${whenText(myTrip.trip_date, myTrip.depart_min, myTrip.repeat_days)}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-driver">Edit</button> <button class="btn ghost" data-offtrip="${myTrip.id}">Take it down</button></div></div>` : '<p class="mut">No trip posted. Use <b>I\'m driving</b>.</p>';
    const mineReq = myReq ? `<div style="padding:6px 0"><b>${esc(myReq.pickup)} to ${esc(myReq.dropoff)}</b><div class="mut">${esc(RSD.label(myReq.ride_date))}, ready ${RS.clock(myReq.ready_from)} to ${RS.clock(myReq.ready_to)}${myReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(myReq.repeat_days) : ' &middot; one time'}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-rider">Edit</button> <button class="btn ghost" data-offreq="${myReq.id}">Take it down</button></div></div>` : '<p class="mut">No ride requested. Use <b>I need a ride</b>.</p>';
    const live = matches.filter((x) => (x.status === 'requested' || x.status === 'accepted') && x.ride_date >= t0).sort((a, b) => (a.ride_date < b.ride_date ? -1 : 1));
    const asRider = live.filter((x) => x.rider_id === user.id), asDriver = live.filter((x) => x.driver_id === user.id);
    const when = (x) => { const t = tripBy(x.trip_id); return esc(RSD.label(x.ride_date)) + (t ? ' at ' + RS.clock(t.depart_min) : ''); };
    const row = (x, isRider) => {
      const other = isRider ? x.driver_id : x.rider_id, pay = x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share';
      let actions = '';
      if (askCancel === x.id) {
        const ci = cancelInfo(x);
        actions = `<div class="open" style="margin-top:6px">${esc(ci.text)}</div><div style="margin-top:6px">${ci.ok ? `<button class="btn" data-cancelgo="${x.id}">Yes, cancel ride</button> ` : ''}<button class="btn ghost" data-cancelno="1">Keep ride</button></div>`;
      } else {
        const b = [];
        if (!isRider && x.status === 'requested') b.push(`<button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button>`);
        if (canNoShow(x)) b.push(`<button class="btn ghost" data-noshow="${x.id}">Mark no-show</button>`);
        if (isRider || x.status === 'accepted') b.push(`<button class="btn ghost" data-cancelask="${x.id}">${x.status === 'requested' ? 'Cancel request' : 'Cancel ride'}</button>`);
        actions = b.length ? `<div style="margin-top:6px">${b.join(' ')}</div>` : '';
      }
      const held = x.status === 'accepted' && x.pay_with === 'points' && !x.settled ? ' (held until the ride)' : '';
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${when(x)}</b> <span class="tag">${esc(statusText(x.status))}</span><div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(other)}${badge(other, isRider ? 'driver' : 'rider')} &middot; ${pay}${held}</div>${actions}</div>`;
    };
    const riderRows = asRider.length ? asRider.map((x) => row(x, true)).join('') : '<p class="mut">No upcoming rides.</p>';
    const driverRows = asDriver.length ? asDriver.map((x) => row(x, false)).join('') : '<p class="mut">No upcoming passengers.</p>';
    const past = matches.filter((x) => ['completed', 'cancelled', 'no_show', 'declined'].includes(x.status)).slice(0, 8);
    const pastRows = past.length ? past.map((x) => { const isRider = x.rider_id === user.id; return `<div style="padding:6px 0;border-top:1px solid var(--line)">${when(x)} <span class="tag">${esc(statusText(x.status))}</span><div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(isRider ? x.driver_id : x.rider_id)} &middot; ${x.pay_with === 'points' ? x.points + ' pts' : 'cash'}${x.refunded ? ' &middot; ' + x.refunded + ' pts returned' : ''}</div></div>`; }).join('') : '<p class="mut">Nothing yet.</p>';
    const policy = `<p class="mut">Points are held when a driver accepts, and paid to the driver after the ride.</p>
      <ul class="mut" style="margin:6px 0 0 18px;padding:0"><li>Cancel more than 2 hours before pickup: all points back.</li><li>Cancel within 2 hours: your first one each month is free; after that the driver keeps half.</li><li>You can't cancel after the pickup time. If a rider doesn't show, the driver can mark a no-show after waiting.</li><li>If a driver cancels, the rider gets all points back.</li><li>Cash rides: no points move.</li></ul>`;
    return card('My trip', mineTrip) + card('My ride request', mineReq) + card('Upcoming rides (as a rider)', riderRows) + card('Upcoming passengers (as a driver)', driverRows) + card('Recent', pastRows) + card('Cancellation rules', policy);
  }

  // ---------- points tab ----------
  function walletMain() {
    const sum = (list) => list.reduce((a, x) => a + x.points, 0), heldList = matches.filter((x) => x.status === 'accepted' && !x.settled && x.pay_with === 'points');
    const heldAsRider = sum(heldList.filter((x) => x.rider_id === user.id)), pendingAsDriver = sum(heldList.filter((x) => x.driver_id === user.id));
    return card('Me', `<label>First name shown to others</label><input type="text" id="lv-name" maxlength="30" value="${esc(me.name)}" style="${INPUT}">
      <div style="margin-top:8px"><button class="btn ghost" id="lv-savename">Save name</button></div>
      <div class="stat" style="margin-top:12px"><div><span class="mut">Points balance</span><b>${me.points}</b></div><div><span class="mut">On hold (your rides)</span><b>${heldAsRider}</b></div><div><span class="mut">Coming to you</span><b>${pendingAsDriver}</b></div><div><span class="mut">Value</span><b>1 pt = $0.10</b></div></div>
      <p class="mut">Earn points by driving riders who pay in points. Spend them when you ride. Points can't be cashed out or transferred, and they never exceed the real cost of the trip, so nobody profits.</p>`)
      + card('Track yourself', '<p class="mut">Walk or drive and watch yourself move on the map, with speed, distance and a trail. Your location stays on this device.</p><a class="btn" href="gps.html" style="display:inline-block;text-decoration:none">Open GPS test</a>')
      + card('History', ledger.length ? ledger.map((x) => `<div style="padding:4px 0">${(x.delta > 0 ? '+' : '') + x.delta} pts <span class="mut">${esc(x.reason)}</span></div>`).join('') : '<p class="mut">Nothing yet.</p>');
  }

  // ---------- render + wiring ----------
  function render() {
    renderAuth();
    if (!user) { ['ld-form', 'ld-lists', 'lr-form', 'lr-lists', 'lu-main', 'lw-main'].forEach((id) => { $(id).innerHTML = /form|main/.test(id) ? hint : ''; }); return; }
    const sig = JSON.stringify([myTrip, myReq, me.points, pending]);
    const typing = document.activeElement && /^(lt|lr|lv)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON' && !pending;
    if (!typing && sig !== formSig) { formSig = sig; $('ld-form').innerHTML = driverForm(); $('lr-form').innerHTML = riderForm(); $('lw-main').innerHTML = walletMain(); }
    $('ld-lists').innerHTML = driverLists();
    $('lr-lists').innerHTML = riderLists();
    $('lu-main').innerHTML = upcomingMain();
    wire();
  }

  async function run(p, ok) { try { const r = await p; if (r.error) throw r.error; if (ok) toast(ok); return true; } catch (e) { fail(e); return false; } finally { formSig = ''; await loadAll(); } }

  function wire() {
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    document.querySelectorAll('#lt-days button, #lr-days button').forEach((b) => (b.onclick = () => b.classList.toggle('on')));
    on('lt-review', () => {
      const row = { origin: $('lt-o').value, dest: $('lt-d').value, trip_date: $('lt-date').value, depart_min: hm($('lt-t').value || '07:30'), repeat_days: readDays('lt-days'), max_detour: +$('lt-dt').value, max_wait: +$('lt-w').value, accepts: $('lt-a').value };
      if (row.origin === row.dest) { toast('Pick two different places'); return; }
      const bad = RSD.check(row.trip_date, row.depart_min); if (bad) { toast(bad); return; }
      pending = { kind: 'trip', row }; formSig = ''; render();
    });
    on('lt-back', () => { pending = null; formSig = ''; render(); });
    on('lt-confirm', async () => {
      const row = pending.row; const ok = await run(myTrip ? sb.from('trips').update(row).eq('id', myTrip.id) : sb.from('trips').insert(row), 'Trip saved');
      if (ok) { pending = null; viewD = null; mapSig = {}; formSig = ''; render(); }
    });
    on('lr-review', () => {
      const row = { pickup: $('lr-p').value, dropoff: $('lr-d').value, ride_date: $('lr-date').value, ready_from: hm($('lr-f').value || '07:20'), ready_to: hm($('lr-u').value || '07:50'), repeat_days: readDays('lr-days'), pays: $('lr-pay').value };
      if (row.pickup === row.dropoff) { toast('Pick two different places'); return; }
      if (row.ready_to < row.ready_from) { toast('"Ready until" must be after "Ready from"'); return; }
      const bad = RSD.check(row.ride_date, row.ready_from); if (bad) { toast(bad); return; }
      pending = { kind: 'req', row }; formSig = ''; render();
    });
    on('lr-back', () => { pending = null; formSig = ''; render(); });
    on('lr-confirm', async () => {
      const row = pending.row; const ok = await run(myReq ? sb.from('ride_requests').update(row).eq('id', myReq.id) : sb.from('ride_requests').insert(row), 'Request saved');
      if (ok) { pending = null; viewR = null; mapSig = {}; formSig = ''; render(); }
    });
    on('lv-savename', () => { const v = $('lv-name').value.trim(); if (!v) { toast('Enter a name'); return; } run(sb.from('profiles').update({ display_name: v }).eq('id', user.id), 'Name saved'); });
    on('ld-start', () => { if (window.__ldStops) window.RS_UI.startSim('ld', 'map-ld', window.__ldStops, 'You', 'driver'); });
    on('ld-stop', () => window.RS_UI.stopSim('ld'));
    on('lr-watch', () => { if (window.__lrStops) window.RS_UI.startSim('lr', 'map-lr', window.__lrStops, window.__lrDriver, 'rider', window.__lrMe); });
    on('lr-stop', () => window.RS_UI.stopSim('lr'));
    const each = (sel, fn) => document.querySelectorAll(['#v-ldriver', '#v-lrider', '#v-lupcoming'].map((r) => r + ' ' + sel).join(', ')).forEach((b) => (b.onclick = () => fn(b)));
    each('#ld-dates button', (b) => { viewD = b.dataset.date; mapSig = {}; render(); });
    each('#lr-dates button', (b) => { viewR = b.dataset.date; mapSig = {}; render(); });
    each('[data-req]', (b) => run(sb.rpc('request_seat', { p_trip: b.dataset.req, p_request: myReq.id, p_pay_with: b.dataset.pay, p_points: +b.dataset.pts, p_date: b.dataset.date }), 'Seat requested'));
    each('[data-can]', (b) => run(sb.rpc('cancel_ride', { p_match: b.dataset.can }), 'Cancelled'));
    each('[data-cancelask]', (b) => { askCancel = b.dataset.cancelask; render(); });
    each('[data-cancelno]', () => { askCancel = null; render(); });
    each('[data-cancelgo]', (b) => { askCancel = null; run(sb.rpc('cancel_ride', { p_match: b.dataset.cancelgo }), 'Ride cancelled. See your points history for any refund.'); });
    each('[data-noshow]', (b) => run(sb.rpc('mark_no_show', { p_match: b.dataset.noshow }), 'Marked as a no-show. You keep the points.'));
    each('[data-acc]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.acc, p_accept: true }), 'Accepted'));
    each('[data-dec]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.dec, p_accept: false }), 'Declined'));
    each('[data-offtrip]', (b) => run(sb.from('trips').update({ active: false }).eq('id', b.dataset.offtrip), 'Trip taken down'));
    each('[data-offreq]', (b) => run(sb.from('ride_requests').update({ active: false }).eq('id', b.dataset.offreq), 'Request taken down'));
    each('[data-go]', (b) => $(b.dataset.go).click());
  }

  // ---------- show my location (phone/computer GPS; stays on this device) ----------
  let watchId = null, lastPos = null;
  const locBtns = () => ['loc-ld', 'loc-lr'].map($).filter(Boolean);
  const setLocLabel = (t) => locBtns().forEach((b) => { b.textContent = t; });
  const applyMe = (center) => ['map-ld', 'map-lr'].forEach((id) => window.RS_UI.setMe(id, lastPos, center));
  function toggleLocate() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; lastPos = null; applyMe(false); setLocLabel('Show my location'); return; }
    if (!navigator.geolocation) { toast('This device cannot share its location'); return; }
    setLocLabel('Finding you...'); let first = true;
    watchId = navigator.geolocation.watchPosition((p) => {
      lastPos = { lat: p.coords.latitude, lng: p.coords.longitude }; applyMe(first); first = false; setLocLabel('Stop showing my location');
    }, (err) => {
      watchId = null; lastPos = null; setLocLabel('Show my location');
      toast(err && err.code === 1 ? 'Location is blocked. Allow it in your browser settings.' : 'Could not find your location');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  locBtns().forEach((b) => (b.onclick = toggleLocate));

  function start(session) {
    user = session ? session.user : null; clearInterval(timer); formSig = ''; mapSig = {}; pending = null; viewD = null; viewR = null; askCancel = null;
    if (!user) { me = { name: '', points: 0 }; render(); return; }
    render(); loadAll(); timer = setInterval(() => { if (!document.hidden) loadAll(); }, 15000);
  }
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => start(session), 0));
  sb.auth.getSession().then(({ data }) => start(data.session));
  sb.channel('rs-matches').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadAll()).subscribe();
  window.addEventListener('rs-google-ready', () => { mapSig = {}; render(); if (lastPos) applyMe(false); });
  ['t-driver', 't-rider', 't-upcoming', 't-wallet'].forEach((id) => $(id).addEventListener('click', () => { mapSig = {}; render(); loadAll(); }));
})();
