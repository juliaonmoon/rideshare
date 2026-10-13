// RideShare app logic: real sign-in, real trips and requests stored in Supabase.
// Only the public Project URL + publishable key (config.js) are used here. Never put a secret key in this repo.
// Maps and the moving car come from window.RS_UI (defined in index.html).
(function () {
  'use strict';
  const RS = window.RS, LOC = window.DEMO.locations, CFG = window.RS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hmIn = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const areas = Object.keys(LOC);
  const opts = (sel) => areas.map((a) => `<option ${a === sel ? 'selected' : ''}>${esc(a)}</option>`).join('');
  const H3 = 'font-size:14px;margin:14px 0 6px';
  const INPUT = 'width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit';
  const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
  const hint = '<div class="card"><p class="mut">Sign in at the top of the page to use RideShare.</p></div>';

  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    $('auth-bar').innerHTML = '<div class="card"><p class="mut">The app could not connect. Please reload the page.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  let user = null, me = { name: '', points: 0 }, myTrip = null, myReq = null, ledger = [], matches = [];
  let otherTrips = [], otherReqs = [], extraTrips = [], extraReqs = [], names = {}, timer = null, busy = false, formSig = '', mapSig = {};
  const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong');
  const nm = (id) => esc(names[id] || 'Someone');

  const driverObj = (t) => ({ origin: LOC[t.origin], dest: LOC[t.dest], departMin: t.depart_min, maxDetour: t.max_detour, maxWait: t.max_wait, accepts: t.accepts, cpk: Number(t.cost_per_km) || 0.2, name: names[t.user_id] || 'Driver' });
  const riderObj = (r) => ({ id: r.id, name: names[r.user_id] || 'Rider', pickup: LOC[r.pickup], dropoff: LOC[r.dropoff], readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];

  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      const [p, w, l, t, r, m, ot, orq] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('wallets').select('points').eq('user_id', uid).maybeSingle(),
        sb.from('ledger').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(10),
        sb.from('trips').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('ride_requests').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('matches').select('*').order('created_at', { ascending: false }).limit(30),
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

  // ---------- driver tab ----------
  function driverForm() {
    const t = myTrip || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: 10, max_wait: 5, accepts: 'either' };
    return card('My commute', `<label>From</label><select id="lt-o">${opts(t.origin)}</select><label>To</label><select id="lt-d">${opts(t.dest)}</select>
      <label>Leave at</label><input type="time" id="lt-t" value="${hmIn(t.depart_min)}">
      <label>Max detour (min)</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      <label>Max wait at a pickup (min)</label><input type="number" id="lt-w" min="0" max="60" value="${t.max_wait}">
      <label>I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      <div style="margin-top:10px"><button class="btn" id="lt-post">${myTrip ? 'Update my trip' : 'Post my trip'}</button> ${myTrip ? '<button class="btn ghost" id="lt-off">Take it down</button>' : ''}</div>`);
  }

  function driverLists() {
    if (!myTrip || !known(myTrip)) return card('Riders', '<p class="mut">Post your trip on the left to see riders along your route.</p>');
    const dr = driverObj(myTrip), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const inc = matches.filter((x) => x.driver_id === user.id && x.status === 'requested');
    const acc = matches.filter((x) => x.driver_id === user.id && x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    const accObjs = acc.map((x) => riderObj(reqById[x.request_id]));
    const stops = RS.buildRoute(dr, accObjs) || RS.buildRoute(dr, []);
    const waiting = otherReqs.filter(known).map(riderObj);
    const found = RS.findMatches(dr, waiting, accObjs);
    drawDriverMap(stops, waiting.filter((w) => !found.some((f) => f.rider.id === w.id)).concat([]), found);
    window.__ldStops = stops;
    const pr = RS.priceRoute(stops, dr.cpk), total = acc.length;
    const summary = card('Today\'s trip', `<div class="stat"><div><span class="mut">Cost if driving alone</span><b>${RS.money(RS.priceRoute(RS.buildRoute(dr, []), dr.cpk).total)}</b></div><div><span class="mut">Your share now</span><b>${RS.money(pr.driverShare)}</b></div></div>
      <p class="mut">${RS.km(stops).toFixed(1)} km total &middot; riders pay only their share, never more.</p>
      <button class="btn" id="ld-start">Start trip (watch the car move)</button> <button class="btn ghost" id="ld-stop">Stop</button>`);
    const reqs = card('Seat requests for you', inc.length ? inc.map((x) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b> <span class="mut">pays ${x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share'}</span>
        <div style="margin-top:6px"><button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button></div></div>`).join('') : '<p class="mut">None yet. Riders ask you for a seat; you accept here.</p>');
    const riding = card('Riding with me', total ? acc.map((x) => `<div>${nm(x.rider_id)} <span class="mut">(${x.pay_with === 'points' ? x.points + ' pts' : 'cash'})</span></div>`).join('') : '<p class="mut">No riders yet.</p>');
    const near = card('People who need a ride along your route', found.length ? found.map((m) => { const q = reqById[m.rider.id]; return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b>${nm(q.user_id)}</b> <span class="mut">${esc(q.pickup)} to ${esc(q.dropoff)} &middot; +${Math.round(m.addedDetour)} min detour &middot; pick up ${RS.clock(m.pickupAt)} &middot; drop ${RS.clock(m.dropAt)}</span></div>`; }).join('') : '<p class="mut">Nobody matching right now.</p>');
    return summary + reqs + riding + near;
  }

  function drawDriverMap(stops, grey) {
    const sig = routeSig(stops) + grey.map((g) => g.id).join(',');
    if (mapSig.d === sig) return; mapSig.d = sig;
    window.RS_UI.drawMap('map-ld', stops, grey.map((g) => ({ loc: g.pickup, label: g.name + ' (waiting)' })));
  }
  const routeSig = (stops) => stops.map((s) => s.loc.lat + ',' + s.loc.lng).join('|');

  // ---------- rider tab ----------
  function riderForm() {
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: 'points' };
    return card('My trip', `<label>Pick me up near</label><select id="lr-p">${opts(r.pickup)}</select><label>Drop me near</label><select id="lr-d">${opts(r.dropoff)}</select>
      <div class="row"><div><label>Ready from</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"></div><div><label>Ready until</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}"></div></div>
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="lr-post">${myReq ? 'Update my request' : 'Post my request'}</button> ${myReq ? '<button class="btn ghost" id="lr-off">Take it down</button>' : ''}</div>
      <div class="mut" style="margin-top:10px">Your points: <b>${me.points} pts</b></div>`);
  }

  function riderLists() {
    if (!myReq || !known(myReq)) return card('Drivers going your way', '<p class="mut">Post your request on the left to see drivers.</p>');
    const meO = riderObj(myReq), tripById = {}; [...otherTrips, ...extraTrips].forEach((t) => { tripById[t.id] = t; });
    const mine = matches.filter((x) => x.rider_id === user.id && x.request_id === myReq.id);
    const accepted = mine.find((x) => x.status === 'accepted'), accTrip = accepted && tripById[accepted.trip_id];
    let html = '', mapStops = [{ loc: meO.pickup, type: 'pickup', rider: meO }, { loc: meO.dropoff, type: 'dropoff', rider: meO }];
    if (accepted && accTrip && known(accTrip)) {
      const stops = RS.buildRoute(driverObj(accTrip), [meO]);
      if (stops) { mapStops = stops; window.__lrStops = stops; window.__lrDriver = names[accTrip.user_id] || 'Your driver'; window.__lrMe = meO; }
      html += card('Your ride', `<p><b>${nm(accTrip.user_id)}</b> accepted. You paid ${accepted.pay_with === 'points' ? accepted.points + ' pts' : 'cash gas-share (settle with your driver)'}.</p><button class="btn" id="lr-watch">Watch my ride</button> <button class="btn ghost" id="lr-stop">Stop</button>`);
    }
    let n = 0, list = '';
    otherTrips.filter(known).forEach((t) => {
      const dr = driverObj(t), found = RS.findMatches(dr, [meO], []); if (!found.length) return; n++;
      const m = found[0], dollars = RS.priceRoute(m.stops, dr.cpk).riderPay.get(meO) || 0, pts = RS.toPoints(dollars);
      const payWith = myReq.pays === 'either' ? (t.accepts === 'cash' ? 'cash' : 'points') : myReq.pays;
      if (!(t.accepts === 'either' || t.accepts === payWith)) { n--; return; }
      const st = mine.find((x) => x.trip_id === t.id);
      const price = payWith === 'points' ? pts + ' pts' : RS.money(dollars);
      const btn = st ? `<span class="tag">${esc(st.status)}</span>${st.status === 'requested' ? ` <button class="btn ghost" data-can="${st.id}">Cancel</button>` : ''}` : `<button class="btn" data-req="${t.id}" data-pay="${payWith}" data-pts="${pts}">Request &middot; ${price}</button>`;
      list += `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(t.user_id)}</b> <span class="mut">leaves ${RS.clock(t.depart_min)} &middot; picks you up ${RS.clock(m.pickupAt)} &middot; drops ${RS.clock(m.dropAt)} &middot; adds ${Math.round(m.addedDetour)} min for them</span><div style="margin-top:6px">${btn}</div></div>`;
    });
    html += card('Drivers going your way', n > 0 && list ? list : '<p class="mut">No drivers match right now. Check back soon.</p>');
    const sig = routeSig(mapStops); if (mapSig.r !== sig) { mapSig.r = sig; window.RS_UI.drawMap('map-lr', mapStops); }
    return html;
  }

  // ---------- points tab ----------
  function walletMain() {
    return card('Me', `<label>First name shown to others</label><input type="text" id="lv-name" maxlength="30" value="${esc(me.name)}" style="${INPUT}">
      <div style="margin-top:8px"><button class="btn ghost" id="lv-savename">Save name</button></div>
      <div class="stat" style="margin-top:12px"><div><span class="mut">Points balance</span><b>${me.points}</b></div><div><span class="mut">Value</span><b>1 pt = $0.10</b></div></div>
      <p class="mut">Earn points by driving riders who pay in points. Spend them when you ride. Points can't be cashed out or transferred, and they never exceed the real cost of the trip, so nobody profits.</p>`)
      + card('History', ledger.length ? ledger.map((x) => `<div style="padding:4px 0">${(x.delta > 0 ? '+' : '') + x.delta} pts <span class="mut">${esc(x.reason)}</span></div>`).join('') : '<p class="mut">Nothing yet.</p>');
  }

  // ---------- render + wiring ----------
  function render() {
    renderAuth();
    if (!user) { ['ld-form', 'ld-lists', 'lr-form', 'lr-lists', 'lw-main'].forEach((id) => { $(id).innerHTML = id.endsWith('form') || id === 'lw-main' ? hint : ''; }); return; }
    const sig = JSON.stringify([myTrip, myReq, me.points]);
    const typing = document.activeElement && /^(lt|lr|lv)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON';
    if (!typing && sig !== formSig) { formSig = sig; $('ld-form').innerHTML = driverForm(); $('lr-form').innerHTML = riderForm(); $('lw-main').innerHTML = walletMain(); }
    $('ld-lists').innerHTML = driverLists();
    $('lr-lists').innerHTML = riderLists();
    wire();
  }

  async function run(p, ok) { try { const r = await p; if (r.error) throw r.error; if (ok) toast(ok); } catch (e) { fail(e); } formSig = ''; await loadAll(); }

  function wire() {
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('lt-post', () => {
      const row = { origin: $('lt-o').value, dest: $('lt-d').value, depart_min: hm($('lt-t').value || '07:30'), max_detour: +$('lt-dt').value, max_wait: +$('lt-w').value, accepts: $('lt-a').value };
      if (row.origin === row.dest) { toast('Pick two different places'); return; }
      run(myTrip ? sb.from('trips').update(row).eq('id', myTrip.id) : sb.from('trips').insert(row), 'Trip saved');
    });
    on('lt-off', () => run(sb.from('trips').update({ active: false }).eq('id', myTrip.id), 'Trip taken down'));
    on('lr-post', () => {
      const row = { pickup: $('lr-p').value, dropoff: $('lr-d').value, ready_from: hm($('lr-f').value || '07:20'), ready_to: hm($('lr-u').value || '07:50'), pays: $('lr-pay').value };
      if (row.pickup === row.dropoff) { toast('Pick two different places'); return; }
      if (row.ready_to < row.ready_from) { toast('"Ready until" must be after "Ready from"'); return; }
      run(myReq ? sb.from('ride_requests').update(row).eq('id', myReq.id) : sb.from('ride_requests').insert(row), 'Request saved');
    });
    on('lr-off', () => run(sb.from('ride_requests').update({ active: false }).eq('id', myReq.id), 'Request taken down'));
    on('lv-savename', () => { const v = $('lv-name').value.trim(); if (!v) { toast('Enter a name'); return; } run(sb.from('profiles').update({ display_name: v }).eq('id', user.id), 'Name saved'); });
    on('ld-start', () => { if (window.__ldStops) window.RS_UI.startSim('ld', 'map-ld', window.__ldStops, 'You', 'driver'); });
    on('ld-stop', () => window.RS_UI.stopSim('ld'));
    on('lr-watch', () => { if (window.__lrStops) window.RS_UI.startSim('lr', 'map-lr', window.__lrStops, window.__lrDriver, 'rider', window.__lrMe); });
    on('lr-stop', () => window.RS_UI.stopSim('lr'));
    const each = (sel, fn) => document.querySelectorAll('#v-ldriver ' + sel + ', #v-lrider ' + sel).forEach((b) => (b.onclick = () => fn(b)));
    each('[data-req]', (b) => run(sb.rpc('request_seat', { p_trip: b.dataset.req, p_request: myReq.id, p_pay_with: b.dataset.pay, p_points: +b.dataset.pts }), 'Seat requested'));
    each('[data-can]', (b) => run(sb.rpc('cancel_match', { p_match: b.dataset.can }), 'Cancelled'));
    each('[data-acc]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.acc, p_accept: true }), 'Accepted'));
    each('[data-dec]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.dec, p_accept: false }), 'Declined'));
  }

  function start(session) {
    user = session ? session.user : null; clearInterval(timer); formSig = ''; mapSig = {};
    if (!user) { me = { name: '', points: 0 }; render(); return; }
    render(); loadAll(); timer = setInterval(() => { if (!document.hidden) loadAll(); }, 15000);
  }
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => start(session), 0));
  sb.auth.getSession().then(({ data }) => start(data.session));
  sb.channel('rs-matches').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadAll()).subscribe();

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
  window.addEventListener('rs-google-ready', () => { mapSig = {}; render(); if (lastPos) applyMe(false); });
  ['t-driver', 't-rider', 't-wallet'].forEach((id) => $(id).addEventListener('click', () => { mapSig = {}; render(); loadAll(); }));
})();
