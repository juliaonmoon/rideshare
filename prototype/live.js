// Live mode (beta): real sign-in, real trips and requests, stored in Supabase. The demo tabs are unaffected.
// Only the public Project URL + publishable key (config.js) are used here. Never put a secret key in this repo.
(function () {
  'use strict';
  const RS = window.RS, LOC = window.DEMO.locations, CFG = window.RS_CONFIG || {};
  const root = document.getElementById('live-root');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hmIn = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const areas = Object.keys(LOC);
  const opts = (sel) => areas.map((a) => `<option ${a === sel ? 'selected' : ''}>${esc(a)}</option>`).join('');

  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    root.innerHTML = '<div class="card"><h2>Live mode</h2><p class="mut">Live mode is not set up on this page.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  let user = null, me = { name: '', points: 0 }, myTrip = null, myReq = null, names = {}, ledger = [], matches = [], timer = null, busy = false;

  const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong');

  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      const [p, w, l, t, r, m] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('wallets').select('points').eq('user_id', uid).maybeSingle(),
        sb.from('ledger').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(10),
        sb.from('trips').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('ride_requests').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        sb.from('matches').select('*').order('created_at', { ascending: false }).limit(30),
      ]);
      me = { name: (p.data && p.data.display_name) || '', points: (w.data && w.data.points) || 0 };
      ledger = l.data || []; myTrip = (t.data || [])[0] || null; myReq = (r.data || [])[0] || null; matches = m.data || [];
      const [allTrips, allReqs] = await Promise.all([
        sb.from('trips').select('*').eq('active', true).neq('user_id', uid).limit(100),
        sb.from('ride_requests').select('*').eq('active', true).neq('user_id', uid).limit(100),
      ]);
      loadAll.trips = allTrips.data || []; loadAll.reqs = allReqs.data || [];
      const ids = new Set([...loadAll.trips.map((x) => x.user_id), ...loadAll.reqs.map((x) => x.user_id), ...matches.flatMap((x) => [x.driver_id, x.rider_id])]);
      if (ids.size) { const n = await sb.from('profiles').select('id,display_name').in('id', [...ids]); (n.data || []).forEach((x) => { names[x.id] = x.display_name; }); }
    } catch (e) { fail(e); } finally { busy = false; }
    render();
  }

  const nm = (id) => esc(names[id] || 'Someone');
  const driverObj = (t) => ({ origin: LOC[t.origin], dest: LOC[t.dest], departMin: t.depart_min, maxDetour: t.max_detour, maxWait: t.max_wait, accepts: t.accepts });
  const riderObj = (r) => ({ id: r.id, pickup: LOC[r.pickup], dropoff: LOC[r.dropoff], readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];
  const stateOf = (tripId, reqId) => matches.find((x) => x.trip_id === tripId && x.request_id === reqId);

  function signedOut() {
    root.innerHTML = `<div class="card"><h2>Live mode (beta)</h2>
      <p class="mut">Sign in to post a real trip or ask for a real ride. We email you a one-time link. No password. Only your first name and neighbourhood-level areas are shown to others.</p>
      <label for="lv-email">Email</label><input type="email" id="lv-email" autocomplete="email" placeholder="you@example.com" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit">
      <div style="margin-top:8px"><button class="btn" id="lv-send">Email me a sign-in link</button></div>
      <p class="mut" id="lv-note"></p></div>`;
    $('lv-send').onclick = async () => {
      const email = $('lv-email').value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Enter a valid email'); return; }
      $('lv-send').disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      $('lv-send').disabled = false;
      if (error) { toast(error.message); return; }
      $('lv-note').textContent = 'Check your email and click the link. It opens this page signed in.';
    };
  }

  function section(title, body) { return `<div class="card"><h2>${title}</h2>${body}</div>`; }

  function driverCard() {
    const t = myTrip || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: 10, max_wait: 5, accepts: 'either', cost_per_km: 0.2 };
    const form = `<label>From</label><select id="lt-o">${opts(t.origin)}</select><label>To</label><select id="lt-d">${opts(t.dest)}</select>
      <label>Leave at</label><input type="time" id="lt-t" value="${hmIn(t.depart_min)}">
      <label>Max detour (min)</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      <label>Max wait at a pickup (min)</label><input type="number" id="lt-w" min="0" max="60" value="${t.max_wait}">
      <label>I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      <div style="margin-top:8px"><button class="btn" id="lt-post">${myTrip ? 'Update my trip' : 'Post my trip'}</button> ${myTrip ? '<button class="btn ghost" id="lt-off">Take it down</button>' : ''}</div>`;
    let list = '';
    if (myTrip && known(myTrip)) {
      const dr = driverObj(myTrip), inc = matches.filter((x) => x.driver_id === user.id && x.status === 'requested');
      list += '<h3 style="font-size:14px;margin:14px 0 6px">Seat requests for you</h3>' + (inc.length ? inc.map((x) => `<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b> <span class="mut">pays ${x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share'}</span>
        <div style="margin-top:6px"><button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button></div></div>`).join('') : '<p class="mut">None yet.</p>');
      const acc = matches.filter((x) => x.driver_id === user.id && x.status === 'accepted');
      if (acc.length) list += '<h3 style="font-size:14px;margin:14px 0 6px">Riding with you</h3>' + acc.map((x) => `<div>${nm(x.rider_id)} <span class="mut">(${x.pay_with === 'points' ? x.points + ' pts' : 'cash'})</span></div>`).join('');
      const riders = loadAll.reqs.filter(known).map(riderObj);
      const found = RS.findMatches(dr, riders, []);
      const byId = {}; loadAll.reqs.forEach((q) => { byId[q.id] = q; });
      list += '<h3 style="font-size:14px;margin:14px 0 6px">People who need a ride along your route</h3>' + (found.length ? found.map((m) => { const q = byId[m.rider.id]; return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b>${nm(q.user_id)}</b> <span class="mut">${esc(q.pickup)} to ${esc(q.dropoff)} &middot; +${Math.round(m.addedDetour)} min &middot; pick up ${RS.clock(m.pickupAt)}</span></div>`; }).join('') + '<p class="mut">They ask you for a seat. You accept above.</p>' : '<p class="mut">Nobody matching right now.</p>');
    }
    return section('I\'m driving', form + list);
  }

  function riderCard() {
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: 'points' };
    const form = `<label>Pick me up near</label><select id="lr-p">${opts(r.pickup)}</select><label>Drop me near</label><select id="lr-d">${opts(r.dropoff)}</select>
      <label>Ready from</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"><label>Ready until</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}">
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:8px"><button class="btn" id="lr-post">${myReq ? 'Update my request' : 'Post my request'}</button> ${myReq ? '<button class="btn ghost" id="lr-off">Take it down</button>' : ''}</div>`;
    let list = '';
    if (myReq && known(myReq)) {
      const me_ = riderObj(myReq); let n = 0;
      list += '<h3 style="font-size:14px;margin:14px 0 6px">Drivers going your way</h3>';
      loadAll.trips.filter(known).forEach((t) => {
        const dr = driverObj(t), found = RS.findMatches(dr, [me_], []);
        if (!found.length) return; n++;
        const m = found[0], dollars = RS.priceRoute(m.stops, 0.2).riderPay.get(me_) || 0, pts = RS.toPoints(dollars);
        const payWith = myReq.pays === 'either' ? (t.accepts === 'cash' ? 'cash' : 'points') : myReq.pays;
        const st = stateOf(t.id, myReq.id);
        const price = payWith === 'points' ? pts + ' pts' : RS.money(dollars);
        const btn = st ? `<span class="mut">${esc(st.status)}</span>${st.status === 'requested' ? ` <button class="btn ghost" data-can="${st.id}">Cancel</button>` : ''}` : `<button class="btn" data-req="${t.id}" data-pay="${payWith}" data-pts="${pts}">Request ${price}</button>`;
        list += `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(t.user_id)}</b> <span class="mut">leaves ${RS.clock(t.depart_min)} &middot; picks you up ${RS.clock(m.pickupAt)} &middot; drops ${RS.clock(m.dropAt)} &middot; adds ${Math.round(m.addedDetour)} min for them</span><div style="margin-top:6px">${btn}</div></div>`;
      });
      if (!n) list += '<p class="mut">No drivers match right now. Check back soon.</p>';
    }
    return section('I need a ride', form + list);
  }

  function walletCard() {
    return section('Me', `<p><b>${esc(me.name)}</b> <span class="mut">(${esc(user.email)})</span></p>
      <label>First name shown to others</label><input type="text" id="lv-name" maxlength="30" value="${esc(me.name)}" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit">
      <div style="margin-top:8px"><button class="btn ghost" id="lv-savename">Save name</button> <button class="btn ghost" id="lv-out">Sign out</button></div>
      <p style="margin-top:12px"><span class="mut">Points balance</span> <b>${me.points} pts</b> <span class="mut">(1 pt = $0.10)</span></p>
      ${ledger.length ? '<div class="mut">' + ledger.map((x) => `${(x.delta > 0 ? '+' : '') + x.delta} ${esc(x.reason)}`).join('<br>') + '</div>' : ''}`);
  }

  function render() {
    if (!user) { signedOut(); return; }
    if (document.activeElement && /^(lt|lr|lv)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON') return; // don't wipe typing
    root.innerHTML = driverCard() + riderCard() + walletCard();
    wire();
  }

  async function run(p, ok) { try { const r = await p; if (r.error) throw r.error; if (ok) toast(ok); } catch (e) { fail(e); } await loadAll(); }

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
    on('lv-out', async () => { await sb.auth.signOut(); });
    on('lv-savename', () => { const v = $('lv-name').value.trim(); if (!v) { toast('Enter a name'); return; } run(sb.from('profiles').update({ display_name: v }).eq('id', user.id), 'Name saved'); });
    root.querySelectorAll('[data-req]').forEach((b) => (b.onclick = () => run(sb.rpc('request_seat', { p_trip: b.dataset.req, p_request: myReq.id, p_pay_with: b.dataset.pay, p_points: +b.dataset.pts }), 'Seat requested')));
    root.querySelectorAll('[data-can]').forEach((b) => (b.onclick = () => run(sb.rpc('cancel_match', { p_match: b.dataset.can }), 'Cancelled')));
    root.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => run(sb.rpc('respond_match', { p_match: b.dataset.acc, p_accept: true }), 'Accepted')));
    root.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => run(sb.rpc('respond_match', { p_match: b.dataset.dec, p_accept: false }), 'Declined')));
  }

  function start(session) {
    user = session ? session.user : null;
    clearInterval(timer);
    if (!user) { signedOut(); return; }
    loadAll(); timer = setInterval(() => { if (!document.hidden && !$('v-live').classList.contains('hide')) loadAll(); }, 15000);
  }
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => start(session), 0));
  sb.auth.getSession().then(({ data }) => start(data.session));
  sb.channel('rs-matches').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadAll()).subscribe();
  const tab = $('t-live'); if (tab) tab.addEventListener('click', () => loadAll());
})();
