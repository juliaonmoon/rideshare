// RideShare app logic: real sign-in, real trips and requests (with dates and weekly repeat) stored in Supabase.
// Only the public Project URL + publishable key (config.js) are used here. Never put a secret key in this repo.
// Maps and the moving car come from window.RS_UI (defined in index.html). Date helpers are in dates.js (window.RSD).
(function () {
  'use strict';
  const RS = window.RS, RSD = window.RSD, LOC = window.DEMO.locations, CFG = window.RS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); };
  // Clear message right under a form button (the toast alone is easy to miss on a phone).
  const formMsg = (id, text) => { const e = $(id); if (e) { e.textContent = text || ''; if (text) { try { e.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {} } } if (text) toast(text); };
  // If anything breaks, show it on the page (phones have no console) so it can be reported.
  function showErr(msg) {
    let b = $('err-bar');
    if (!b) { b = document.createElement('div'); b.id = 'err-bar'; b.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99;background:#b42318;color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3)'; document.body.appendChild(b); }
    b.innerHTML = 'Something went wrong: ' + esc(String(msg).slice(0, 160)) + ' <button type="button" id="err-x" style="margin-left:8px;background:#fff;color:#b42318;border:0;border-radius:6px;padding:2px 8px">Dismiss</button>';
    $('err-x').onclick = () => b.remove();
  }
  window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver/.test(e.message)) showErr(e.message); });
  window.addEventListener('unhandledrejection', (e) => showErr((e.reason && e.reason.message) || e.reason || 'unknown error'));
  const guard = (label, fn) => { try { return fn(); } catch (e) { console.error(label, e); showErr(label + ': ' + (e && e.message || e)); return '<div class="card"><p class="mut">This part could not load. Pull to refresh or try again.</p></div>'; } };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hmIn = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const areas = Object.keys(LOC);
  const opts = (sel) => areas.map((a) => `<option ${a === sel ? 'selected' : ''}>${esc(a)}</option>`).join('');
  const INPUT = 'width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit';
  const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
  const hint = '<div class="card"><p class="mut">Sign in at the top of the page to use RideShare.</p></div>';
  const todayStr = () => RSD.today();
  // Default date for a form: the saved date, but never in the past, and if today's time has already passed (or is under 30 minutes away) use tomorrow.
  const defaultDate = (saved, minutes) => { let d = !saved || saved < todayStr() ? todayStr() : saved; if (d === todayStr() && RSD.check(d, minutes)) d = RSD.addDays(todayStr(), 1); return d; };
  const maxDate = () => RSD.addDays(todayStr(), RSD.MAX_AHEAD_DAYS);
  const dayChips = (id, sel) => `<div class="days" id="${id}">${RSD.DAY_NAMES.map((n, i) => `<button type="button" data-day="${i + 1}" class="${(sel || []).includes(i + 1) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const readDays = (id) => [...document.querySelectorAll('#' + id + ' button.on')].map((b) => +b.dataset.day);
  const whenText = (date, mins, days) => RSD.label(date) + ' at ' + RS.clock(mins) + (days && days.length ? ' &middot; repeats ' + RSD.repeatText(days) : ' &middot; one time');

  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    $('auth-bar').innerHTML = '<div class="card"><p class="mut">The app could not connect. Please reload the page.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  // Android app: sign-in happens in a Chrome tab and returns here through this link (it must also be listed in Supabase > Authentication > URL Configuration > Redirect URLs).
  const APP_AUTH = 'ca.rideshare.app://auth';
  const nativePlug = (n) => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;
  if (nativePlug('App')) {
    nativePlug('App').addListener('appUrlOpen', async (ev) => {
      if (ev && ev.url && ev.url.indexOf('ca.rideshare.app://plan') === 0) {   // the Preview trip alert: open Home on the trip plan
        await loadAll(); const dv = $('rs-driving'), hm2 = $('nb-home'); if (dv) dv.click(); if (hm2) hm2.click();
        setTimeout(() => { const p = $('plan-wrap') || $('ld-top'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 500); return;
      }
      if (ev && ev.url && ev.url.indexOf('ca.rideshare.app://update-route') === 0) { await loadAll(); setTimeout(() => { if (window.__startNav) window.__startNav(true); }, 600); return; }
      if (!ev || !ev.url || ev.url.indexOf(APP_AUTH) !== 0) return;
      try { if (nativePlug('Browser')) await nativePlug('Browser').close(); } catch (e) { /* tab already closed */ }
      const p = new URLSearchParams(ev.url.split('#')[1] || ev.url.split('?')[1] || '');
      if (p.get('error_description') || p.get('error')) { toast((p.get('error_description') || p.get('error')).split('+').join(' ')); return; }
      if (p.get('access_token') && p.get('refresh_token')) {
        const { error } = await sb.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') });
        if (error) toast(error.message);
      }
    });
  }
  let user = null, me = { name: '', points: 0 }, myTrip = null, myReq = null, ledger = [], matches = [];
  let otherTrips = [], otherReqs = [], extraTrips = [], extraReqs = [], names = {}, timer = null, busy = false, formSig = '', mapSig = {};
  let autoAlerts = false;   // started the alert helper for a live trip that was already on when the app opened
  let dndOn = null;   // Android app only: can seat-request alerts break through Do Not Disturb?
  async function refreshDnd() {
    const n = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.RideShareLocation;
    if (!n) return;
    let v = false; try { v = !!(await n.dndStatus()).bypass; } catch (e) { /* older app build */ }
    if (v !== dndOn) { dndOn = v; formSig = ''; if (typeof render === 'function' && user) render(); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDnd(); });
  const editing = { trip: false, req: false };   // the full form stays hidden behind the summary card until Edit is tapped
  let pending = null, viewD = null, viewR = null, askCancel = null, rel = {}, mySet = null, styles = {}, isTest = false, testMode = false, drives = [];
  // Personal settings: defaults for new trips and requests (every trip can still be changed before posting).
  const SD = { d_detour: 10, d_total_detour: 15, d_wait: 5, d_accepts: 'either', d_seats: 1, d_auto_accept: false, d_chat: 'some', d_pets: true, r_pays: 'points', r_chat: 'some', r_pets: false };
  const S_ = () => Object.assign({}, SD, mySet || {});
  // Ride-style tags next to a name (quiet ride, no pets...). Only shown when they differ from the usual.
  const tagsFor = (id, role) => {
    const x = styles[id]; if (!x) return '';
    const p = role === 'driver' ? 'd_' : 'r_', out = [];
    if (x[p + 'chat'] === 'quiet') out.push('quiet ride'); else if (x[p + 'chat'] === 'chatty') out.push('likes to chat');
    if (role === 'driver' && x.d_pets === false) out.push('no pets'); if (role === 'rider' && x.r_pets) out.push('has a pet');
    if (role === 'driver' && x.auto_accept) out.push('instant accept');
    return out.map((t) => ' <span class="tag">' + t + '</span>').join('');
  };
  let myLiveTrip = null, myLiveReq = null, curTrip = null, curReq = null, positions = {}, nowSel = {}, firstSeen = {};
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
  const tripBy = (id) => [...otherTrips, ...extraTrips, ...(myTrip ? [myTrip] : []), ...(myLiveTrip ? [myLiveTrip] : [])].find((t) => t.id === id);
  const pickupMs = (m) => { const t = tripBy(m.trip_id); return t ? RSD.vanEpoch(m.ride_date, t.depart_min) : null; };
  const lateUsedThisMonth = (excludeId) => matches.some((x) => x.rider_id === user.id && x.id !== excludeId && x.late && x.cancelled_by === user.id && x.cancelled_at && RSD.vanMonth(Date.parse(x.cancelled_at)) === RSD.vanMonth(Date.now()));
  // Plain-language result of cancelling this match now (mirrors the database rules).
  function cancelInfo(m) {
    const isRider = m.rider_id === user.id, pts = m.pay_with === 'points' ? m.points : 0;
    if (m.status === 'requested') return { ok: true, text: 'Free to cancel. No points have moved.' };
    if (!isRider) return { ok: true, text: 'If you cancel, ' + nm(m.rider_id) + ' gets ' + (pts ? 'all ' + pts + ' points' : 'nothing charged') + ' back. Cancelling often shows as a warning next to your name.' };
    const pk = pickupMs(m); if (pk == null) return { ok: true, text: 'Cancel this ride.' };
    const tr = tripBy(m.trip_id);
    if (tr && !m.arrived_at && Date.now() >= pk + (tr.max_wait + 10) * 60000) return { ok: true, text: 'Your driver is very late. You can cancel and get ' + (pts ? 'all ' + pts + ' points' : 'nothing charged') + ' back.' };
    if (Date.now() >= pk) return { ok: false, text: 'The pickup time has passed, so this ride can no longer be cancelled. Your driver can mark a no-show.' };
    const late = pk - Date.now() < LATE_MIN * 60000;
    if (!pts) return { ok: true, text: late ? 'Late cancel (within 2 hours). No points involved, but it counts toward your cancellation record.' : 'Free to cancel. No points involved.' };
    if (!late) return { ok: true, text: 'Free to cancel: you get all ' + pts + ' points back.' };
    if (!lateUsedThisMonth(m.id)) return { ok: true, text: 'This is a late cancel (within 2 hours), but your one free late cancel this month covers it: you get all ' + pts + ' points back.' };
    const keep = Math.floor(pts / 2);
    return { ok: true, text: 'Late cancel (within 2 hours) and your free one this month is used: your driver keeps ' + keep + ' points and you get ' + (pts - keep) + ' back.' };
  }
  const canNoShow = (m) => { const t = tripBy(m.trip_id), pk = pickupMs(m); return m.status === 'accepted' && !m.picked_up_at && m.driver_id === user.id && t && pk != null && Date.now() >= pk + t.max_wait * 60000; };
  // Ride steps (driver taps, rider sees): accepted -> on_my_way -> arrived -> picked_up -> dropped_off (completed)
  const stageOf = (m) => (m.status === 'completed' && m.dropped_off_at ? 'dropped_off' : m.picked_up_at ? 'picked_up' : m.arrived_at ? 'arrived' : m.en_route_at ? 'on_my_way' : 'accepted');
  const STEP_LABEL = { accepted: 'accepted', on_my_way: 'driver on the way', arrived: 'driver has arrived', picked_up: 'ride in progress', dropped_off: 'completed' };
  const nextStep = (m, riderName) => ({ accepted: { step: 'on_my_way', label: 'On my way' }, on_my_way: { step: 'arrived', label: 'Arrived at pickup' }, arrived: { step: 'picked_up', label: 'Picked up ' + riderName }, picked_up: { step: 'dropped_off', label: 'Dropped off ' + riderName } }[stageOf(m)]);
  const stepsOpen = (m) => { const pk = pickupMs(m); return pk != null && Date.now() >= pk - LATE_MIN * 60000; };
  // Opens the Google Maps app with directions to the next stop (pickup, then drop-off). Areas are neighbourhood centres, not exact addresses.
  function mapsLink(m, req) {
    if (!req) return '';
    const spot = pt(req, stageOf(m) === 'picked_up' ? 'dropoff' : 'pickup'); if (!spot) return '';
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + spot.lat + ',' + spot.lng;
  }
  const statusText = (s) => ({ requested: 'requested', accepted: 'accepted', completed: 'completed', cancelled: 'cancelled', declined: 'declined', no_show: 'no-show' }[s] || s);

  const dowOf = (d) => { const x = d && new Date(d + 'T12:00:00'); return x && !isNaN(x) ? x.getDay() : undefined; };
  const driverObj = (t, date) => ({ dow: dowOf(date || t.trip_date), origin: pt(t, 'origin'), dest: pt(t, 'dest'), departMin: t.depart_min, maxDetour: t.max_detour, maxTotal: t.max_total_detour == null ? null : t.max_total_detour, maxPickups: t.max_pickups == null ? null : t.max_pickups, maxWait: t.max_wait, accepts: t.accepts, cpk: Number(t.cost_per_km) || 0.2, name: names[t.user_id] || 'Driver' });
  const riderObj = (r) => ({ id: r.id, name: names[r.user_id] || 'Rider', pickup: pt(r, 'pickup'), dropoff: pt(r, 'dropoff'), readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];
  const tripOn = (t, d) => RSD.occursOn(t.live ? todayStr() : t.trip_date, t.repeat_days, d);   // Offer a ride now trips always count as today, even after midnight
  const reqOn = (r, d) => RSD.occursOn(r.live ? todayStr() : r.ride_date, r.repeat_days, d);

  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      try { await sb.rpc('settle_due'); } catch (e) { /* older database: ignore */ }
      try { await sb.rpc('expire_live'); } catch (e) { /* older database: ignore */ }
      if (dndOn === null) refreshDnd();
      if (PLOK === null) PLOK = !!(window.RS_PLACES && window.RS_PLACES.available()) && !(await sb.from('trips').select('origin_lat').limit(1)).error;
      const [p, w, l, t, r, m, ot, orq] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('wallets').select('points').eq('user_id', uid).maybeSingle(),
        sb.from('ledger').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(10),
        sb.from('trips').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(6),
        sb.from('ride_requests').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(6),
        sb.from('matches').select('*').order('created_at', { ascending: false }).limit(60),
        sb.from('trips').select('*').eq('active', true).neq('user_id', uid).limit(100),
        sb.from('ride_requests').select('*').eq('active', true).neq('user_id', uid).limit(100),
      ]);
      me = { name: (p.data && p.data.display_name) || '', points: (w.data && w.data.points) || 0 };
      const stillLive = (x) => x.live && x.expires_at && Date.parse(x.expires_at) > Date.now();
      ledger = l.data || [];
      myLiveTrip = (t.data || []).find(stillLive) || null; myTrip = (t.data || []).find((x) => !x.live) || null; curTrip = myLiveTrip || myTrip;
      if (!myLiveTrip) autoAlerts = false; else if (!autoAlerts && !driveSession && nativeLoc()) { autoAlerts = true; startAlerts(nativeLoc()); }
      myLiveReq = (r.data || []).find(stillLive) || null; myReq = (r.data || []).find((x) => !x.live) || null; curReq = myLiveReq || myReq;
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
      try { const ta = await sb.from('test_accounts').select('user_id,test_mode').eq('user_id', uid).maybeSingle(); isTest = !!ta.data; testMode = !!(ta.data && ta.data.test_mode); } catch (e) { isTest = false; testMode = false; }
      try { const ds = await sb.from('drive_sessions').select('*').order('started_at', { ascending: false }).limit(5); drives = ds.data || []; } catch (e) { drives = []; }
      try { const st = await sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle(); mySet = st.data || null; const sr = await sb.rpc('ride_styles', { p_ids: [...ids] }); styles = {}; (sr.data || []).forEach((x) => { styles[x.user_id] = x; }); } catch (e) { /* older database without settings: ignore */ }
      const rl = await sb.from('reliability').select('*'); rel = {}; (rl.data || []).forEach((x) => { rel[x.user_id] = x; });
      const pp = await sb.from('driver_positions').select('*'); positions = {}; (pp.data || []).forEach((x) => { positions[x.driver_id] = x; });
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
      if (nativePlug('Browser')) { // Android app: Google does not allow sign-in inside an app's built-in page, so use a Chrome tab that lists your Google accounts
        const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_AUTH, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
        if (error || !data || !data.url) { toast((error && error.message) || 'Could not start sign-in'); return; }
        try { await nativePlug('Browser').open({ url: data.url }); } catch (e) { toast('Could not open the sign-in page'); }
        return;
      }
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
      if (error) toast(error.message);
    };
    $('lv-send').onclick = async () => {
      const email = $('lv-email').value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Enter a valid email'); return; }
      $('lv-send').disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: nativePlug('Browser') ? APP_AUTH : location.origin + location.pathname } });
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

  // ---------- "what do I do next" cards at the top of the driving and riding tabs ----------
  const goTo = (id) => `<button class="btn ghost" data-scroll="${id}">`;
  // The trip plan: shown on Home once a rider is accepted for today. This is the review before driving; Start trip is the only way into Google Maps.
  function planData() {
    if (!user || !curTrip || !known(curTrip)) return null;
    const d = todayStr(), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const acc = matches.filter((x) => x.driver_id === user.id && x.ride_date === d && x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    if (!acc.length) return null;
    let dr = driverObj(curTrip, d);
    if (curTrip.live) { const n = new Date(); dr = Object.assign({}, dr, { departMin: n.getHours() * 60 + n.getMinutes() + 2 }); }   // an Offer a ride now trip leaves about now
    const objs = acc.map((x) => riderObj(reqById[x.request_id]));
    const stops = RS.buildRoute(dr, objs) || RS.buildRoute(dr, objs, true) || RS.buildRoute(dr, []);
    const direct = RS.minutes(dr.origin, dr.dest, dr.departMin, dr.dow);
    let ev = RS.evaluate(stops, dr.departMin, dr.maxWait, dr.dow);
    if (curTrip.live) {   // leaving about now: plain driving times, no waiting for a rider's window
      let t = dr.departMin; ev = { timeline: stops.map((st, i) => { if (i > 0) t += RS.minutes(stops[i - 1].loc, st.loc, t, dr.dow); return { stop: st, arrive: t }; }) }; ev.totalMin = t - dr.departMin;
    }
    const label = (s) => {
      const q = s.rider && reqById[s.rider.id];
      if (s.type === 'origin') return 'Start: <b>' + esc(disp(curTrip, 'origin')) + '</b>';
      if (s.type === 'dest') return 'Arrive: <b>' + esc(disp(curTrip, 'dest')) + '</b>';
      if (s.type === 'pickup') return 'Pick up <b>' + esc(s.rider.name) + '</b>' + (q ? ' <span class="mut">&middot; ' + esc(disp(q, 'pickup')) + '</span>' : '');
      return 'Drop off <b>' + esc(s.rider.name) + '</b>' + (q ? ' <span class="mut">&middot; ' + esc(disp(q, 'dropoff')) + '</span>' : '');
    };
    const rows = ev.timeline.map((t, i) => '<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)"><span style="flex:none;width:24px;height:24px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center">' + (i + 1) + '</span><b style="min-width:46px">' + (i === 0 ? RS.clock(dr.departMin) : RS.clock(t.arrive)) + '</b><span>' + label(t.stop) + '</span></div>').join('');
    const extra = Math.max(0, Math.round(ev.totalMin - direct));
    // One big button at a time, in order: Start trip, then Picked up (per rider, in route order), then Dropped off. Same actions as the phone notification.
    const started = acc.some((x) => x.en_route_at);
    const bigBtn = (attr, label) => '<button class="btn" ' + attr + ' style="width:100%;padding:14px;font-size:17px">' + label + '</button>';
    let next = '';
    if (!started) next = bigBtn('data-startnav="1"', 'Start trip');
    else {
      for (const st of stops) {
        if (!st.rider || (st.type !== 'pickup' && st.type !== 'dropoff')) continue;
        const x = acc.find((m) => m.request_id === st.rider.id); if (!x) continue;
        const stg = stageOf(x), who = esc(st.rider.name);
        if (st.type === 'pickup' && (stg === 'on_my_way' || stg === 'arrived' || stg === 'accepted')) { next = bigBtn('data-step="' + x.id + '|picked_up"', 'Picked up ' + who); break; }
        if (st.type === 'dropoff' && stg === 'picked_up') { next = bigBtn('data-step="' + x.id + '|dropped_off"', 'Dropped off ' + who); break; }
      }
    }
    // Who is riding with me: name, tags, how they pay, where they get in and out.
    const pax = acc.map((x) => { const q = reqById[x.request_id];
      return '<div style="padding:8px 0;border-top:1px solid var(--line)"><b>' + nm(x.rider_id) + '</b>' + badge(x.rider_id, 'rider') + tagsFor(x.rider_id, 'rider') + '<div class="mut">' + (x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share') + (q ? ' &middot; ' + esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) : '') + '</div></div>'; }).join('');
    const paxBlock = '<div style="margin-top:12px"><b>' + (acc.length > 1 ? 'Passengers' : 'Passenger') + '</b>' + pax + '</div>';
    const note = started
      ? '<p class="mut" style="margin:8px 0 0">This is the next step. The same button also appears in your phone notification, so you can stay in Google Maps. </p><button class="btn ghost" data-startnav="1" style="margin-top:6px">Open Google Maps again</button>'
      : '<p class="mut" style="margin:8px 0 0">Start trip tells your riders you are on your way and opens Google Maps with all of these stops. If Maps is already navigating, tap X in Maps first.</p>';
    return { stops, html: '<p class="mut" style="margin-top:0">' + (started ? 'Your trip is under way. About ' : 'Review this, then tap Start trip. About ') + fmtMin(ev.totalMin) + ' in all' + (extra ? ', ' + extra + ' min more than driving alone' : '') + '.</p>' + rows
      + paxBlock
      + '<div style="margin-top:12px">' + next + '</div>' + note
      + '<div style="margin-top:12px"><button class="btn ghost" data-reset="trip">Reset trip</button></div>' };
  }
  // Seat requests at the very top of Home, so a rider asking is the first thing the driver sees.
  function renderRequests() {
    const wrap = $('req-wrap'); if (!wrap) return;
    const reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const t0 = todayStr();
    const asks = user ? matches.filter((x) => x.driver_id === user.id && x.status === 'requested' && x.ride_date >= t0 && reqById[x.request_id]) : [];
    if (!asks.length) { wrap.classList.add('hide'); return; }
    wrap.classList.remove('hide');
    $('req-title').textContent = asks.length > 1 ? asks.length + ' riders are asking for a seat' : 'A rider is asking for a seat';
    $('req-body').innerHTML = asks.map((x) => { const q = reqById[x.request_id];
      return '<div style="padding:8px 0;border-top:1px solid var(--line)"><b style="font-size:17px">' + nm(x.rider_id) + '</b>' + badge(x.rider_id, 'rider') + tagsFor(x.rider_id, 'rider') + '<div class="mut">' + esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) + ' &middot; ' + (x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share') + '</div><div style="margin-top:8px"><button class="btn" data-acc="' + x.id + '" style="padding:12px 22px;font-size:16px">Accept</button> <button class="btn ghost" data-dec="' + x.id + '">Decline</button></div></div>'; }).join('');
  }
  // The plan card has its own map (map-plan) that is never rebuilt, so it does not flicker when the page refreshes.
  function renderPlan() {
    const wrap = $('plan-wrap'); if (!wrap) return;
    const r = planData();
    if (!r) { wrap.classList.add('hide'); return; }
    wrap.classList.remove('hide'); $('plan-body').innerHTML = r.html;
    const sig = routeSig(r.stops);
    if (mapSig.p !== sig) { mapSig.p = sig; window.RS_UI.drawMap('map-plan', r.stops, []); }
  }
  function driverTop() {
    if (!curTrip || !known(curTrip)) return card('Start here', `<p><b>1.</b> Fill in the form below: where you drive from and to, the date and time.</p><p><b>2.</b> Tap <b>Review trip</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Riders who ask for a seat will appear on this page for you to accept.</p><p>${goTo('ld-form')}Go to the form</button></p>`);
    const dates = RSD.nextOccurrences(curTrip.live ? todayStr() : curTrip.trip_date, curTrip.repeat_days, new Date(), 7), d = pickView(viewD, dates);
    const mine = d ? matches.filter((x) => x.driver_id === user.id && x.ride_date === d) : [];
    const asks = mine.filter((x) => x.status === 'requested').length, acc = mine.filter((x) => x.status === 'accepted').length;
    const isToday = d === todayStr();
    const line = asks ? `<b>${asks} rider${asks > 1 ? 's' : ''} asked for a seat.</b> Tap <b>See riders</b> to accept.` : acc ? `<b>${acc} rider${acc > 1 ? 's' : ''} accepted.</b> ${isToday ? 'Tap <b>Start my trip</b> when you set off.' : 'You can start on the day of the trip.'}` : 'No riders yet. They will show up here when they ask for a seat.';
    return card('Your trip', `<p><b>${esc(disp(curTrip, 'origin'))}</b> to <b>${esc(disp(curTrip, 'dest'))}</b></p><p class="mut">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</p><p>${line}</p>
      <div class="row2">${isToday ? '<button class="btn" data-startnav="1">Start my trip</button> ' : ''}${goTo(asks ? 'seat-requests' : acc ? (isToday ? 'plan-wrap' : 'riding-with-me') : 'ld-lists')}See riders</button> <button class="btn ghost" data-edit="trip">Edit trip</button> <button class="btn ghost" data-reset="trip">Reset trip</button></div>`);
  }
  function riderTop() {
    if (!curReq || !known(curReq)) return card('Start here', `<p><b>1.</b> Fill in the form below: where you want to be picked up and dropped off, the date and when you are ready.</p><p><b>2.</b> Tap <b>Review request</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Pick a driver from the list and tap <b>Request</b>.</p><p>${goTo('lr-form')}Go to the form</button></p>`);
    const dates = RSD.nextOccurrences(curReq.live ? todayStr() : curReq.ride_date, curReq.repeat_days, new Date(), 7), d = pickView(viewR, dates);
    const mine = d ? matches.filter((x) => x.rider_id === user.id && x.request_id === curReq.id && x.ride_date === d) : [];
    const acc = mine.find((x) => x.status === 'accepted' || x.status === 'completed'), pend = mine.some((x) => x.status === 'requested');
    const line = acc ? `<b>${esc(STEP_LABEL[stageOf(acc)])}.</b> Tap <b>See my ride</b> for live updates.` : pend ? 'You asked a driver for a seat. Waiting for them to accept.' : 'Pick a driver below and tap <b>Request</b>.';
    return card('Your ride', `<p><b>${esc(disp(curReq, 'pickup'))}</b> to <b>${esc(disp(curReq, 'dropoff'))}</b></p><p class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}</p><p>${line}</p>
      <div class="row2">${goTo('lr-lists')}${acc ? 'See my ride' : 'See drivers'}</button> <button class="btn ghost" data-edit="req">Edit request</button></div>`);
  }


  // ---------- address search (Google Places) ----------
  // A trip or request keeps its neighbourhood in origin/dest/pickup/dropoff (prices and matching use it) and, when an address was chosen,
  // a label and a map point as well (migration 015 rounds the point to about 100 m and drops house numbers).
  const PL = {}; let PLOK = null;
  const pt = (row, k) => (row && row[k + '_lat'] != null && row[k + '_lng'] != null ? { lat: +row[k + '_lat'], lng: +row[k + '_lng'] } : LOC[row[k]]);
  const disp = (row, k) => (row && (row[k + '_label'] || row[k])) || '';
  const plReset = (...ids) => ids.forEach((i) => { delete PL[i]; });
  const plCols = (id, key) => {
    if (!PLOK) return {};
    const p = PL[id], has = p && !p.isArea;
    return { [key + '_label']: has ? p.label : null, [key + '_lat']: has ? p.lat : null, [key + '_lng']: has ? p.lng : null };
  };
  const plNeed = (id, what) => (PLOK && !PL[id] ? 'Choose ' + what + ' from the suggestions (or tap Use my location)' : '');
  const samePlace = (a, b, ia, ib) => a === b && !(PL[ia] && PL[ib] && !PL[ia].isArea && !PL[ib].isArea && RS.haversineKm(PL[ia], PL[ib]) > 0.3);
  async function setCols(table, id, ...cols) { if (PLOK && id) { const patchRow = Object.assign({}, ...cols); const r = await sb.from(table).update(patchRow).eq('id', id); if (r.error) throw r.error; } }
  const LOCBTN = { 'ln-o': 'ln-loc', 'rn-p': 'rn-loc' };
  function placeField(id, label, row, k, area) {
    if (!PLOK) return `<label>${label}</label><select id="${id}">${opts(area)}</select>` + (LOCBTN[id] ? ` <button type="button" class="btn ghost" id="${LOCBTN[id]}" style="margin-top:6px">Use my location</button>` : '');
    if (PL[id] === undefined) PL[id] = row && row[k] ? (row[k + '_lat'] != null ? { label: row[k + '_label'] || row[k], lat: +row[k + '_lat'], lng: +row[k + '_lng'], area: row[k] } : { label: row[k], area: row[k], isArea: true }) : null;
    const p = PL[id], a = p ? p.area : area;
    return `<label>${label}</label><div data-pf="${id}"><input type="text" id="${id}-q" autocomplete="off" placeholder="Type an address or place" value="${esc(p ? p.label : '')}" style="${INPUT}"><div class="pfsug" id="${id}-sug"></div>
      <div class="pfrow"><button type="button" class="btn ghost" data-ploc="${id}">Use my location</button><a href="#" data-pnb="${id}">Choose a neighbourhood instead</a></div>
      <div class="mut" id="${id}-note" style="font-size:12px;margin-top:4px">${p && !p.isArea ? 'Neighbourhood: ' + esc(a) : ''}</div>
      <select id="${id}" style="display:none;margin-top:6px">${opts(a)}</select></div>`;
  }
  function wirePlaces() {
    document.querySelectorAll('[data-pf]').forEach((box) => {
      const id = box.dataset.pf, q = $(id + '-q'), sug = $(id + '-sug'), sel = $(id), note = $(id + '-note');
      let seq = 0, tm = null, list = [];
      const setP = (p) => { PL[id] = p; sel.value = p.area; nowSel[id] = p.area; q.value = p.label; note.textContent = p.isArea ? '' : 'Neighbourhood: ' + p.area; sug.innerHTML = ''; };
      const covered = (lat, lng) => { const n = nearestArea(lat, lng); if (n.km > 40) { note.textContent = 'That is outside the area we cover for now.'; return null; } return n; };
      q.oninput = () => {
        PL[id] = null; note.textContent = ''; clearTimeout(tm);
        const v = q.value.trim(); if (v.length < 3) { sug.innerHTML = ''; return; }
        tm = setTimeout(async () => {
          const my = ++seq, r = await window.RS_PLACES.suggest(v); if (my !== seq) return;
          if (!window.RS_PLACES.available()) { note.textContent = 'Address search is not switched on yet. Choose a neighbourhood instead.'; sel.style.display = ''; return; }
          list = r;
          sug.innerHTML = r.length ? r.map((s, i) => '<button type="button" data-i="' + i + '">' + esc(s.main) + '<span>' + esc(s.sub) + '</span></button>').join('') : '';
          sug.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
            const s = list[+b.dataset.i]; note.textContent = 'Finding that place...';
            try { const d = await window.RS_PLACES.details(s.id), n = covered(d.lat, d.lng); if (n) setP({ label: s.main, lat: d.lat, lng: d.lng, area: n.a }); }
            catch (e) { note.textContent = 'Could not load that place. Try again.'; }
          }));
        }, 250);
      };
      box.querySelector('[data-ploc]').onclick = () => {
        if (!navigator.geolocation) { note.textContent = 'This device cannot share its location'; return; }
        note.textContent = 'Finding you...';
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const n = covered(pos.coords.latitude, pos.coords.longitude); if (!n) return;
            note.textContent = 'Finding your address...';
            const addr = await window.RS_PLACES.where(pos.coords.latitude, pos.coords.longitude);
            setP({ label: addr || 'My location', lat: pos.coords.latitude, lng: pos.coords.longitude, area: n.a });
          },
          (e) => { note.textContent = e && e.code === 1 ? 'Location is blocked. Allow it in your settings.' : 'Could not find your location'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
      };
      box.querySelector('[data-pnb]').onclick = (e) => { e.preventDefault(); sel.style.display = sel.style.display === 'none' ? '' : 'none'; };
      sel.onchange = () => setP({ label: sel.value, area: sel.value, isArea: true });
    });
  }

  // ---------- Leave now (driver) and I need a ride now (rider) ----------
  const nearestArea = (lat, lng) => areas.map((a) => ({ a, km: RS.haversineKm({ lat, lng }, LOC[a]) })).sort((x, y) => x.km - y.km)[0];
  const minsLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
  function driverNow() {
    const share = sharingCard() + driveCard();
    if (myLiveTrip) return share + card('Offer a ride now: ON', `<p><b>${esc(disp(myLiveTrip, 'origin'))}</b> to <b>${esc(disp(myLiveTrip, 'dest'))}</b></p><p class="mut">Leaving about ${RS.clock(myLiveTrip.depart_min)} &middot; riders can see you until you switch it off.</p><p><button class="btn ghost" data-stoplive="trip">Switch OFF</button></p>`);
    const o = nowSel['ln-o'] || (myTrip && myTrip.origin) || 'Surrey Central', d = nowSel['ln-d'] || (myTrip && myTrip.dest) || 'BCIT / Willingdon (Burnaby)';
    return share + card('Not on a schedule? Offer a ride now', `<p class="mut">For a spur-of-the-moment drive: no date or time. Switch it on and riders along your route can ask for a seat. You get a phone alert for each request, even before you leave. It stays on until you switch it off (or after 12 hours). Already posted a trip? Use <b>Start my trip</b> instead.</p>
      ${placeField('ln-o', 'From', myTrip, 'origin', o)}
      ${placeField('ln-d', 'To', myTrip, 'dest', d)}
      <div style="margin-top:10px"><button class="btn" id="ln-go" style="width:100%;padding:12px;font-size:16px">Switch ON: offer a ride now</button></div><p class="warn" id="ln-msg" role="alert"></p>`);
  }
  function riderNow() {
    if (myLiveReq) return card('You are looking for a ride now', `<p><b>${esc(disp(myLiveReq, 'pickup'))}</b> to <b>${esc(disp(myLiveReq, 'dropoff'))}</b></p><p class="mut">Visible to drivers for ${minsLeft(myLiveReq.expires_at)} more minutes.</p><p><button class="btn ghost" data-stoplive="req">Stop</button></p>`);
    const p = nowSel['rn-p'] || (myReq && myReq.pickup) || 'Whalley (Surrey)', d = nowSel['rn-d'] || (myReq && myReq.dropoff) || 'Brentwood (Burnaby)', pay = nowSel['rn-pay'] || 'points';
    return card('I need a ride now', `<p class="mut">One tap, no date or time. You are ready now and drivers can see you for 20 minutes.</p>
      ${placeField('rn-p', 'Pick me up at', myReq, 'pickup', p)}
      ${placeField('rn-d', 'Drop me at', myReq, 'dropoff', d)}
      <label>I'll pay with</label><select id="rn-pay"><option value="points" ${pay === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${pay === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${pay === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="rn-go" style="width:100%;padding:12px;font-size:16px">I need a ride now</button></div><p class="warn" id="rn-msg" role="alert"></p>`);
  }
  function useMyLocation(selectId, msgId) {
    if (!navigator.geolocation) { formMsg(msgId, 'This device cannot share its location'); return; }
    formMsg(msgId, 'Finding you...');
    navigator.geolocation.getCurrentPosition((p) => {
      const n = nearestArea(p.coords.latitude, p.coords.longitude); $(selectId).value = n.a; nowSel[selectId] = n.a;
      formMsg(msgId, n.km > 25 ? 'You are ' + Math.round(n.km) + ' km from the nearest area we cover (' + n.a + ').' : 'Nearest area: ' + n.a + ' (' + n.km.toFixed(1) + ' km away).');
    }, (e) => formMsg(msgId, e && e.code === 1 ? 'Location is blocked. Allow it in your browser settings.' : 'Could not find your location'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

  // ---------- driver: share my live position with the riders on my ride ----------
  let shareWatch = null, wake = null; const shareState = { last: 0, lastOk: 0, err: '', acc: null };
  const shouldShare = () => matches.some((x) => x.driver_id === user.id && x.status === 'accepted' && x.en_route_at);
  async function keepAwake(on) { try { if (on && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); else if (wake) { await wake.release(); wake = null; } } catch (e) {} }
  // Driving mode (Android app): the background helper stays on while you drive, sends your position during a ride, and alerts you when a rider asks for a seat.
  let driveSession = false;
  // The story of each drive: time and distance, kept by RideShare itself (so restarting Google Maps to add a stop loses nothing).
  const fmtMin = (m) => { m = Math.max(0, Math.round(m)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
  const driveLogCard = () => {
    if (!user || !drives.length) return '';
    const rows = drives.slice(0, 3).map((d) => {
      const start = Date.parse(d.started_at), end = Date.parse(d.ended_at || d.last_at), live = !d.ended_at && Date.now() - Date.parse(d.last_at) < 30 * 60000;
      const riders = matches.filter((x) => x.driver_id === user.id && x.picked_up_at && Date.parse(x.picked_up_at) >= start - 60000 && Date.parse(x.picked_up_at) <= end + 300000).length;
      const t = d.trip_id && tripBy(d.trip_id); let plan = '';
      if (t && pt(t, 'origin') && pt(t, 'dest')) plan = ' &middot; without stops about ' + fmtMin(RS.minutes(pt(t, 'origin'), pt(t, 'dest'), t.depart_min, dowOf(d.ride_date)));
      return '<div style="padding:6px 0;border-top:1px solid var(--line)"><b>' + (live ? 'Drive in progress' : esc(RSD.label(d.ride_date))) + '</b> ' + fmtMin((end - start) / 60000) + ' &middot; ' + (+d.distance_km).toFixed(1) + ' km' + (riders ? ' &middot; ' + riders + ' rider' + (riders > 1 ? 's' : '') : '') + plan + '</div>';
    }).join('');
    return card('Your drives', rows + '<p class="mut">Time includes pickups and waiting. Distance is counted while your phone shares its location during a ride.</p>');
  };
  const rideStats = (m) => (m.picked_up_at && m.dropped_off_at ? '<p>Your ride: ' + fmtMin((Date.parse(m.dropped_off_at) - Date.parse(m.picked_up_at)) / 60000) + (+m.ride_km > 0 ? ' &middot; ' + (+m.ride_km).toFixed(1) + ' km' : '') + '</p>' : '');
  // Test tools (only for accounts listed in test_accounts): a made-up rider asks for a seat on my latest trip, now or after a delay.
  const testBtns = () => (isTest ? '<p class="mut">Test tools (only you see this)' + (testMode ? ': <b>Test mode is ON</b>, a made-up rider will ask for a seat about every 2 minutes.' : ':') + '</p><p><button class="btn ghost" data-testsend="30">Test request in 30 s</button> <button class="btn ghost" data-testsend="0">Test request now</button></p>' : '');
  const driveCard = () => (user && driveSession && !shouldShare() ? `<div class="card"><h2>Driving mode is on</h2><p>You will get a phone alert if a rider asks for a seat. Open the alert to accept or decline.</p><p class="mut">It switches itself off when your trips for the day are over.</p><p><button class="btn ghost" data-stopdrive="1">Stop driving mode</button></p>${testBtns()}</div>` : '');
  // In the Android app, a native background helper keeps sending the position while Google Maps is on screen.
  const nativeLoc = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.RideShareLocation) || null;
  // Android app: first time only, offer to let rider alerts break through Do Not Disturb / Sleeping mode (the phone's owner has to flip one switch).
  // Returns true when the settings screen was opened.
  async function dndAsk(nat) {
    try {
      const st = nat.dndStatus ? await nat.dndStatus() : null; dndOn = st ? !!st.bypass : null;
      let asked = ''; try { asked = localStorage.getItem('rs_dnd_asked') || ''; } catch (e) { /* storage blocked */ }
      if (st && !st.bypass && !asked) {
        try { localStorage.setItem('rs_dnd_asked', '1'); } catch (e) { /* storage blocked */ }
        if (window.confirm('Rider requests can alert you even when your phone is on Do Not Disturb or Sleeping mode.\n\nOpen the setting now? Switch on "Override Do Not Disturb", then come back.')) { await nat.openAlertSettings(); return true; }
      }
    } catch (e) { /* older app build: skip */ }
    return false;
  }
  // Driving mode without Google Maps: the helper that listens for seat requests and shows the phone alert.
  async function startAlerts(nat) {
    shareWatch = 'native-pending'; const ok = await startNativeShare(nat); if (!ok) shareWatch = null; else driveSession = true; paintSharing(); return ok;
  }
  async function startNativeShare(nat) {
    try {
      const r = await sb.rpc('start_tracking');
      if (r.error || !r.data) { shareState.err = (r.error && r.error.message) || 'Could not start location sharing.'; return false; }
      await nat.start({ url: CFG.supabaseUrl, key: CFG.supabaseKey, token: r.data });
      shareWatch = 'native'; shareState.err = ''; shareState.lastOk = Date.now(); return true;
    } catch (e) { shareState.err = (e && e.message) || 'Location permission was not granted, so riders cannot see you.'; return false; }
  }
  function startShare() {
    const nat = nativeLoc();
    if (nat) { shareWatch = 'native-pending'; startNativeShare(nat).then((ok) => { if (!ok) shareWatch = null; paintSharing(); }); return; }
    if (!navigator.geolocation) { shareState.err = 'This device cannot share its location.'; return; }
    keepAwake(true);
    shareWatch = navigator.geolocation.watchPosition((p) => {
      shareState.err = ''; shareState.acc = p.coords.accuracy; const now = Date.now(); if (now - shareState.last < 4000) return; shareState.last = now;
      sb.rpc('share_position', { p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_speed: p.coords.speed == null ? null : p.coords.speed * 3.6, p_heading: p.coords.heading == null || isNaN(p.coords.heading) ? null : p.coords.heading, p_accuracy: p.coords.accuracy })
        .then((r) => { if (r.error) { shareState.err = r.error.message; } else { shareState.lastOk = Date.now(); } paintSharing(); });
    }, (e) => { shareState.err = e && e.code === 1 ? 'Location is blocked, so riders cannot see you. Allow it in your browser settings.' : 'Could not get your location.'; paintSharing(); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function stopShare(deleteRow) { driveSession = false; const nat = nativeLoc(); if (nat) { try { nat.stop(); } catch (e) {} } if (shareWatch != null && shareWatch !== 'native' && shareWatch !== 'native-pending') { navigator.geolocation.clearWatch(shareWatch); } shareWatch = null; keepAwake(false); if (deleteRow) { try { sb.rpc('stop_sharing'); } catch (e) {} } }
  function syncSharing() {
    if (!user) { stopShare(false); return; }
    const nat = nativeLoc();
    if (driveSession && nat) { nat.status().then((r) => { if (!r.running && driveSession) { driveSession = false; autoAlerts = false; if (shareWatch === 'native') shareWatch = null; render(); } }).catch(() => {}); }
    if (shouldShare()) { if (shareWatch == null) startShare(); } else if (shareWatch != null && !(shareWatch === 'native-pending' || (driveSession && shareWatch === 'native'))) stopShare(true);
  }
  const ago = (ms) => (ms ? Math.max(0, Math.round((Date.now() - ms) / 1000)) + ' s ago' : 'not yet');
  function sharingInner() { if (!shareState.err && nativeLoc()) return `<p>Riders on this ride can see you on their map, even while Google Maps is open.</p><p class="mut">Android shows a small "RideShare is sharing your location" notification while this is on. It stops by itself when the ride ends.</p>`; return shareState.err ? `<p class="warn">${esc(shareState.err)}</p>` : `<p>Riders on this ride can see you on their map. Last sent: ${ago(shareState.lastOk)}.</p><p class="mut">Keep this screen open. If you use Google Maps for directions, put RideShare and Google Maps side by side (split screen) so sharing keeps working.</p>`; }
  const sharingCard = () => (user && shouldShare() ? `<div class="card" id="share-card"><h2>Sharing your location</h2><div id="share-inner">${sharingInner()}</div></div>` : '');
  function paintSharing() { const e = $('share-inner'); if (e) e.innerHTML = sharingInner(); }

  // ---------- rider: where is my driver, and when will they arrive ----------
  window.__carPos = null;
  const applyCar = () => { try { window.RS_UI.setCar('map-lr', window.__carPos); } catch (e) {} };
  function trackInfo(m, t, meO) {
    const stg = stageOf(m), dn = nm(t.user_id), pos = positions[m.driver_id], pk = pickupMs(m);
    window.__carPos = null;
    let html = '';
    if (stg === 'accepted' && pk != null && !m.arrived_at && Date.now() >= pk + (t.max_wait + 10) * 60000) {
      return `<p class="warn"><b>${dn} is very late.</b> You can cancel and get all your points back.</p><p><button class="btn" data-cancelgo="${m.id}">Cancel, full refund</button></p>`;
    }
    if (stg === 'on_my_way' || stg === 'arrived' || stg === 'picked_up') {
      const target = stg === 'picked_up' ? meO.dropoff : meO.pickup;
      if (!pos) { html = `<p class="mut">Waiting for ${dn}'s location. They need to keep the app open.</p>`; }
      else {
        window.__carPos = { lat: pos.lat, lng: pos.lng };
        const age = (Date.now() - Date.parse(pos.updated_at)) / 1000;
        if (!firstSeen[m.id]) firstSeen[m.id] = { lat: pos.lat, lng: pos.lng, t: Date.now() };
        const moved = RS.haversineKm(firstSeen[m.id], pos) * 1000, waited = (Date.now() - firstSeen[m.id].t) / 60000;
        if (age > 120) html = `<p class="warn">We lost ${dn}'s location (last seen ${Math.round(age / 60)} min ago).</p>`;
        else if (stg === 'on_my_way' && moved < 300 && waited > 3) html = `<p class="warn"><b>${dn} has not left yet.</b> They said they are on the way, but their position has not changed.</p>`;
        else if (stg === 'arrived') html = `<p>${dn} is at the pickup area.</p>`;
        else if (target) {
          const km = RS.haversineKm(pos, target) * 1.35, kmh = Math.max(pos.speed || 0, 25), eta = Math.max(1, Math.round((km / kmh) * 60));
          html = `<p><b>${stg === 'picked_up' ? 'About ' + eta + ' min to your drop-off' : dn + ' is about ' + eta + ' min away'}</b> <span class="mut">(${km.toFixed(1)} km, updated ${Math.round(age)} s ago)</span></p>`;
        }
      }
    }
    return html;
  }

  // ---------- driver tab ----------
  function driverForm() {
    if (pending && pending.kind === 'trip') {
      const r = pending.row;
      return card('Confirm your trip', `<p><b>${esc(disp(r, 'origin'))}</b> to <b>${esc(disp(r, 'dest'))}</b></p><p>${whenText(r.trip_date, r.depart_min, r.repeat_days)}</p>
        <p class="mut">${r.max_pickups === 1 ? 'One pickup only' : 'Up to ' + r.max_pickups + ' pickups'} &middot; max ${r.max_detour} extra min for one pickup${r.max_pickups > 1 && r.max_total_detour != null ? ' &middot; max ' + r.max_total_detour + ' extra min for all pickups together' : ''} &middot; max wait ${r.max_wait} min &middot; accepts ${r.accepts === 'either' ? 'points or cash' : r.accepts === 'points' ? 'points only' : 'cash gas-share only'}</p>
        <div style="margin-top:10px"><button class="btn" id="lt-confirm">${myTrip ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lt-back">Back</button></div>`);
    }
    if (myTrip && !editing.trip) return '';
    const t = myTrip || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: S_().d_detour, max_total_detour: S_().d_total_detour, max_pickups: Math.min(4, S_().d_seats), max_wait: S_().d_wait, accepts: S_().d_accepts, trip_date: todayStr(), repeat_days: [] };
    const date = defaultDate(t.trip_date, t.depart_min);
    return card(myTrip ? 'My trip' : 'Post a trip', `${placeField('lt-o', 'From', myTrip, 'origin', t.origin)}${placeField('lt-d', 'To', myTrip, 'dest', t.dest)}
      <div class="row"><div><label>Date</label><input type="date" id="lt-date" min="${todayStr()}" max="${maxDate()}" value="${date}"></div><div><label>Leave at</label><input type="time" id="lt-t" value="${hmIn(t.depart_min)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lt-days', t.repeat_days)}
      <label>Most riders I will pick up</label><select id="lt-pk">${[1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === (t.max_pickups || 1) ? ' selected' : '') + '>' + (n === 1 ? 'Just 1 (a single pickup)' : 'Up to ' + n) + '</option>').join('')}</select>
      <label>Most extra minutes for ONE pickup</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      <label>Most extra minutes for ALL pickups together <span class="mut">(only matters if you take more than 1 rider)</span></label><input type="number" id="lt-tt" min="0" max="120" value="${t.max_total_detour == null ? t.max_detour : t.max_total_detour}">
      <label>Max wait at a pickup (min)</label><input type="number" id="lt-w" min="0" max="60" value="${t.max_wait}">
      <label>I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      <div style="margin-top:10px"><button class="btn" id="lt-review">Review trip</button>${myTrip ? ' <button class="btn ghost" data-edit-off="trip">Cancel</button>' : ''}</div><p class="warn" id="lt-msg" role="alert"></p>`);
  }

  function driverLists() {
    if (!curTrip || !known(curTrip)) return card('Riders', '<p class="mut">Post your trip on the left to see riders along your route.</p>');
    const dates = RSD.nextOccurrences(curTrip.live ? todayStr() : curTrip.trip_date, curTrip.repeat_days, new Date(), 7);
    viewD = pickView(viewD, dates);
    const dr = driverObj(curTrip, viewD), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const dateCard = card('Date', dateChips('ld-dates', dates, viewD) + `<p class="mut" style="margin-top:8px">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</p>`);
    if (!viewD) return dateCard;
    const mine = matches.filter((x) => x.driver_id === user.id && x.ride_date === viewD);
    const inc = mine.filter((x) => x.status === 'requested');
    const acc = mine.filter((x) => x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    const accObjs = acc.map((x) => riderObj(reqById[x.request_id]));
    const stops = RS.buildRoute(dr, accObjs) || RS.buildRoute(dr, accObjs, true) || RS.buildRoute(dr, []);
    const waiting = otherReqs.filter((q) => known(q) && reqOn(q, viewD)).map(riderObj);
    const found = RS.findMatches(dr, waiting, accObjs);
    drawDriverMap(stops, waiting.filter((w) => !found.some((f) => f.rider.id === w.id)), viewD);
    window.__ldStops = stops; window.__ldAcc = acc;
    const pr = RS.priceRoute(stops, dr.cpk);
    const summary = card(RSD.label(viewD) + '\'s trip', `<div class="stat"><div><span class="mut">Cost if driving alone</span><b>${RS.money(RS.priceRoute(RS.buildRoute(dr, []), dr.cpk).total)}</b></div><div><span class="mut">Your share now</span><b>${RS.money(pr.driverShare)}</b></div></div>
      <p class="mut">${RS.km(stops).toFixed(1)} km total &middot; riders pay only their share, never more.</p>
      <button class="btn ghost" id="ld-start">Preview route (watch the car)</button> <button class="btn ghost" id="ld-stop">Stop</button>
      <p class="mut" style="margin-top:8px">${viewD === todayStr() ? 'When you set off, tap Start my trip at the top. It opens Google Maps with your destination and your riders as stops, and tells your riders you are on the way.' : 'Start my trip is available on the day of the trip.'}</p>`);
    const reqs = card('Seat requests for you', inc.length ? inc.map((x) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b>${badge(x.rider_id, 'rider')} <span class="mut">pays ${x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share'}</span>
        <div style="margin-top:6px"><button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button></div></div>`).join('') : '<p class="mut">None yet. Riders ask you for a seat; you accept here.</p>');
    const riding = card('Riding with me', acc.length ? acc.map((x) => { const q = reqById[x.request_id], ns = nextStep(x, esc(names[x.rider_id] || 'rider')), open = stepsOpen(x), link = mapsLink(x, q);
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b>${badge(x.rider_id, 'rider')} <span class="tag">${esc(STEP_LABEL[stageOf(x)])}</span>${x.rider_confirmed_at ? ' <span class="tag">rider confirmed</span>' : ''}<div class="mut">${x.pay_with === 'points' ? x.points + ' pts held until drop-off' : 'cash gas-share'}${q ? ' &middot; ' + esc(q.pickup) + ' to ' + esc(q.dropoff) : ''}</div>
        <div style="margin-top:6px">${open ? `<button class="btn" data-step="${x.id}|${ns.step}">${ns.label}</button>` : '<span class="mut">Steps open 2 hours before pickup.</span>'} ${link && open ? `<a class="btn ghost" style="display:inline-block;text-decoration:none" href="${link}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''} ${canNoShow(x) ? `<button class="btn ghost" data-noshow="${x.id}">Mark no-show</button>` : ''}</div></div>`; }).join('') : '<p class="mut">No riders yet.</p>');
    const near = card('People who need a ride along your route', found.length ? found.map((m) => { const q = reqById[m.rider.id]; return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b>${nm(q.user_id)}</b>${badge(q.user_id, 'rider')}${tagsFor(q.user_id, 'rider')}${q.live ? ' <span class="tag">needs a ride now</span>' : ''} <span class="mut">${esc(q.pickup)} to ${esc(q.dropoff)} &middot; +${Math.round(m.addedDetour)} min detour &middot; pick up ${RS.clock(m.pickupAt)} &middot; drop ${RS.clock(m.dropAt)}</span></div>`; }).join('') : '<p class="mut">Nobody matching on this date.</p>');
    return dateCard + summary + '<div id="seat-requests">' + reqs + '</div><div id="riding-with-me">' + riding + '</div>' + near;
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
      return card('Confirm your request', `<p><b>${esc(disp(r, 'pickup'))}</b> to <b>${esc(disp(r, 'dropoff'))}</b></p><p>${RSD.label(r.ride_date)}, ready ${RS.clock(r.ready_from)} to ${RS.clock(r.ready_to)}${r.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(r.repeat_days) : ' &middot; one time'}</p>
        <p class="mut">Paying with ${r.pays === 'either' ? 'points or cash' : r.pays === 'points' ? 'points' : 'cash gas-share'}</p>
        <div style="margin-top:10px"><button class="btn" id="lr-confirm">${myReq ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lr-back">Back</button></div>`);
    }
    if (myReq && !editing.req) return '';
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: S_().r_pays, ride_date: todayStr(), repeat_days: [] };
    const date = defaultDate(r.ride_date, r.ready_from);
    return card(myReq ? 'My ride' : 'Where to?', `${placeField('lr-p', 'Pick me up at', myReq, 'pickup', r.pickup)}${placeField('lr-d', 'Drop me at', myReq, 'dropoff', r.dropoff)}
      <label>Date</label><input type="date" id="lr-date" min="${todayStr()}" max="${maxDate()}" value="${date}">
      <div class="row"><div><label>Ready from</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"></div><div><label>Ready until</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lr-days', r.repeat_days)}
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="lr-review">Review request</button>${myReq ? ' <button class="btn ghost" data-edit-off="req">Cancel</button>' : ''}</div><p class="warn" id="lr-msg" role="alert"></p>
      <div class="mut" style="margin-top:10px">Your points: <b>${me.points} pts</b></div>`);
  }

  function riderLists() {
    if (!curReq || !known(curReq)) return card('Drivers going your way', '<p class="mut">Post your request on the left to see drivers.</p>');
    const dates = RSD.nextOccurrences(curReq.live ? todayStr() : curReq.ride_date, curReq.repeat_days, new Date(), 7);
    viewR = pickView(viewR, dates);
    const dateCard = card('Date', dateChips('lr-dates', dates, viewR) + `<p class="mut" style="margin-top:8px">Ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(curReq.repeat_days) : ' &middot; one time'}</p>`);
    if (!viewR) return dateCard;
    const meO = riderObj(curReq), tripById = {}; [...otherTrips, ...extraTrips].forEach((t) => { tripById[t.id] = t; });
    const mine = matches.filter((x) => x.rider_id === user.id && x.request_id === curReq.id && x.ride_date === viewR);
    const accepted = mine.find((x) => x.status === 'accepted' || x.status === 'completed'), accTrip = accepted && tripById[accepted.trip_id];
    let html = dateCard, mapStops = [{ loc: meO.pickup, type: 'pickup', rider: meO }, { loc: meO.dropoff, type: 'dropoff', rider: meO }];
    if (accepted && accTrip && known(accTrip)) {
      const stops = RS.buildRoute(driverObj(accTrip, accepted.ride_date), [meO]) || RS.buildRoute(driverObj(accTrip, accepted.ride_date), [meO], true);
      if (stops) { mapStops = stops; window.__lrStops = stops; window.__lrDriver = names[accTrip.user_id] || 'Your driver'; window.__lrMe = meO; }
      const stg = stageOf(accepted), dn = nm(accTrip.user_id);
      const live = { accepted: `${dn} accepted. They will tap <b>On my way</b> when they set off.`, on_my_way: `<b>${dn} is on the way.</b>`, arrived: `<b>${dn} has arrived.</b> Look for them at the pickup spot.`, picked_up: `<b>Ride in progress</b> with ${dn}.`, dropped_off: `<b>You have arrived.</b> Thanks for sharing the ride!` }[stg];
      const inCar = stg === 'picked_up' ? (accepted.rider_confirmed_at ? '<span class="tag">You confirmed you are in the car</span>' : `<button class="btn" data-incar="${accepted.id}">I'm in the car</button>`) : '';
      html += card('Your ride', `<p>${live}</p>${trackInfo(accepted, accTrip, meO)}${rideStats(accepted)}<p class="mut">${esc(RSD.label(viewR))} &middot; ${accepted.pay_with === 'points' ? accepted.points + ' pts' + (stg === 'dropped_off' ? ' paid' : ' held until drop-off') : 'cash gas-share (settle with your driver)'}</p>${inCar}<p style="margin-top:8px"><button class="btn ghost" id="lr-watch">Preview route</button> <button class="btn ghost" id="lr-stop">Stop</button></p>${stg === 'accepted' || stg === 'on_my_way' ? '<p class="mut">To cancel, open the Upcoming tab.</p>' : ''}`);
    }
    let list = '';
    otherTrips.filter((t) => known(t) && tripOn(t, viewR)).forEach((t) => {
      const dr = driverObj(t, viewR), found = RS.findMatches(dr, [meO], []); if (!found.length) return;
      const m = found[0], dollars = RS.priceRoute(m.stops, dr.cpk).riderPay.get(meO) || 0, pts = RS.toPoints(dollars);
      const payWith = curReq.pays === 'either' ? (t.accepts === 'cash' ? 'cash' : 'points') : curReq.pays;
      if (!(t.accepts === 'either' || t.accepts === payWith)) return;
      const st = mine.find((x) => x.trip_id === t.id);
      const price = payWith === 'points' ? pts + ' pts' : RS.money(dollars);
      const btn = st ? `<span class="tag">${esc(statusText(st.status))}</span>${st.status === 'requested' ? ` <button class="btn ghost" data-can="${st.id}">Cancel</button>` : ''}` : `<button class="btn" data-req="${t.id}" data-pay="${payWith}" data-pts="${pts}" data-date="${viewR}">Request &middot; ${price}</button>`;
      list += `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(t.user_id)}</b>${badge(t.user_id, 'driver')}${tagsFor(t.user_id, 'driver')}${t.live ? ' <span class="tag">leaving now</span>' : ''} <span class="mut">leaves ${RS.clock(t.depart_min)} &middot; picks you up ${RS.clock(m.pickupAt)} &middot; drops ${RS.clock(m.dropAt)} &middot; adds ${Math.round(m.addedDetour)} min for them</span><div style="margin-top:6px">${btn}</div></div>`;
    });
    html += card('Drivers going your way on ' + esc(RSD.label(viewR)), list || '<p class="mut">No drivers match on this date. Check back soon.</p>');
    const sig = routeSig(mapStops) + viewR; if (mapSig.r !== sig) { mapSig.r = sig; window.RS_UI.drawMap('map-lr', mapStops); }
    return html;
  }

  // ---------- upcoming tab ----------
  function upcomingMain() {
    const t0 = todayStr(), tripById = {}, reqById = {};
    [...otherTrips, ...extraTrips].concat(curTrip ? [curTrip] : []).forEach((t) => { tripById[t.id] = t; });
    [...otherReqs, ...extraReqs].concat(curReq ? [curReq] : []).forEach((q) => { reqById[q.id] = q; });
    const mineTrip = curTrip ? `<div style="padding:6px 0"><b>${esc(disp(curTrip, 'origin'))} to ${esc(disp(curTrip, 'dest'))}</b><div class="mut">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-driver">Edit</button> <button class="btn ghost" data-offtrip="${curTrip.id}">Take it down</button></div></div>` : '<p class="mut">No trip posted. Use <b>I\'m driving</b>.</p>';
    const mineReq = curReq ? `<div style="padding:6px 0"><b>${esc(disp(curReq, 'pickup'))} to ${esc(disp(curReq, 'dropoff'))}</b><div class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(curReq.repeat_days) : ' &middot; one time'}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-rider">Edit</button> <button class="btn ghost" data-offreq="${curReq.id}">Take it down</button></div></div>` : '<p class="mut">No ride requested. Use <b>I need a ride</b>.</p>';
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
        if ((isRider || x.status === 'accepted') && !x.picked_up_at) b.push(`<button class="btn ghost" data-cancelask="${x.id}">${x.status === 'requested' ? 'Cancel request' : 'Cancel ride'}</button>`);
        actions = b.length ? `<div style="margin-top:6px">${b.join(' ')}</div>` : '';
      }
      const held = x.status === 'accepted' && x.pay_with === 'points' && !x.settled ? ' (held until the ride)' : '';
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${when(x)}</b> <span class="tag">${esc(x.status === 'accepted' ? STEP_LABEL[stageOf(x)] : statusText(x.status))}</span><div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(other)}${badge(other, isRider ? 'driver' : 'rider')} &middot; ${pay}${held}</div>${actions}</div>`;
    };
    const riderRows = asRider.length ? asRider.map((x) => row(x, true)).join('') : '<p class="mut">No upcoming rides.</p>';
    const driverRows = asDriver.length ? asDriver.map((x) => row(x, false)).join('') : '<p class="mut">No upcoming passengers.</p>';
    const past = matches.filter((x) => ['completed', 'cancelled', 'no_show', 'declined'].includes(x.status)).slice(0, 8);
    const pastRows = past.length ? past.map((x) => { const isRider = x.rider_id === user.id; return `<div style="padding:6px 0;border-top:1px solid var(--line)">${when(x)} <span class="tag">${esc(statusText(x.status))}</span><div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(isRider ? x.driver_id : x.rider_id)} &middot; ${x.pay_with === 'points' ? x.points + ' pts' : 'cash'}${x.refunded ? ' &middot; ' + x.refunded + ' pts returned' : ''}</div></div>`; }).join('') : '<p class="mut">Nothing yet.</p>';
    const policy = `<p class="mut">Points are held when a driver accepts, and paid to the driver after the ride.</p>
      <ul class="mut" style="margin:6px 0 0 18px;padding:0"><li>Cancel more than 2 hours before pickup: all points back.</li><li>Cancel within 2 hours: your first one each month is free; after that the driver keeps half.</li><li>You can't cancel after the pickup time. If a rider doesn't show, the driver can mark a no-show after waiting.</li><li>If a driver cancels, the rider gets all points back.</li><li>Cash rides: no points move.</li></ul>`;
    return card('My trip', mineTrip) + card('My ride request', mineReq) + card('Upcoming rides (as a rider)', riderRows) + card('Upcoming passengers (as a driver)', driverRows) + card('Recent', pastRows) + card('Cancellation rules', policy);
  }

  // ---------- settings tab ----------
  const CHAT = [['quiet', 'Quiet ride (prefer not to talk)'], ['some', 'A bit of chat is fine'], ['chatty', 'Happy to chat']];
  function settingsMain() {
    const x = S_(), sel = (id, list, cur) => '<select id="' + id + '" style="' + INPUT + '">' + list.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    const chk = (id, on, text) => '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + text + '</label>';
    const num = (id, v, max) => '<input type="number" id="' + id + '" min="0" max="' + max + '" value="' + v + '" style="' + INPUT + '">';
    return card('Driver settings', '<p class="mut">These fill in each new trip for you. You can still change them on any trip before you post it. Once a rider is accepted, a trip cannot be changed.</p>'
      + '<label>Most extra minutes for ONE pickup</label>' + num('ls-detour', x.d_detour, 60)
      + '<label>Longest I will wait at a pickup (min)</label>' + num('ls-wait', x.d_wait, 60)
      + '<label>I accept</label>' + sel('ls-accepts', [['either', 'Points or cash'], ['points', 'Points only'], ['cash', 'Cash gas-share only']], x.d_accepts)
      + '<label>Most riders I will pick up</label>' + sel('ls-seats', [1, 2, 3, 4].map((n) => [n, n === 1 ? 'Just 1 (a single pickup)' : 'Up to ' + n]), Math.min(4, x.d_seats))
      + '<label>Most extra minutes for ALL pickups together (if more than 1 rider)</label>' + num('ls-total', x.d_total_detour, 120)
      + chk('ls-auto', x.d_auto_accept, 'Accept the first rider automatically (if they can pay). Later riders wait for my tap, so my total time limit is respected')
      + '<label>My ride style</label>' + sel('ls-dchat', CHAT, x.d_chat)
      + chk('ls-dpets', x.d_pets, 'Pets are welcome in my car')
      + '<div style="margin-top:12px"><button class="btn" id="ls-save-d">Save driver settings</button></div>')
      + card('Rider settings', '<p class="mut">These fill in each new ride request for you.</p>'
      + '<label>I usually pay with</label>' + sel('ls-pays', [['points', 'Points'], ['cash', 'Cash gas-share']], x.r_pays)
      + '<label>My ride style</label>' + sel('ls-rchat', CHAT, x.r_chat)
      + chk('ls-rpets', x.r_pets, 'I travel with a pet')
      + '<div style="margin-top:12px"><button class="btn" id="ls-save-r">Save rider settings</button></div>')
      + (isTest ? card('Admin and test tools (only you see this)', '<p><b>Test mode: ' + (testMode ? 'ON' : 'OFF') + '</b></p><p class="mut">While test mode is ON and driving mode is running (after Start my trip), a made-up rider asks for a seat on your trip about every 2 minutes, so you get alerts while you navigate.</p><p><button class="btn' + (testMode ? ' ghost' : '') + '" id="ts-mode">' + (testMode ? 'Turn test mode OFF' : 'Turn test mode ON') + '</button></p><hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><p class="mut">Or send one test request by hand. Pick a delay if you want to start driving first.</p><label>Send it</label><select id="ts-delay" style="' + INPUT + '"><option value="0">Right now</option><option value="30" selected>In 30 seconds</option><option value="60">In 1 minute</option><option value="120">In 2 minutes</option></select><div style="margin-top:10px"><button class="btn" id="ts-send">Send a test request</button> <button class="btn ghost" id="ts-clear">Remove test requests</button></div><hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><p class="mut">Pretend to drive without moving. First tap <b>Start trip</b> in the Trip plan, then:</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="ts-fake-pick">Pretend I am at the next pickup</button><button class="btn ghost" id="ts-fake-drop">Pretend I am at the next drop-off</button><button class="btn ghost" id="ts-fake-off">Use my real GPS again</button></div>') : '')
      + (nativeLoc() ? card('Rider alerts', '<p><b>Status: ' + (dndOn ? 'ON' : 'OFF') + '</b></p><p class="mut">' + (dndOn ? 'Seat requests can alert you even when your phone is on Do Not Disturb or Sleeping mode.' : 'Seat requests are silent when your phone is on Do Not Disturb or Sleeping mode. Tap the button, then switch on <b>Override Do Not Disturb</b> on the screen that opens.') + '</p><p><button class="btn' + (dndOn ? ' ghost' : '') + '" id="dnd-go">' + (dndOn ? 'Open alert settings' : 'Let alerts break through Do Not Disturb') + '</button></p>') : '')
      + card('Layout', '<p class="mut">You are using the new layout. If something feels off, you can switch back at any time.</p><p><button class="btn ghost" data-uimode="classic">Use the old layout</button></p>')
      + card('Good to know', '<p class="mut">Driver and rider settings are separate, so you can be both at the same time. Other people only see your ride style (like "quiet ride") and whether you accept automatically. Nothing else in here is shared.</p>');
  }
  const saveSettings = () => {
    const g = (id) => $(id), n = (id, max) => Math.max(0, Math.min(max, Math.round(+g(id).value || 0)));
    const base = S_(), row = Object.assign({}, base, { user_id: user.id, updated_at: new Date().toISOString() });
    if (g('ls-detour')) Object.assign(row, { d_detour: n('ls-detour', 60), d_wait: n('ls-wait', 60), d_accepts: g('ls-accepts').value, d_seats: Math.max(1, Math.min(4, +g('ls-seats').value || 1)), d_total_detour: n('ls-total', 120), d_auto_accept: g('ls-auto').checked, d_chat: g('ls-dchat').value, d_pets: g('ls-dpets').checked });
    if (g('ls-pays')) Object.assign(row, { r_pays: g('ls-pays').value, r_chat: g('ls-rchat').value, r_pets: g('ls-rpets').checked });
    return row;
  };

  // ---------- points tab ----------
  function walletMain() {
    const sum = (list) => list.reduce((a, x) => a + x.points, 0), heldList = matches.filter((x) => x.status === 'accepted' && !x.settled && x.pay_with === 'points');
    const heldAsRider = sum(heldList.filter((x) => x.rider_id === user.id)), pendingAsDriver = sum(heldList.filter((x) => x.driver_id === user.id));
    return card('Me', `<label>First name shown to others</label><input type="text" id="lv-name" maxlength="30" value="${esc(me.name)}" style="${INPUT}">
      <div style="margin-top:8px"><button class="btn ghost" id="lv-savename">Save name</button></div>
      <div class="stat" style="margin-top:12px"><div><span class="mut">Points balance</span><b>${me.points}</b></div><div><span class="mut">On hold (your rides)</span><b>${heldAsRider}</b></div><div><span class="mut">Coming to you</span><b>${pendingAsDriver}</b></div><div><span class="mut">Value</span><b>1 pt = $0.10</b></div></div>
      <p class="mut">Earn points by driving riders who pay in points. Spend them when you ride. Points can't be cashed out or transferred, and they never exceed the real cost of the trip, so nobody profits.</p>`)
      + card('Your data', '<p class="mut">We store your first name, email, the neighbourhood-level areas you post, your rides and your points. Your live location is shared only while you are driving a ride, and deleted when it ends. <a href="privacy.html">Privacy policy</a> &middot; <a href="terms.html">Terms</a></p><label>To erase your account and all your data, type DELETE</label><input type="text" id="del-confirm" autocomplete="off" style="' + INPUT + '"><div style="margin-top:8px"><button class="btn ghost" id="del-go" disabled>Delete my account</button></div><p class="warn" id="del-msg" role="alert"></p>')
      + card('Track yourself', '<p class="mut">Walk or drive and watch yourself move on the map, with speed, distance and a trail. Your location stays on this device.</p><a class="btn" href="gps.html" style="display:inline-block;text-decoration:none">Open GPS test</a>')
      + card('History', ledger.length ? ledger.map((x) => `<div style="padding:4px 0">${(x.delta > 0 ? '+' : '') + x.delta} pts <span class="mut">${esc(x.reason)}</span></div>`).join('') : '<p class="mut">Nothing yet.</p>');
  }

  // ---------- render + wiring ----------
  function render() {
    renderAuth();
    if (!user) { ['ld-top', 'lr-top'].forEach((id) => { $(id).innerHTML = ''; }); ['ld-form', 'ld-lists', 'lr-form', 'lr-lists', 'lu-main', 'lw-main', 'ls-main'].forEach((id) => { $(id).innerHTML = /form|main/.test(id) ? hint : ''; }); return; }
    const sig = JSON.stringify([myTrip, myReq, me.points, pending, mySet, isTest, testMode]);
    const typing = document.activeElement && /^(lt|lr|lv|ls|ln|rn)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON' && !pending;
    if (!typing && sig !== formSig) { formSig = sig; $('ld-form').innerHTML = guard('trip form', driverForm); $('lr-form').innerHTML = guard('ride form', riderForm); $('lw-main').innerHTML = guard('points', walletMain); $('ls-main').innerHTML = guard('settings', settingsMain); }
    const busyIn = (id) => { const a = document.activeElement; return a && /SELECT|INPUT/.test(a.tagName) && a.closest && a.closest('#' + id); };
    try { renderRequests(); } catch (e) { console.error('requests', e); }
    if (!busyIn('ld-top')) try { renderPlan(); } catch (e) { console.error('plan', e); }
    if (!busyIn('ld-top')) $('ld-top').innerHTML = guard('leave now', driverNow) + guard('driver summary', driverTop) + guard('drive log', driveLogCard);
    if (!busyIn('lr-top')) $('lr-top').innerHTML = guard('ride now', riderNow) + guard('rider summary', riderTop);
    $('ld-lists').innerHTML = guard('riders list', driverLists);
    $('lr-lists').innerHTML = guard('drivers list', riderLists);
    $('lu-main').innerHTML = guard('upcoming', upcomingMain);
    applyCar(); syncSharing();
    try { wire(); } catch (e) { console.error('wire', e); showErr('buttons: ' + (e && e.message || e)); }
  }

  async function run(p, ok) { try { const r = await p; if (r.error) throw r.error; if (ok) toast(ok); return true; } catch (e) { fail(e); return false; } finally { formSig = ''; await loadAll(); } }

  function wire() {
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    document.querySelectorAll('#lt-days button, #lr-days button').forEach((b) => (b.onclick = () => b.classList.toggle('on')));
    on('lt-review', () => {
      const row = { origin: $('lt-o').value, dest: $('lt-d').value, trip_date: $('lt-date').value, depart_min: hm($('lt-t').value || '07:30'), repeat_days: readDays('lt-days'), max_detour: +$('lt-dt').value, max_total_detour: +$('lt-tt').value, max_pickups: +$('lt-pk').value, max_wait: +$('lt-w').value, accepts: $('lt-a').value, ...plCols('lt-o', 'origin'), ...plCols('lt-d', 'dest') };
      const need = plNeed('lt-o', 'where you start') || plNeed('lt-d', 'where you are going'); if (need) { formMsg('lt-msg', need); return; }
      if (row.max_pickups === 1) row.max_total_detour = null; else if (row.max_total_detour < row.max_detour) { formMsg('lt-msg', 'The total for all pickups cannot be less than the time for one pickup'); return; }
      formMsg('lt-msg', '');
      if (samePlace(row.origin, row.dest, 'lt-o', 'lt-d')) { formMsg('lt-msg', 'Pick two different places'); return; }
      if (!row.trip_date) { formMsg('lt-msg', 'Pick a date'); return; }
      const bad = RSD.check(row.trip_date, row.depart_min); if (bad) { formMsg('lt-msg', bad); return; }
      pending = { kind: 'trip', row }; formSig = ''; render();
    });
    on('lt-back', () => { pending = null; formSig = ''; render(); });
    on('lt-confirm', async () => {
      const row = pending.row; const ok = await run(myTrip ? sb.from('trips').update(row).eq('id', myTrip.id) : sb.from('trips').insert(row), 'Trip saved');
      if (ok) { editing.trip = false; plReset('lt-o', 'lt-d'); pending = null; viewD = null; mapSig = {}; formSig = ''; render(); }
    });
    on('lr-review', () => {
      const row = { pickup: $('lr-p').value, dropoff: $('lr-d').value, ride_date: $('lr-date').value, ready_from: hm($('lr-f').value || '07:20'), ready_to: hm($('lr-u').value || '07:50'), repeat_days: readDays('lr-days'), pays: $('lr-pay').value, ...plCols('lr-p', 'pickup'), ...plCols('lr-d', 'dropoff') };
      formMsg('lr-msg', '');
      const need = plNeed('lr-p', 'where to pick you up') || plNeed('lr-d', 'where to drop you off'); if (need) { formMsg('lr-msg', need); return; }
      if (samePlace(row.pickup, row.dropoff, 'lr-p', 'lr-d')) { formMsg('lr-msg', 'Pick two different places'); return; }
      if (!row.ride_date) { formMsg('lr-msg', 'Pick a date'); return; }
      if (row.ready_to < row.ready_from) { formMsg('lr-msg', '"Ready until" must be after "Ready from"'); return; }
      const bad = RSD.check(row.ride_date, row.ready_from); if (bad) { formMsg('lr-msg', bad); return; }
      pending = { kind: 'req', row }; formSig = ''; render();
    });
    on('lr-back', () => { pending = null; formSig = ''; render(); });
    on('lr-confirm', async () => {
      const row = pending.row; const ok = await run(myReq ? sb.from('ride_requests').update(row).eq('id', myReq.id) : sb.from('ride_requests').insert(row), 'Request saved');
      if (ok) { editing.req = false; plReset('lr-p', 'lr-d'); pending = null; viewR = null; mapSig = {}; formSig = ''; render(); }
    });
    if ($('del-confirm')) $('del-confirm').oninput = () => { $('del-go').disabled = $('del-confirm').value.trim() !== 'DELETE'; };
    on('del-go', async () => {
      if ($('del-confirm').value.trim() !== 'DELETE') return;
      const r = await sb.rpc('delete_my_account');
      if (r.error) { formMsg('del-msg', r.error.message); return; }
      toast('Your account and data were deleted.'); try { await sb.auth.signOut(); } catch (e) {}
    });
    ['ls-save-d', 'ls-save-r'].forEach((id) => on(id, () => run(sb.from('user_settings').upsert(saveSettings()), 'Settings saved')));
    on('lv-savename', () => { const v = $('lv-name').value.trim(); if (!v) { toast('Enter a name'); return; } run(sb.from('profiles').update({ display_name: v }).eq('id', user.id), 'Name saved'); });
    // routeOnly: just show the new route in Google Maps (from the Update route alert); it does not start the trip or tell the riders you are on your way.
    const startNav = async (routeOnly) => {
      const stops = window.__ldStops || [];
      if (stops.length < 2) { toast('Nothing to navigate yet'); return; }
      const pt = (x) => x.loc.lat + ',' + x.loc.lng, mid = stops.slice(1, -1).map(pt);
      const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' + (routeOnly ? '' : '&dir_action=navigate') + '&destination=' + pt(stops[stops.length - 1]) + (mid.length ? '&waypoints=' + encodeURIComponent(mid.join('|')) : '');
      const todo = routeOnly ? [] : (window.__ldAcc || []).filter((x) => stageOf(x) === 'accepted' && stepsOpen(x));
      const nat = nativeLoc();
      if (!nat) {
        window.open(url, '_blank', 'noopener');
        if (todo.length) { Promise.all(todo.map((x) => sb.rpc('ride_step', { p_match: x.id, p_step: 'on_my_way' }))).then(() => loadAll()); toast('Your riders can see you are on the way'); }
        return;
      }
      if (!routeOnly && await dndAsk(nat)) return;   // first time only: the driver went to the Do Not Disturb setting, so wait for them to come back
      // Android app: tell the riders, start background sharing, THEN hand over to Google Maps for voice directions.
      if (todo.length) { await Promise.all(todo.map((x) => sb.rpc('ride_step', { p_match: x.id, p_step: 'on_my_way' }))); toast('Your riders can see you are on the way'); }
      if (!routeOnly || !driveSession) { shareWatch = 'native-pending'; const ok = await startNativeShare(nat); if (!ok) shareWatch = null; else driveSession = true; paintSharing(); }
      try { await nat.openUrl({ url }); } catch (e) { window.open(url, '_blank', 'noopener'); }
      loadAll();
    };
    on('plan-full', () => {
      const box = $('map-plan-box'), full = box.classList.toggle('full');
      $('plan-full').textContent = full ? 'Close' : 'Full screen'; document.body.style.overflow = full ? 'hidden' : '';
      setTimeout(() => { mapSig.p = ''; try { renderPlan(); } catch (e) { console.error('plan map', e); } }, 250);
    });
    on('ld-go', () => startNav());
    window.__startNav = startNav;
    on('ld-start', () => { if (window.__ldStops) window.RS_UI.startSim('ld', 'map-ld', window.__ldStops, 'You', 'driver'); });
    on('ld-stop', () => window.RS_UI.stopSim('ld'));
    on('lr-watch', () => { if (window.__lrStops) window.RS_UI.startSim('lr', 'map-lr', window.__lrStops, window.__lrDriver, 'rider', window.__lrMe); });
    on('lr-stop', () => window.RS_UI.stopSim('lr'));
    const each = (sel, fn) => document.querySelectorAll(['#v-ldriver', '#v-lrider', '#v-lupcoming'].map((r) => r + ' ' + sel).join(', ')).forEach((b) => (b.onclick = () => fn(b)));
    const sendTest = (d) => run(sb.rpc('send_test_request', { p_delay: d }), d ? 'A test rider will ask for a seat in ' + d + ' seconds' : 'A test rider just asked for a seat');
    each('[data-testsend]', (b) => sendTest(+b.dataset.testsend));
    on('ts-send', () => sendTest(+$('ts-delay').value));
    on('ts-mode', () => run(sb.rpc('set_test_mode', { p_on: !testMode }), testMode ? 'Test mode is off' : 'Test mode is on. Start my trip, then watch your phone.'));
    on('ts-clear', () => run(sb.rpc('clear_test_requests'), 'Test requests removed'));
    // Pretend the car is at the next stop (the phone helper then shows the Picked up / Dropped off notification, as if you had driven there).
    const fakeAt = (kind) => {
      const nat = nativeLoc(); if (!nat || !nat.fakeLocation) { toast('This only works in the Android app'); return; }
      const acc = (window.__ldAcc || []).filter((x) => (kind === 'pick' ? !x.picked_up_at : x.picked_up_at && !x.dropped_off_at));
      const st = window.__ldStops || [];
      let stop = null; for (const x of acc) { stop = st.find((q) => q.type === (kind === 'pick' ? 'pickup' : 'dropoff') && q.rider && q.rider.id === x.request_id); if (stop) break; }
      if (!stop) { toast(kind === 'pick' ? 'No rider is waiting to be picked up. Accept a rider and tap Start trip first.' : 'No rider has been picked up yet.'); return; }
      nat.fakeLocation({ lat: stop.loc.lat, lng: stop.loc.lng }).then(() => toast('Pretending you are at ' + (kind === 'pick' ? 'the pickup' : 'the drop-off') + '. A notification should appear within 15 seconds.')).catch(() => toast('Could not start the pretend position'));
    };
    on('ts-fake-pick', () => fakeAt('pick'));
    on('ts-fake-drop', () => fakeAt('drop'));
    on('ts-fake-off', () => { const nat = nativeLoc(); if (nat && nat.clearFakeLocation) nat.clearFakeLocation().then(() => toast('Using your real GPS again')); });
    each('[data-stopdrive]', () => { stopShare(true); toast('Driving mode is off'); render(); });
    // Reset trip: start over at any time (after a trip, or when something went wrong).
    const resetTrip = async () => {
      const live = !!myLiveTrip;
      if (!window.confirm('Reset this trip?\n\nRiders who are not picked up yet are cancelled (their points go back to them). ' + (live ? 'Your Offer a ride now trip is taken down. ' : 'Your posted trip stays. ') + 'Driving mode turns off. You can start a new trip right after.')) return;
      const todo = matches.filter((x) => x.driver_id === user.id && (x.status === 'accepted' || x.status === 'requested') && !x.picked_up_at);
      for (const x of todo) { try { await (x.status === 'requested' ? sb.rpc('respond_match', { p_match: x.id, p_accept: false }) : sb.rpc('cancel_ride', { p_match: x.id })); } catch (e) { /* already finished */ } }
      if (myLiveTrip) { try { await sb.from('trips').update({ active: false }).eq('id', myLiveTrip.id); } catch (e) { /* ignore */ } }
      if (isTest) { try { await sb.rpc('clear_test_requests'); } catch (e) { /* ignore */ } }
      stopShare(true); editing.trip = false; pending = null; viewD = null; mapSig = {}; formSig = '';
      toast('Trip reset. You can start a new one.'); await loadAll();
    };
    each('[data-reset]', () => resetTrip());
    each('[data-startnav]', () => startNav());
    on('dnd-go', async () => { const n = nativeLoc(); toast('Opening the alert settings...'); try { await n.openAlertSettings(); } catch (e) { toast('Could not open the settings. Open Settings > Apps > RideShare App > Notifications > Seat requests.'); } });
    each('[data-edit]', (b) => { editing[b.dataset.edit] = true; formSig = ''; render(); const f = $(b.dataset.edit === 'trip' ? 'ld-form' : 'lr-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    each('[data-edit-off]', (b) => { editing[b.dataset.editOff] = false; pending = null; formSig = ''; plReset('lt-o', 'lt-d', 'lr-p', 'lr-d'); render(); });
    each('[data-scroll]', (b) => { const e = $(b.dataset.scroll); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.querySelectorAll('#ln-o, #ln-d, #rn-p, #rn-d, #rn-pay').forEach((e) => { e.onchange = () => { nowSel[e.id] = e.value; }; });
    wirePlaces();
    on('ln-loc', () => useMyLocation('ln-o', 'ln-msg'));
    on('rn-loc', () => useMyLocation('rn-p', 'rn-msg'));
    on('ln-go', async () => {
      const o = $('ln-o').value, d = $('ln-d').value, need = plNeed('ln-o', 'where you start') || plNeed('ln-d', 'where you are going'); if (need) { formMsg('ln-msg', need); return; }
      if (samePlace(o, d, 'ln-o', 'ln-d')) { formMsg('ln-msg', 'Pick two different places'); return; }
      const f = myTrip || {}, cols = [plCols('ln-o', 'origin'), plCols('ln-d', 'dest')]; const ok = await run(sb.rpc('go_live_trip', { p_origin: o, p_dest: d, p_max_detour: f.max_detour == null ? S_().d_detour : f.max_detour, p_max_wait: f.max_wait == null ? S_().d_wait : f.max_wait, p_accepts: f.accepts || S_().d_accepts, p_cost_per_km: 0.2, p_minutes: 720, p_max_pickups: Math.min(4, S_().d_seats), p_max_total_detour: Math.min(4, S_().d_seats) > 1 ? Math.max(S_().d_total_detour, f.max_detour == null ? S_().d_detour : f.max_detour) : null }).then(async (r) => { if (!r.error) await setCols('trips', r.data, ...cols); return r; }), 'You are live. Switch it off when you stop driving.');
      if (ok) { viewD = null; mapSig = {}; const nat = nativeLoc(); if (nat) { await dndAsk(nat); if (await startAlerts(nat)) toast('Alerts are on. You will get a phone alert when a rider asks for a seat.'); } }
    });
    on('rn-go', async () => {
      const p = $('rn-p').value, d = $('rn-d').value, need = plNeed('rn-p', 'where to pick you up') || plNeed('rn-d', 'where to drop you off'); if (need) { formMsg('rn-msg', need); return; }
      if (samePlace(p, d, 'rn-p', 'rn-d')) { formMsg('rn-msg', 'Pick two different places'); return; }
      const cols = [plCols('rn-p', 'pickup'), plCols('rn-d', 'dropoff')];
      const ok = await run(sb.rpc('go_live_request', { p_pickup: p, p_dropoff: d, p_pays: $('rn-pay').value }).then(async (r) => { if (!r.error) await setCols('ride_requests', r.data, ...cols); return r; }), 'Drivers can see you for 20 minutes');
      if (ok) { viewR = null; mapSig = {}; }
    });
    each('[data-stoplive]', (b) => { const isTrip = b.dataset.stoplive === 'trip', row = isTrip ? myLiveTrip : myLiveReq; if (isTrip && driveSession && !shouldShare()) stopShare(true); if (row) run(sb.from(isTrip ? 'trips' : 'ride_requests').update({ active: false }).eq('id', row.id), 'Stopped'); });
    each('#ld-dates button', (b) => { viewD = b.dataset.date; mapSig = {}; render(); });
    each('#lr-dates button', (b) => { viewR = b.dataset.date; mapSig = {}; render(); });
    each('[data-req]', (b) => run(sb.rpc('request_seat', { p_trip: b.dataset.req, p_request: myReq.id, p_pay_with: b.dataset.pay, p_points: +b.dataset.pts, p_date: b.dataset.date }), 'Seat requested'));
    each('[data-can]', (b) => run(sb.rpc('cancel_ride', { p_match: b.dataset.can }), 'Cancelled'));
    each('[data-cancelask]', (b) => { askCancel = b.dataset.cancelask; render(); });
    each('[data-cancelno]', () => { askCancel = null; render(); });
    each('[data-cancelgo]', (b) => { askCancel = null; run(sb.rpc('cancel_ride', { p_match: b.dataset.cancelgo }), 'Ride cancelled. See your points history for any refund.'); });
    each('[data-step]', (b) => { const [id, st] = b.dataset.step.split('|'); run(sb.rpc('ride_step', { p_match: id, p_step: st }), st === 'dropped_off' ? 'Ride complete. Points paid.' : 'Updated'); });
    each('[data-incar]', (b) => run(sb.rpc('rider_in_car', { p_match: b.dataset.incar }), 'Thanks, confirmed'));
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

  // Footer: show which version is running, and a one-tap way to clear saved copies and reload.
  function footer() {
    if ($('ver')) $('ver').textContent = CFG.version || '';
    if ($('hard-refresh')) $('hard-refresh').onclick = async (e) => {
      e.preventDefault();
      try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (x) {}
      location.reload();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', footer); else footer();

  function start(session) {
    user = session ? session.user : null; clearInterval(timer); formSig = ''; mapSig = {}; pending = null; viewD = null; viewR = null; askCancel = null;
    if (!user) { me = { name: '', points: 0 }; render(); return; }
    render(); loadAll(); timer = setInterval(() => { if (!document.hidden) loadAll(); }, 15000);
  }
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => start(session), 0));
  sb.auth.getSession().then(({ data }) => start(data.session));
  sb.channel('rs-matches').on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadAll()).subscribe();
  let liveTimer = 0; const soon = () => { clearTimeout(liveTimer); liveTimer = setTimeout(loadAll, 800); };
  sb.channel('rs-live').on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, soon).on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, soon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_positions' }, (p) => { if (p.new && p.new.driver_id) positions[p.new.driver_id] = p.new; else if (p.old && p.old.driver_id) delete positions[p.old.driver_id]; render(); }).subscribe();
  window.addEventListener('rs-google-ready', () => { mapSig = {}; render(); if (lastPos) applyMe(false); });
  ['t-driver', 't-rider', 't-upcoming', 't-wallet'].forEach((id) => $(id).addEventListener('click', () => { mapSig = {}; render(); loadAll(); }));
})();
