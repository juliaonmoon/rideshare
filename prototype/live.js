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
  let pending = null, viewD = null, viewR = null, askCancel = null, rel = {}, mySet = null, styles = {};
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
    const spot = LOC[stageOf(m) === 'picked_up' ? req.dropoff : req.pickup]; if (!spot) return '';
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + spot.lat + ',' + spot.lng;
  }
  const statusText = (s) => ({ requested: 'requested', accepted: 'accepted', completed: 'completed', cancelled: 'cancelled', declined: 'declined', no_show: 'no-show' }[s] || s);

  const dowOf = (d) => { const x = d && new Date(d + 'T12:00:00'); return x && !isNaN(x) ? x.getDay() : undefined; };
  const driverObj = (t, date) => ({ dow: dowOf(date || t.trip_date), origin: LOC[t.origin], dest: LOC[t.dest], departMin: t.depart_min, maxDetour: t.max_detour, maxTotal: t.max_total_detour == null ? null : t.max_total_detour, maxPickups: t.max_pickups == null ? null : t.max_pickups, maxWait: t.max_wait, accepts: t.accepts, cpk: Number(t.cost_per_km) || 0.2, name: names[t.user_id] || 'Driver' });
  const riderObj = (r) => ({ id: r.id, name: names[r.user_id] || 'Rider', pickup: LOC[r.pickup], dropoff: LOC[r.dropoff], readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];
  const tripOn = (t, d) => RSD.occursOn(t.trip_date, t.repeat_days, d);
  const reqOn = (r, d) => RSD.occursOn(r.ride_date, r.repeat_days, d);

  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      try { await sb.rpc('settle_due'); } catch (e) { /* older database: ignore */ }
      try { await sb.rpc('expire_live'); } catch (e) { /* older database: ignore */ }
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
  function driverTop() {
    if (!curTrip || !known(curTrip)) return card('Start here', `<p><b>1.</b> Fill in the form below: where you drive from and to, the date and time.</p><p><b>2.</b> Tap <b>Review trip</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Riders who ask for a seat will appear on this page for you to accept.</p><p>${goTo('ld-form')}Go to the form</button></p>`);
    const dates = RSD.nextOccurrences(curTrip.trip_date, curTrip.repeat_days, new Date(), 7), d = pickView(viewD, dates);
    const mine = d ? matches.filter((x) => x.driver_id === user.id && x.ride_date === d) : [];
    const asks = mine.filter((x) => x.status === 'requested').length, acc = mine.filter((x) => x.status === 'accepted').length;
    const isToday = d === todayStr();
    const line = asks ? `<b>${asks} rider${asks > 1 ? 's' : ''} asked for a seat.</b> Tap <b>See riders</b> to accept.` : acc ? `<b>${acc} rider${acc > 1 ? 's' : ''} accepted.</b> ${isToday ? 'Tap <b>Start my trip</b> when you set off.' : 'You can start on the day of the trip.'}` : 'No riders yet. They will show up here when they ask for a seat.';
    return card('Your trip', `<p><b>${esc(curTrip.origin)}</b> to <b>${esc(curTrip.dest)}</b></p><p class="mut">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</p><p>${line}</p>
      <div class="row2">${isToday ? '<button class="btn" data-startnav="1">Start my trip</button> ' : ''}${goTo('ld-lists')}See riders</button> ${goTo('ld-form')}Edit trip</button></div>`);
  }
  function riderTop() {
    if (!curReq || !known(curReq)) return card('Start here', `<p><b>1.</b> Fill in the form below: where you want to be picked up and dropped off, the date and when you are ready.</p><p><b>2.</b> Tap <b>Review request</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Pick a driver from the list and tap <b>Request</b>.</p><p>${goTo('lr-form')}Go to the form</button></p>`);
    const dates = RSD.nextOccurrences(curReq.ride_date, curReq.repeat_days, new Date(), 7), d = pickView(viewR, dates);
    const mine = d ? matches.filter((x) => x.rider_id === user.id && x.request_id === curReq.id && x.ride_date === d) : [];
    const acc = mine.find((x) => x.status === 'accepted' || x.status === 'completed'), pend = mine.some((x) => x.status === 'requested');
    const line = acc ? `<b>${esc(STEP_LABEL[stageOf(acc)])}.</b> Tap <b>See my ride</b> for live updates.` : pend ? 'You asked a driver for a seat. Waiting for them to accept.' : 'Pick a driver below and tap <b>Request</b>.';
    return card('Your ride', `<p><b>${esc(curReq.pickup)}</b> to <b>${esc(curReq.dropoff)}</b></p><p class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}</p><p>${line}</p>
      <div class="row2">${goTo('lr-lists')}${acc ? 'See my ride' : 'See drivers'}</button> ${goTo('lr-form')}Edit request</button></div>`);
  }


  // ---------- Leave now (driver) and I need a ride now (rider) ----------
  const nearestArea = (lat, lng) => areas.map((a) => ({ a, km: RS.haversineKm({ lat, lng }, LOC[a]) })).sort((x, y) => x.km - y.km)[0];
  const minsLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
  function driverNow() {
    const share = sharingCard();
    if (myLiveTrip) return share + card('Offer a ride now: ON', `<p><b>${esc(myLiveTrip.origin)}</b> to <b>${esc(myLiveTrip.dest)}</b></p><p class="mut">Leaving about ${RS.clock(myLiveTrip.depart_min)} &middot; riders can see you until you switch it off.</p><p><button class="btn ghost" data-stoplive="trip">Switch OFF</button></p>`);
    const o = nowSel['ln-o'] || (myTrip && myTrip.origin) || 'Surrey Central', d = nowSel['ln-d'] || (myTrip && myTrip.dest) || 'BCIT / Willingdon (Burnaby)';
    return share + card('Not on a schedule? Offer a ride now', `<p class="mut">For a spur-of-the-moment drive: no date or time. Switch it on and riders along your route can ask for a seat. It stays on until you switch it off (it turns itself off after 12 hours, just in case). If you already posted a trip, use <b>Start my trip</b> below instead.</p>
      <label>From</label><select id="ln-o">${opts(o)}</select> <button type="button" class="btn ghost" id="ln-loc" style="margin-top:6px">Use my location</button>
      <label>To</label><select id="ln-d">${opts(d)}</select>
      <div style="margin-top:10px"><button class="btn" id="ln-go" style="width:100%;padding:12px;font-size:16px">Switch ON: offer a ride now</button></div><p class="warn" id="ln-msg" role="alert"></p>`);
  }
  function riderNow() {
    if (myLiveReq) return card('You are looking for a ride now', `<p><b>${esc(myLiveReq.pickup)}</b> to <b>${esc(myLiveReq.dropoff)}</b></p><p class="mut">Visible to drivers for ${minsLeft(myLiveReq.expires_at)} more minutes.</p><p><button class="btn ghost" data-stoplive="req">Stop</button></p>`);
    const p = nowSel['rn-p'] || (myReq && myReq.pickup) || 'Whalley (Surrey)', d = nowSel['rn-d'] || (myReq && myReq.dropoff) || 'Brentwood (Burnaby)', pay = nowSel['rn-pay'] || 'points';
    return card('I need a ride now', `<p class="mut">One tap, no date or time. You are ready now and drivers can see you for 20 minutes.</p>
      <label>Pick me up near</label><select id="rn-p">${opts(p)}</select> <button type="button" class="btn ghost" id="rn-loc" style="margin-top:6px">Use my location</button>
      <label>Drop me near</label><select id="rn-d">${opts(d)}</select>
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
  // In the Android app, a native background helper keeps sending the position while Google Maps is on screen.
  const nativeLoc = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.RideShareLocation) || null;
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
  function stopShare(deleteRow) { const nat = nativeLoc(); if (nat) { try { nat.stop(); } catch (e) {} } if (shareWatch != null && shareWatch !== 'native' && shareWatch !== 'native-pending') { navigator.geolocation.clearWatch(shareWatch); } shareWatch = null; keepAwake(false); if (deleteRow) { try { sb.rpc('stop_sharing'); } catch (e) {} } }
  function syncSharing() { if (!user) { stopShare(false); return; } if (shouldShare()) { if (shareWatch == null) startShare(); } else if (shareWatch != null) stopShare(true); }
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
      const target = LOC[stg === 'picked_up' ? meO.dropoff && Object.keys(LOC).find((k) => LOC[k] === meO.dropoff) : Object.keys(LOC).find((k) => LOC[k] === meO.pickup)];
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
      return card('Confirm your trip', `<p><b>${esc(r.origin)}</b> to <b>${esc(r.dest)}</b></p><p>${whenText(r.trip_date, r.depart_min, r.repeat_days)}</p>
        <p class="mut">${r.max_pickups === 1 ? 'One pickup only' : 'Up to ' + r.max_pickups + ' pickups'} &middot; max ${r.max_detour} extra min for one pickup${r.max_pickups > 1 && r.max_total_detour != null ? ' &middot; max ' + r.max_total_detour + ' extra min for all pickups together' : ''} &middot; max wait ${r.max_wait} min &middot; accepts ${r.accepts === 'either' ? 'points or cash' : r.accepts === 'points' ? 'points only' : 'cash gas-share only'}</p>
        <div style="margin-top:10px"><button class="btn" id="lt-confirm">${myTrip ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lt-back">Back</button></div>`);
    }
    const t = myTrip || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: S_().d_detour, max_total_detour: S_().d_total_detour, max_pickups: Math.min(4, S_().d_seats), max_wait: S_().d_wait, accepts: S_().d_accepts, trip_date: todayStr(), repeat_days: [] };
    const date = defaultDate(t.trip_date, t.depart_min);
    return card(myTrip ? 'My trip' : 'Post a trip', `<label>From</label><select id="lt-o">${opts(t.origin)}</select><label>To</label><select id="lt-d">${opts(t.dest)}</select>
      <div class="row"><div><label>Date</label><input type="date" id="lt-date" min="${todayStr()}" max="${maxDate()}" value="${date}"></div><div><label>Leave at</label><input type="time" id="lt-t" value="${hmIn(t.depart_min)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lt-days', t.repeat_days)}
      <label>Most riders I will pick up</label><select id="lt-pk">${[1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === (t.max_pickups || 1) ? ' selected' : '') + '>' + (n === 1 ? 'Just 1 (a single pickup)' : 'Up to ' + n) + '</option>').join('')}</select>
      <label>Most extra minutes for ONE pickup</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      <label>Most extra minutes for ALL pickups together <span class="mut">(only matters if you take more than 1 rider)</span></label><input type="number" id="lt-tt" min="0" max="120" value="${t.max_total_detour == null ? t.max_detour : t.max_total_detour}">
      <label>Max wait at a pickup (min)</label><input type="number" id="lt-w" min="0" max="60" value="${t.max_wait}">
      <label>I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      <div style="margin-top:10px"><button class="btn" id="lt-review">Review trip</button></div><p class="warn" id="lt-msg" role="alert"></p>`);
  }

  function driverLists() {
    if (!curTrip || !known(curTrip)) return card('Riders', '<p class="mut">Post your trip on the left to see riders along your route.</p>');
    const dates = RSD.nextOccurrences(curTrip.trip_date, curTrip.repeat_days, new Date(), 7);
    viewD = pickView(viewD, dates);
    const dr = driverObj(curTrip, viewD), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const dateCard = card('Date', dateChips('ld-dates', dates, viewD) + `<p class="mut" style="margin-top:8px">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</p>`);
    if (!viewD) return dateCard;
    const mine = matches.filter((x) => x.driver_id === user.id && x.ride_date === viewD);
    const inc = mine.filter((x) => x.status === 'requested');
    const acc = mine.filter((x) => x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    const accObjs = acc.map((x) => riderObj(reqById[x.request_id]));
    const stops = RS.buildRoute(dr, accObjs) || RS.buildRoute(dr, []);
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
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: S_().r_pays, ride_date: todayStr(), repeat_days: [] };
    const date = defaultDate(r.ride_date, r.ready_from);
    return card(myReq ? 'My ride' : 'Where to?', `<label>Pick me up near</label><select id="lr-p">${opts(r.pickup)}</select><label>Drop me near</label><select id="lr-d">${opts(r.dropoff)}</select>
      <label>Date</label><input type="date" id="lr-date" min="${todayStr()}" max="${maxDate()}" value="${date}">
      <div class="row"><div><label>Ready from</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"></div><div><label>Ready until</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}"></div></div>
      <label>Repeat every week on <span class="mut">(optional)</span></label>${dayChips('lr-days', r.repeat_days)}
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="lr-review">Review request</button></div><p class="warn" id="lr-msg" role="alert"></p>
      <div class="mut" style="margin-top:10px">Your points: <b>${me.points} pts</b></div>`);
  }

  function riderLists() {
    if (!curReq || !known(curReq)) return card('Drivers going your way', '<p class="mut">Post your request on the left to see drivers.</p>');
    const dates = RSD.nextOccurrences(curReq.ride_date, curReq.repeat_days, new Date(), 7);
    viewR = pickView(viewR, dates);
    const dateCard = card('Date', dateChips('lr-dates', dates, viewR) + `<p class="mut" style="margin-top:8px">Ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(curReq.repeat_days) : ' &middot; one time'}</p>`);
    if (!viewR) return dateCard;
    const meO = riderObj(curReq), tripById = {}; [...otherTrips, ...extraTrips].forEach((t) => { tripById[t.id] = t; });
    const mine = matches.filter((x) => x.rider_id === user.id && x.request_id === curReq.id && x.ride_date === viewR);
    const accepted = mine.find((x) => x.status === 'accepted' || x.status === 'completed'), accTrip = accepted && tripById[accepted.trip_id];
    let html = dateCard, mapStops = [{ loc: meO.pickup, type: 'pickup', rider: meO }, { loc: meO.dropoff, type: 'dropoff', rider: meO }];
    if (accepted && accTrip && known(accTrip)) {
      const stops = RS.buildRoute(driverObj(accTrip, accepted.ride_date), [meO]);
      if (stops) { mapStops = stops; window.__lrStops = stops; window.__lrDriver = names[accTrip.user_id] || 'Your driver'; window.__lrMe = meO; }
      const stg = stageOf(accepted), dn = nm(accTrip.user_id);
      const live = { accepted: `${dn} accepted. They will tap <b>On my way</b> when they set off.`, on_my_way: `<b>${dn} is on the way.</b>`, arrived: `<b>${dn} has arrived.</b> Look for them at the pickup spot.`, picked_up: `<b>Ride in progress</b> with ${dn}.`, dropped_off: `<b>You have arrived.</b> Thanks for sharing the ride!` }[stg];
      const inCar = stg === 'picked_up' ? (accepted.rider_confirmed_at ? '<span class="tag">You confirmed you are in the car</span>' : `<button class="btn" data-incar="${accepted.id}">I'm in the car</button>`) : '';
      html += card('Your ride', `<p>${live}</p>${trackInfo(accepted, accTrip, meO)}<p class="mut">${esc(RSD.label(viewR))} &middot; ${accepted.pay_with === 'points' ? accepted.points + ' pts' + (stg === 'dropped_off' ? ' paid' : ' held until drop-off') : 'cash gas-share (settle with your driver)'}</p>${inCar}<p style="margin-top:8px"><button class="btn ghost" id="lr-watch">Preview route</button> <button class="btn ghost" id="lr-stop">Stop</button></p>${stg === 'accepted' || stg === 'on_my_way' ? '<p class="mut">To cancel, open the Upcoming tab.</p>' : ''}`);
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
    const mineTrip = curTrip ? `<div style="padding:6px 0"><b>${esc(curTrip.origin)} to ${esc(curTrip.dest)}</b><div class="mut">${whenText(curTrip.trip_date, curTrip.depart_min, curTrip.repeat_days)}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-driver">Edit</button> <button class="btn ghost" data-offtrip="${curTrip.id}">Take it down</button></div></div>` : '<p class="mut">No trip posted. Use <b>I\'m driving</b>.</p>';
    const mineReq = curReq ? `<div style="padding:6px 0"><b>${esc(curReq.pickup)} to ${esc(curReq.dropoff)}</b><div class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${RS.clock(curReq.ready_from)} to ${RS.clock(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatText(curReq.repeat_days) : ' &middot; one time'}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-rider">Edit</button> <button class="btn ghost" data-offreq="${curReq.id}">Take it down</button></div></div>` : '<p class="mut">No ride requested. Use <b>I need a ride</b>.</p>';
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
    const sig = JSON.stringify([myTrip, myReq, me.points, pending, mySet]);
    const typing = document.activeElement && /^(lt|lr|lv|ls)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON' && !pending;
    if (!typing && sig !== formSig) { formSig = sig; $('ld-form').innerHTML = guard('trip form', driverForm); $('lr-form').innerHTML = guard('ride form', riderForm); $('lw-main').innerHTML = guard('points', walletMain); $('ls-main').innerHTML = guard('settings', settingsMain); }
    const busyIn = (id) => { const a = document.activeElement; return a && /SELECT|INPUT/.test(a.tagName) && a.closest && a.closest('#' + id); };
    if (!busyIn('ld-top')) $('ld-top').innerHTML = guard('leave now', driverNow) + guard('driver summary', driverTop);
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
      const row = { origin: $('lt-o').value, dest: $('lt-d').value, trip_date: $('lt-date').value, depart_min: hm($('lt-t').value || '07:30'), repeat_days: readDays('lt-days'), max_detour: +$('lt-dt').value, max_total_detour: +$('lt-tt').value, max_pickups: +$('lt-pk').value, max_wait: +$('lt-w').value, accepts: $('lt-a').value };
      if (row.max_pickups === 1) row.max_total_detour = null; else if (row.max_total_detour < row.max_detour) { formMsg('lt-msg', 'The total for all pickups cannot be less than the time for one pickup'); return; }
      formMsg('lt-msg', '');
      if (row.origin === row.dest) { formMsg('lt-msg', 'Pick two different places'); return; }
      if (!row.trip_date) { formMsg('lt-msg', 'Pick a date'); return; }
      const bad = RSD.check(row.trip_date, row.depart_min); if (bad) { formMsg('lt-msg', bad); return; }
      pending = { kind: 'trip', row }; formSig = ''; render();
    });
    on('lt-back', () => { pending = null; formSig = ''; render(); });
    on('lt-confirm', async () => {
      const row = pending.row; const ok = await run(myTrip ? sb.from('trips').update(row).eq('id', myTrip.id) : sb.from('trips').insert(row), 'Trip saved');
      if (ok) { pending = null; viewD = null; mapSig = {}; formSig = ''; render(); }
    });
    on('lr-review', () => {
      const row = { pickup: $('lr-p').value, dropoff: $('lr-d').value, ride_date: $('lr-date').value, ready_from: hm($('lr-f').value || '07:20'), ready_to: hm($('lr-u').value || '07:50'), repeat_days: readDays('lr-days'), pays: $('lr-pay').value };
      formMsg('lr-msg', '');
      if (row.pickup === row.dropoff) { formMsg('lr-msg', 'Pick two different places'); return; }
      if (!row.ride_date) { formMsg('lr-msg', 'Pick a date'); return; }
      if (row.ready_to < row.ready_from) { formMsg('lr-msg', '"Ready until" must be after "Ready from"'); return; }
      const bad = RSD.check(row.ride_date, row.ready_from); if (bad) { formMsg('lr-msg', bad); return; }
      pending = { kind: 'req', row }; formSig = ''; render();
    });
    on('lr-back', () => { pending = null; formSig = ''; render(); });
    on('lr-confirm', async () => {
      const row = pending.row; const ok = await run(myReq ? sb.from('ride_requests').update(row).eq('id', myReq.id) : sb.from('ride_requests').insert(row), 'Request saved');
      if (ok) { pending = null; viewR = null; mapSig = {}; formSig = ''; render(); }
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
    const startNav = async () => {
      const stops = window.__ldStops || [];
      if (stops.length < 2) { toast('Nothing to navigate yet'); return; }
      const pt = (x) => x.loc.lat + ',' + x.loc.lng, mid = stops.slice(1, -1).map(pt);
      const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + pt(stops[stops.length - 1]) + (mid.length ? '&waypoints=' + encodeURIComponent(mid.join('|')) : '');
      const todo = (window.__ldAcc || []).filter((x) => stageOf(x) === 'accepted' && stepsOpen(x));
      const nat = nativeLoc();
      if (!nat) {
        window.open(url, '_blank', 'noopener');
        if (todo.length) { Promise.all(todo.map((x) => sb.rpc('ride_step', { p_match: x.id, p_step: 'on_my_way' }))).then(() => loadAll()); toast('Your riders can see you are on the way'); }
        return;
      }
      // Android app: tell the riders, start background sharing, THEN hand over to Google Maps for voice directions.
      if (todo.length) { await Promise.all(todo.map((x) => sb.rpc('ride_step', { p_match: x.id, p_step: 'on_my_way' }))); toast('Your riders can see you are on the way'); }
      if (todo.length || (window.__ldAcc || []).some((x) => x.en_route_at)) { shareWatch = 'native-pending'; const ok = await startNativeShare(nat); if (!ok) shareWatch = null; paintSharing(); }
      try { await nat.openUrl({ url }); } catch (e) { window.open(url, '_blank', 'noopener'); }
      loadAll();
    };
    on('ld-go', startNav);
    on('ld-start', () => { if (window.__ldStops) window.RS_UI.startSim('ld', 'map-ld', window.__ldStops, 'You', 'driver'); });
    on('ld-stop', () => window.RS_UI.stopSim('ld'));
    on('lr-watch', () => { if (window.__lrStops) window.RS_UI.startSim('lr', 'map-lr', window.__lrStops, window.__lrDriver, 'rider', window.__lrMe); });
    on('lr-stop', () => window.RS_UI.stopSim('lr'));
    const each = (sel, fn) => document.querySelectorAll(['#v-ldriver', '#v-lrider', '#v-lupcoming'].map((r) => r + ' ' + sel).join(', ')).forEach((b) => (b.onclick = () => fn(b)));
    each('[data-startnav]', () => startNav());
    each('[data-scroll]', (b) => { const e = $(b.dataset.scroll); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.querySelectorAll('#ln-o, #ln-d, #rn-p, #rn-d, #rn-pay').forEach((e) => { e.onchange = () => { nowSel[e.id] = e.value; }; });
    on('ln-loc', () => useMyLocation('ln-o', 'ln-msg'));
    on('rn-loc', () => useMyLocation('rn-p', 'rn-msg'));
    on('ln-go', async () => {
      const o = $('ln-o').value, d = $('ln-d').value; if (o === d) { formMsg('ln-msg', 'Pick two different places'); return; }
      const f = myTrip || {}; const ok = await run(sb.rpc('go_live_trip', { p_origin: o, p_dest: d, p_max_detour: f.max_detour == null ? S_().d_detour : f.max_detour, p_max_wait: f.max_wait == null ? S_().d_wait : f.max_wait, p_accepts: f.accepts || S_().d_accepts, p_cost_per_km: 0.2, p_minutes: 720, p_max_pickups: Math.min(4, S_().d_seats), p_max_total_detour: Math.min(4, S_().d_seats) > 1 ? Math.max(S_().d_total_detour, f.max_detour == null ? S_().d_detour : f.max_detour) : null }), 'You are live for 30 minutes');
      if (ok) { viewD = null; mapSig = {}; }
    });
    on('rn-go', async () => {
      const p = $('rn-p').value, d = $('rn-d').value; if (p === d) { formMsg('rn-msg', 'Pick two different places'); return; }
      const ok = await run(sb.rpc('go_live_request', { p_pickup: p, p_dropoff: d, p_pays: $('rn-pay').value }), 'Drivers can see you for 20 minutes');
      if (ok) { viewR = null; mapSig = {}; }
    });
    each('[data-stoplive]', (b) => { const isTrip = b.dataset.stoplive === 'trip', row = isTrip ? myLiveTrip : myLiveReq; if (row) run(sb.from(isTrip ? 'trips' : 'ride_requests').update({ active: false }).eq('id', row.id), 'Stopped'); });
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
