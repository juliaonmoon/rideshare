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
  const clk = (m) => { const t = Math.round(m), h = Math.floor(t / 60) % 24, mm = t % 60; return ((h % 12) || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm'); };
  // Default date for a form: the saved date, but never in the past, and if today's time has already passed (or is under 30 minutes away) use tomorrow.
  const defaultDate = (saved, minutes) => { let d = !saved || saved < todayStr() ? todayStr() : saved; if (d === todayStr() && RSD.check(d, minutes)) d = RSD.addDays(todayStr(), 1); return d; };
  const maxDate = () => RSD.addDays(todayStr(), RSD.MAX_AHEAD_DAYS);
  const dayChips = (id, sel) => `<div class="days" id="${id}">${RSD.DAY_NAMES.map((n, i) => `<button type="button" data-day="${i + 1}" class="${(sel || []).includes(i + 1) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const readDays = (id) => [...document.querySelectorAll('#' + id + ' button.on')].map((b) => +b.dataset.day);
  // 'Sun Nov 15', and for today / tomorrow the date too: 'Tomorrow (Sun, Nov 15)'
  const dateLong = (d) => { const l = RSD.label(d), full = RSD.parse(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); return /^(Today|Tomorrow)$/.test(l) ? l + ' (' + full + ')' : l; };
  const untilTxt = (u) => (u ? ' until ' + RSD.label(u) : '');
  const firstDay = (date, days, every, nth) => (days && days.length ? (RSD.nthDate(date, days, every, nth, 1) || date) : date);   // a repeating trip starts on its first repeat day
  const whenText = (date, mins, days, until, every, nth) => RSD.label(firstDay(date, days, every, nth)) + ' at ' + clk(mins) + (days && days.length ? ' &middot; repeats ' + RSD.repeatLabel(days, every, nth) + untilTxt(until) : ' &middot; one time');
  const mapAttrs = (lat, lng) => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? 'href="geo:' + lat + ',' + lng + '?q=' + lat + ',' + lng + '"' : 'href="https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng + '" target="_blank" rel="noopener"');
  // "2 days 6 h", "1 h 20 min", "35 min" instead of "3275 min"
  const fmtLeft = (m) => { m = Math.max(0, Math.round(m)); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60; if (d) return d + (d > 1 ? ' days' : ' day') + (h ? ' ' + h + ' h' : ''); return h ? h + ' h' + (mi ? ' ' + mi + ' min' : '') : mi + ' min'; };
  // a clock time with its day when it is not today: "8:41 am" or "Tomorrow 8:41 am"
  const leaveWhen = (ms) => { const iso = new Date(ms).toISOString(), day = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }); return (day === todayStr() ? '' : RSD.label(day) + ' ') + clk(vanMin(iso)); };
  // a trip with a time window has no fixed leave time until the first rider is accepted
  const isFlexFree = (t) => !!t && t.flex_to != null && !t.live && !t.flex_locked;
  const tripWhen = (t) => isFlexFree(t) ? (t.repeat_days && t.repeat_days.length ? 'Starts ' + RSD.label(firstDay(t.trip_date, t.repeat_days, t.repeat_every, t.repeat_nth)) + ' &middot; repeats ' + RSD.repeatLabel(t.repeat_days, t.repeat_every, t.repeat_nth) + untilTxt(t.repeat_until) + ' &middot; any time between ' + clk(t.flex_from) + ' and ' + clk(t.flex_to) + ' &middot; your first rider each day sets the time' : RSD.label(t.trip_date) + ' any time between ' + clk(t.flex_from) + ' and ' + clk(t.flex_to) + ' &middot; flexible, one time')
    : whenText(t.trip_date, t.depart_min, t.repeat_days, t.repeat_until, t.repeat_every, t.repeat_nth) + (t.flex_to != null && !t.live ? ' &middot; set by your first rider' : '');
  // when a flexible driver would have to leave to reach this rider on time (null: the window does not fit)
  const flexDepart = (t, dr, me, date) => {
    const n = new Date(), lo = Math.max(t.flex_from, date === todayStr() ? n.getHours() * 60 + n.getMinutes() + 2 : 0);
    const off = RS.minutes(dr.origin, me.pickup, lo, dr.dow), dep = Math.max(lo, Math.ceil(me.readyFrom - off));
    return dep > t.flex_to || dep + off > me.readyTo ? null : dep;
  };
  // the time options on the trip forms: leave at / arrive by, and the "any time between" range
  const whenBox = (p, dateHtml, timeStr, on, from, to, mode, locked) => {
    if (locked) return '<div class="row"><div><label>Date</label>' + dateHtml + '</div><div><label id="' + p + '-t-lbl">Leave at</label><input type="time" id="' + p + '-t" value="' + timeStr + '"></div></div>';
    const cur = on ? 'range' : mode === 'arrive' ? 'arrive' : 'leave';
    const seg = [['leave', 'Leave'], ['arrive', 'Arrive'], ['range', 'Flexible']].map(([v, l]) => '<button type="button" data-seg="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + l + '</button>').join('');
    return '<label>Time</label><div class="days" id="' + p + '-seg">' + seg + '</div>'
      + '<select id="' + p + '-mode" style="display:none" aria-hidden="true"><option value="leave"' + (cur === 'arrive' ? '' : ' selected') + '>leave</option><option value="arrive"' + (cur === 'arrive' ? ' selected' : '') + '>arrive</option></select>'
      + '<input type="checkbox" id="' + p + '-flex"' + (on ? ' checked' : '') + ' style="display:none" aria-hidden="true">'
      + '<div class="row"><div><label>Date</label>' + dateHtml + '</div><div><label id="' + p + '-t-lbl">' + (on ? 'From' : cur === 'arrive' ? 'Arrive by' : 'Leave at') + '</label><input type="time" id="' + p + '-t" value="' + timeStr + '"></div></div>'
      + '<div id="' + p + '-flexbox" style="' + (on ? '' : 'display:none') + '"><label id="' + p + '-t2-lbl">To</label><input type="time" id="' + p + '-t2" value="' + hmIn(to != null ? to : Math.min(1439, (from || 450) + 360)) + '"><p class="mut hint" data-once="flex-window" style="margin:4px 0 0">Riders say when they are ready. The first rider you accept sets your leave time for that day. After that the day is fixed.</p></div>';
  };
  // the point of a place field: the address chosen, else the neighbourhood
  const placePt = (id, area) => (PL[id] && !PL[id].isArea && PL[id].lat != null ? { lat: PL[id].lat, lng: PL[id].lng } : LOC[area]);
  // Read the time fields into the trip row. "Arrive by" works out when to leave: arrival minus the drive minus the extra minutes allowed for pickups.
  const timesRead = (p, row, idO, idD) => {
    const box = $(p + '-flex'), flex = !!(box && box.checked), arrive = ($(p + '-mode') || {}).value === 'arrive';
    const a = placePt(idO, row.origin), b = placePt(idD, row.dest), dow = dowOf(row.trip_date);
    const allow = row.max_total_detour != null ? Math.max(row.max_total_detour, row.max_detour) : row.max_detour;
    const toLeave = (arr) => { const first = a && b ? RS.minutes(a, b, arr, dow) : 0, drive = a && b ? RS.minutes(a, b, Math.max(0, arr - first), dow) : 0; return { dep: Math.floor(arr - drive - allow), drive }; };
    const how = (arr, r) => 'Arrive by ' + clk(arr) + ': leave by ' + clk(r.dep) + ' (about ' + fmtMin(r.drive) + ' driving + ' + allow + ' min allowed for pickups).';
    if (flex) {
      const to = hm($(p + '-t2').value || '13:30'); let latest = to, note = '';
      if (arrive) { const r = toLeave(to); latest = r.dep; note = how(to, r); }
      if (latest <= row.depart_min) return { err: arrive ? 'To arrive by then you would have to leave before your earliest time. Pick a later arrival time or an earlier start.' : 'The latest time must be after the earliest time' };
      row.flex_from = row.depart_min; row.flex_to = latest; row.flex_locked = false;
      return { err: '', note };
    }
    if (arrive) { const arr = row.depart_min, r = toLeave(arr); if (r.dep < 0) return { err: 'That arrival time is too early for the drive' }; row.depart_min = r.dep; return { err: '', note: how(arr, r) }; }
    return { err: '', note: '' };
  };

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
        await loadAll(); openTodayTrip();
        setTimeout(() => { const p = $('plan-wrap') || $('ld-top'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 700); return;
      }
      if (ev && ev.url && ev.url.indexOf('ca.rideshare.app://cancel-offer') === 0) {   // the Cancel my offer button on a leave-by reminder
        await loadAll(); const lt = myLiveTrip; const dv = $('rs-driving'); if (dv) dv.click();
        if (!lt) { toast('Your offer is already off'); return; }
        if (window.confirm('Cancel your offer?\n\nAnyone you accepted gets all their points back.')) {
          const r = await cancelTrip(lt.id);
          if (r && r.error) toast('Could not cancel: ' + r.error.message); else { try { if (driveSession && !shouldShare()) stopShare(true); } catch (e) { /* ignore */ } toast('Your offer is cancelled'); }
          await loadAll();
        }
        return;
      }
      if (ev && ev.url && ev.url.indexOf('ca.rideshare.app://start-trip') === 0) { await loadAll(); openTodayTrip(); setTimeout(() => { if (window.__startNav) window.__startNav(); }, 1100); return; }   // "I'm leaving" on a leave-by reminder
      if (ev && ev.url && ev.url.indexOf('ca.rideshare.app://update-route') === 0) { await loadAll(); openTodayTrip(); setTimeout(() => { if (window.__startNav) window.__startNav(true); }, 1100); return; }
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
  let user = null, me = { name: '', points: 0 }, myTrip = null, myTrips = [], selTripId = null, myReq = null, ledger = [], matches = [];
  let otherTrips = [], otherReqs = [], extraTrips = [], extraReqs = [], names = {}, timer = null, busy = false, formSig = '', mapSig = {};
  let autoAlerts = false;   // started the alert helper for a live trip that was already on when the app opened
  let tripsView = (() => { try { return localStorage.getItem('rs_trips_view') === 'rider' ? 'rider' : 'driver'; } catch (e) { return 'driver'; } })();   // Trips tab: 'driver' (my trip, my riders) or 'rider' (my ride requests, my rides)
  let rideMode = (() => { try { return localStorage.getItem('rs_ride_mode') === 'later' ? 'later' : 'now'; } catch (e) { return 'now'; } })();   // rider card: 'now' or 'later' (Schedule)
  let tripMode = (() => { try { return localStorage.getItem('rs_trip_mode') === 'later' ? 'later' : 'now'; } catch (e) { return 'now'; } })();       // the one trip card: 'now' (offer a ride now) or 'later' (pick a day and time)
  const LV = {};              // what is typed in the 'later' fields, kept across refreshes
  let myBlocks = new Set();   // people I chose never to be matched with (migration 029)
  let MSOK = null, msgs = [], myRatings = {}, scores = {}, adminReports = [];   // migration 024 (messages, ratings, admin reports)
  let PCOK = null, cards = {};   // migration 021 (photo and car details shown to a matched driver or rider, Report a problem) is in place
  const DEV = (() => { try { return localStorage.getItem('rs_dev') === '1'; } catch (e) { return false; } })();   // developer tools (route simulator, test cards) only when switched on
  const store = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
  const loadTf = () => { try { const o = JSON.parse(store('rs_trips_filter', '{}')); return { when: ['upcoming', 'past', 'all'].includes(o.when) ? o.when : 'upcoming', role: ['all', 'drive', 'ride'].includes(o.role) ? o.role : 'all', st: new Set(Array.isArray(o.st) ? o.st : []), view: o.view === 'date' ? 'date' : 'trip', trip: null }; } catch (e) { return { when: 'upcoming', role: 'all', st: new Set(), view: 'trip', trip: null }; } };
  const saveTf = () => keep('rs_trips_filter', JSON.stringify({ when: tf.when, role: tf.role, st: [...tf.st], view: tf.view }));
  let offerOpen = false, tripsPane = store('rs_trips_pane', 'list') === 'cal' ? 'cal' : 'list';   // the Trips tab opens on the List with its filters, and remembers the last choice
  let tf = loadTf();   // Trips > List filters: when (upcoming / past / all), what (driving / riding), and status chips   // Home: the Offer a ride now form is open; Trips tab: 'cal' or 'list'
  const foldClosed = new Set();   // groups that are open by default and were closed by the person
  const foldOpen = new Set();   // which collapsed lists the person opened (kept across screen refreshes)
  document.addEventListener('toggle', (e) => { const t = e.target; if (t && t.dataset && t.dataset.fold) { if (t.dataset.foldopen) { if (t.open) foldClosed.delete(t.dataset.fold); else foldClosed.add(t.dataset.fold); } else if (t.open) foldOpen.add(t.dataset.fold); else foldOpen.delete(t.dataset.fold); } }, true);
  // Long explanations are not shown all the time: a small (i) opens them, and a few guide the person once, the first time they see them.
  const tipsSeen = () => { try { return JSON.parse(localStorage.getItem('rs_tips_seen') || '[]'); } catch (e) { return []; } };
  const AUTO_TIPS = false;   // one-time guide pop-ups are switched off for now; the (i) buttons still open the text
  let tipOpen = false;
  function showTip(html, key) {
    if (tipOpen || !html) return; tipOpen = true;
    const o = document.createElement('div'); o.id = 'rs-tip'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:24px';
    o.innerHTML = '<div style="background:var(--card);color:var(--ink);border-radius:14px;padding:18px;max-width:420px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.3)"><div style="font-size:16px;line-height:1.5">' + html + '</div><div style="margin-top:14px;text-align:right"><button type="button" class="btn" id="rs-tip-ok">Got it</button></div></div>';
    const close = () => { o.remove(); tipOpen = false; if (key) { try { const a = tipsSeen(); if (!a.includes(key)) { a.push(key); localStorage.setItem('rs_tips_seen', JSON.stringify(a)); } } catch (e) { /* storage blocked */ } } };
    o.addEventListener('click', (e) => { if (e.target === o || e.target.id === 'rs-tip-ok') close(); });
    document.body.appendChild(o);
  }
  function tipify() {
    document.querySelectorAll('p.hint').forEach((p) => {
      if (p.closest('#rs-tip')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tipbtn'; b.textContent = 'i'; b.setAttribute('aria-label', 'More information');
      b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--mut);background:var(--card);color:var(--mut);font:italic 700 14px Georgia,serif;padding:0;cursor:pointer;margin:4px 0';
      b.dataset.tipHtml = p.innerHTML; if (p.dataset.once) b.dataset.once = p.dataset.once;
      p.replaceWith(b);
    });
    if (AUTO_TIPS && !tipOpen) { const seen = tipsSeen(), nb = [...document.querySelectorAll('button.tipbtn[data-once]')].find((x) => !seen.includes(x.dataset.once) && x.offsetParent !== null); if (nb) showTip(nb.dataset.tipHtml, nb.dataset.once); }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button.tipbtn'); if (b) showTip(b.dataset.tipHtml, b.dataset.once); });
  const fold = (id, summary, html) => '<details data-fold="' + id + '"' + (foldOpen.has(id) ? ' open' : '') + '><summary class="mut" style="cursor:pointer;padding:4px 0">' + summary + '</summary>' + html + '</details>';
  let prevMode = 'cal'; const prevMonthBy = {};   // the days preview on the trip forms: calendar or list
  // Home is ONE screen: a feed of what is next. Details live on their own page: 'trip' (one day of a trip I drive), 'ride' (my ride), 'post' (post or edit a trip), 'now' (offer a ride now), 'ask' (ask for a ride).
  let homeView = 'feed', detailTripId = null, detailFrom = 'home';
  const newUI = () => document.documentElement.getAttribute('data-ui') === 'b';
  const hv = () => (newUI() ? homeView : 'classic');   // the old layout keeps working as it did
  const showsDrive = (...vs) => hv() === 'classic' || vs.includes(hv());
  const syncCur = () => { const sel = detailTripId && [myLiveTrip, ...myTrips].find((x) => x && x.id === detailTripId); curTrip = (hv() === 'trip' && sel) ? sel : (myLiveTrip || myTrip); };
  // A phone alert opened the app for a trip today: show that trip's page (its plan and stops), so the navigation starts from the right route.
  function openTodayTrip() { const tt = myLiveTrip || myTrips.find((t) => tripOn(t, todayStr())) || myTrip; if (!tt) return; detailTripId = tt.id; if (!tt.live) { selTripId = tt.id; myTrip = tt; } viewD = todayStr(); detailFrom = 'home'; goHome('trip'); }
  function goHome(v) { homeView = v; formSig = ''; mapSig = {}; syncCur(); if (window.rsGo) window.rsGo('home'); render(); }
  function leaveDetails() { const back = detailFrom; homeView = 'feed'; detailTripId = null; editing.trip = false; editing.newTrip = false; editing.dayOnly = null; editing.req = false; pending = null; offerOpen = false; formSig = ''; mapSig = {}; syncCur(); if (window.rsGo) window.rsGo(back === 'trips' ? 'trips' : 'home'); render(); }
  window.rsHomeTab = () => (homeView === 'feed' ? (window.rsRole && window.rsRole() === 'riding' ? 't-rider' : 't-driver') : (homeView === 'ride' || homeView === 'ask') ? 't-rider' : 't-driver');
  window.rsHomeDetail = () => homeView !== 'feed';   // a trip page, not the Home screen: the Driving | Riding switch is hidden
  window.rsHome = { toFeed: () => { homeView = 'feed'; detailTripId = null; editing.trip = false; editing.newTrip = false; editing.dayOnly = null; editing.req = false; pending = null; offerOpen = false; formSig = ''; mapSig = {}; syncCur(); render(); } };
  // when what a page was showing is gone (saved, cancelled, finished), go back to the feed
  function autoBack() {
    if (!newUI() || homeView === 'feed') return;
    const was = homeView;
    if (homeView === 'post' && !editing.trip && !(pending && pending.kind === 'trip')) homeView = 'feed';
    else if (homeView === 'now' && (myLiveTrip || !offerOpen)) homeView = 'feed';
    else if (homeView === 'ask' && (myLiveReq || (myReq && !editing.req && !(pending && pending.kind === 'req')))) homeView = 'feed';
    else if (homeView === 'trip' && !curTrip) homeView = 'feed';
    else if (homeView === 'ride' && !curReq && !matches.some((x) => user && x.rider_id === user.id && (x.status === 'accepted' || x.status === 'requested'))) homeView = 'feed';
    if (was !== homeView) { detailTripId = null; formSig = ''; mapSig = {}; syncCur(); if (window.rsView && window.rsView() === 'home' && window.rsGo) window.rsGo('home'); }
  }
  let CDOK = null;   // migration 054 (change one date) is in place
  let notices = [], NTOK = null;   // unread notices (a confirmed ride was cancelled); NTOK: migration 053 is in place
  let freshBusy = false;   // Start fresh is running
  let myChildren = [];   // the days of my repeating trips (with a window) that became their own trip once the first rider was accepted
  let RPOK = null, skipMap = {};   // RPOK: migration 048 (every N weeks, monthly, skip a day) is in place
  let UNOK = null;   // migration 047 (repeat until) is in place
  const REP_LABELS = { none: 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday (Mon to Fri)', weekly: 'Every week, on days I choose', biweekly: 'Every 2 weeks, on days I choose', monthly: 'Every month, on a set weekday (e.g. the last Thursday)' };
  const repeatKind = (x) => (!x.repeat_days || !x.repeat_days.length ? 'none' : x.repeat_nth ? 'monthly' : (x.repeat_every || 1) === 2 ? 'biweekly' : x.repeat_days.length === 7 ? 'daily' : (x.repeat_days.length === 5 && [1, 2, 3, 4, 5].every((d) => x.repeat_days.includes(d))) ? 'weekdays' : 'weekly');
  // Repeat + Ends, in the style of a calendar app. p = 'lt' (trip) or 'lr' (request)
  function repeatBox(p, x) {
    const L = (id, d) => (p === 'ln' && LV[id] != null ? LV[id] : d);   // the Home form keeps its choices across refreshes
    const kind = L(p + '-rep', repeatKind(x)), kinds = ['none', 'daily', 'weekdays', 'weekly'].concat(RPOK ? ['biweekly', 'monthly'] : []);
    const nth = +L(p + '-nth', x.repeat_nth || 1), dow = +L(p + '-dow', (x.repeat_days && x.repeat_days[0]) || 1), endKind = L(p + '-end', 'date');   // a repeating trip must end: on a date (3 months out until changed) or after a number of times
    return `<label>Repeat</label><select id="${p}-rep">${kinds.map((k) => '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + REP_LABELS[k] + '</option>').join('')}</select>
      <div id="${p}-rep-days"><label>On these days</label>${dayChips(p + '-days', x.repeat_days)}</div>
      <div id="${p}-rep-month"><label>Which day of the month</label><div class="row"><select id="${p}-nth">${['First', 'Second', 'Third', 'Fourth', 'Last'].map((n, i) => '<option value="' + (i + 1) + '"' + (i + 1 === nth ? ' selected' : '') + '>' + n + '</option>').join('')}</select><select id="${p}-dow">${RSD.FULL_DAYS.map((n, i) => '<option value="' + (i + 1) + '"' + (i + 1 === dow ? ' selected' : '') + '>' + n + '</option>').join('')}</select></div></div>
      ${UNOK ? `<div id="${p}-rep-end"><label>Ends</label><select id="${p}-end"><option value="date"${endKind !== 'count' ? ' selected' : ''}>On a date</option><option value="count"${endKind === 'count' ? ' selected' : ''}>After a number of times</option></select>
        <input type="date" id="${p}-until" min="${todayStr()}" max="${RSD.addDays(todayStr(), 183)}" value="${L(p + '-until', x.repeat_until || RSD.addDays(todayStr(), 90))}"><input type="number" id="${p}-count" min="1" max="26" value="${L(p + '-count', 10)}" aria-label="Number of times"></div>` : ''}
      <div id="${p}-rep-prev" style="margin-top:8px">${fold(p + '-prev', '<span id="' + p + '-prevsum">Preview the days</span>', '<div id="' + p + '-prevbody"></div>')}</div>`;
  }
  function miniCal(ym, hits) {
    const pad2 = (n) => String(n).padStart(2, '0'), [cy, cm] = ym.split('-').map(Number), dim = new Date(cy, cm, 0).getDate(), lead = (new Date(cy, cm - 1, 1).getDay() + 6) % 7;
    let cells = ''; for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let dd = 1; dd <= dim; dd++) { const ds = cy + '-' + pad2(cm) + '-' + pad2(dd), on = hits.has(ds); cells += '<span style="font-size:12px;line-height:28px;border-radius:7px;' + (on ? 'background:var(--acc);color:#fff;font-weight:600' : 'color:var(--mut)') + '">' + dd + '</span>'; }
    return '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">' + RSD.DAY_NAMES.map((n) => '<span class="mut" style="font-size:10px">' + n + '</span>').join('') + cells + '</div>';
  }
  function updatePreview(p) {
    const box = $(p + '-prevbody'), sum = $(p + '-prevsum'); if (!box) return;
    const start = ($(p + '-date') || {}).value, rp = repeatRead(p, start);
    if (!start || rp.err || !rp.days.length) { box.innerHTML = '<p class="mut">' + esc(rp.err || 'Pick a date and how it repeats to see the days.') + '</p>'; if (sum) sum.textContent = 'Preview the days'; return; }
    const horizon = rp.until || RSD.addDays(start, 180), hits = new Set(), list = [];
    for (let i = 0; i <= 366; i++) { const d = RSD.addDays(start, i); if (d > horizon) break; if (RSD.occursOn(start, rp.days, d, rp.until, rp.every, rp.nth)) { hits.add(d); list.push(d); } }
    if (sum) sum.textContent = 'Preview: ' + list.length + (list.length === 1 ? ' day' : ' days') + (rp.until ? ' until ' + RSD.label(rp.until) : ' in the next 6 months');
    const ym = prevMonthBy[p] || start.slice(0, 7), [cy, cm] = ym.split('-').map(Number), mname = new Date(cy, cm - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const seg = (m, l) => '<button type="button" class="btn' + (prevMode === m ? '' : ' ghost') + '" data-pmode="' + m + '" style="padding:4px 12px;min-height:0">' + l + '</button>';
    const body = prevMode === 'cal'
      ? '<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0"><button type="button" class="btn ghost" data-pmove="-1" aria-label="Previous month" style="padding:2px 12px;min-height:0">&lsaquo;</button><b>' + esc(mname) + '</b><button type="button" class="btn ghost" data-pmove="1" aria-label="Next month" style="padding:2px 12px;min-height:0">&rsaquo;</button></div>' + miniCal(ym, hits)
      : '<div style="max-height:200px;overflow:auto">' + list.slice(0, 100).map((d) => '<div style="padding:3px 0;border-top:1px solid var(--line)">' + esc(RSD.label(d)) + '</div>').join('') + (list.length > 100 ? '<div class="mut">and more&hellip;</div>' : '') + '</div>';
    box.innerHTML = '<div style="display:flex;gap:6px;margin:6px 0">' + seg('cal', 'Calendar') + seg('list', 'List') + '</div>' + body;
    box.querySelectorAll('[data-pmode]').forEach((b) => (b.onclick = () => { prevMode = b.dataset.pmode; updatePreview(p); }));
    box.querySelectorAll('[data-pmove]').forEach((b) => (b.onclick = () => { const nd = new Date(cy, cm - 1 + (+b.dataset.pmove), 1); prevMonthBy[p] = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0'); updatePreview(p); }));
  }
  function repUi(p) {
    const k = $(p + '-rep') && $(p + '-rep').value, show = (id, on) => { const e = $(id); if (e) e.style.display = on ? '' : 'none'; };
    show(p + '-rep-days', k === 'weekly' || k === 'biweekly'); show(p + '-rep-month', k === 'monthly'); show(p + '-rep-end', k !== 'none'); show(p + '-rep-prev', k !== 'none');
    const ek = $(p + '-end') && $(p + '-end').value; show(p + '-until', ek === 'date'); show(p + '-count', ek === 'count');
  }
  function repeatRead(p, start) {
    const k = $(p + '-rep') ? $(p + '-rep').value : 'none';
    let days = [], every = 1, nth = null;
    if (k === 'daily') days = [1, 2, 3, 4, 5, 6, 7]; else if (k === 'weekdays') days = [1, 2, 3, 4, 5];
    else if (k === 'weekly' || k === 'biweekly') { days = readDays(p + '-days'); if (!days.length) return { err: 'Pick the days of the week to repeat on' }; if (k === 'biweekly') every = 2; }
    else if (k === 'monthly') { nth = +$(p + '-nth').value; days = [+$(p + '-dow').value]; }
    let until = null;
    if (days.length && UNOK && $(p + '-end')) {
      const ek = $(p + '-end').value;
      if (ek === 'date') { until = $(p + '-until').value; if (!until) return { err: 'Pick the last day of the repeat' }; if (start && until < start) return { err: 'The last day cannot be before the first day' }; }
      else if (ek === 'count') { const n = Math.max(1, Math.min(26, +$(p + '-count').value || 0)); until = RSD.nthDate(start, days, every, nth, n); if (!until) return { err: 'That many repeats do not fit in the next 3 years' }; }
    }
    if (until && until > RSD.addDays(todayStr(), 183)) return { err: 'A repeat can run for at most 6 months. Pick an earlier last day or fewer times.' };
    return { days, every, nth, until, extra: Object.assign(RPOK ? { repeat_every: every, repeat_nth: nth } : {}, UNOK ? { repeat_until: until } : {}) };
  }
  let AAOK = null, SYOK = null, lastSync = 0, calMonth = null, calDay = null, offSet = new Set();   // AAOK/SYOK: migration 046 is in place; offSet: regular bookings that were ended
  let DKOK = null;   // migration 020 (detour limits in km, detour saved with each request) is in place
  let bubbleHidden = false;
  let pastTrips = [];   // my trips that are finished or cancelled
  let exactBy = {};   // match id -> exact pickup / drop-off, for rides I am driving (the server only gives it to the driver of a booked ride)
  let leaveInfo = {}; // seat request id -> when the driver must leave to reach that rider (Offer a ride now only)
  let fitServer = {}; // seat request id -> true or false from the database: is it inside my detour limits
  let apOn = null;   // test autopilot state last sent to the Android helper
  function syncAutopilot() {
    const n = nativeLoc && nativeLoc(); if (!n || !n.setAutopilot) return;
    const want = !!(isTest && testMode); if (want === apOn) return; apOn = want;
    try { n.setAutopilot({ on: want }); } catch (e) { /* older app build */ }
  }
  let overlayOn = null;   // Android app only: may the floating RideShare button be shown over Google Maps?
  let dndOn = null;   // Android app only: can seat-request alerts break through Do Not Disturb?
  async function refreshDnd() {
    const n = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.RideShareLocation;
    if (!n) return;
    let v = false; try { v = !!(await n.dndStatus()).bypass; } catch (e) { /* older app build */ }
    let o = false, hid = false; try { const os = await n.overlayStatus(); o = !!os.allowed; hid = !!os.hidden; } catch (e) { /* older app build */ }
    if (v !== dndOn || o !== overlayOn || hid !== bubbleHidden) { dndOn = v; overlayOn = o; bubbleHidden = hid; formSig = ''; if (typeof render === 'function' && user) render(); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDnd(); });
  const editing = { trip: false, req: false, newTrip: false, dayOnly: null };   // dayOnly: {id, d} = changing ONE date of a repeating trip   // newTrip: the form is posting an additional trip, not editing the one shown   // the full form stays hidden behind the summary card until Edit is tapped
  let pending = null, viewD = null, viewR = null, askCancel = null, rel = {}, mySet = null, styles = {}, isTest = false, testMode = false, drives = [];
  // Personal settings: defaults for new trips and requests (every trip can still be changed before posting).
  const SD = { d_detour_km: null, d_total_detour_km: null, d_detour: 10, d_total_detour: 15, d_wait: 0, d_accepts: 'either', d_seats: 1, d_auto_accept: false, d_chat: 'some', d_pets: true, r_pays: 'points', r_chat: 'some', r_pets: false };
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
  // photo (or the first letter of the name) and car, shown for the person I am matched with
  const avatar = (id, px) => { const c = cards[id], z = px || 44, base = 'width:' + z + 'px;height:' + z + 'px;border-radius:50%;flex:none;'; return c && c.photo ? '<img src="' + esc(c.photo) + '" alt="" referrerpolicy="no-referrer" style="' + base + 'object-fit:cover;background:var(--line)">' : '<span style="' + base + 'display:inline-flex;align-items:center;justify-content:center;background:var(--line);color:var(--acc);font-weight:700">' + esc((names[id] || '?').trim().charAt(0).toUpperCase()) + '</span>'; };
  const carLine = (id) => { const c = cards[id]; if (!c) return ''; const bits = [[c.car_color, c.car_make].filter(Boolean).join(' '), c.car_plate].filter(Boolean); return bits.length ? esc(bits.join(' \u00b7 ')) : ''; };
  const whoCard = (id, role) => '<div style="display:flex;gap:10px;align-items:center">' + avatar(id) + '<div><b>' + nm(id) + '</b>' + badge(id, role) + scoreTag(id) + (carLine(id) ? '<div class="mut">' + carLine(id) + '</div>' : '') + '</div></div>';
  const withExact = (m, q) => { const e = m && q && exactBy[m.id]; if (!e) return q; return Object.assign({}, q, e.pickup_lat != null ? { pickup_label: e.pickup_label, pickup_lat: e.pickup_lat, pickup_lng: e.pickup_lng } : {}, e.dropoff_lat != null ? { dropoff_label: e.dropoff_label, dropoff_lat: e.dropoff_lat, dropoff_lng: e.dropoff_lng } : {}); };
  const withMeet = (m, q) => { q = withExact(m, q); return m && q && m.meet_lat != null ? Object.assign({}, q, { pickup_lat: m.meet_lat, pickup_lng: m.meet_lng }) : q; };   // exact place first, then a meeting spot the two agreed on
  const meetLine = (m) => (m && (m.meet_note || m.meet_lat != null) ? '<div class="mut" style="margin-top:4px">Meeting spot' + (m.meet_note ? ': ' + esc(m.meet_note) : ' set') + (m.meet_lat != null ? ' &middot; <a ' + mapAttrs(m.meet_lat, m.meet_lng) + '>see it on the map</a>' : '') + '</div>' : '');
  const meetButton = (m) => (m && 'meet_lat' in m && m.status === 'accepted' && !m.picked_up_at ? '<button class="btn ghost" data-meet="' + m.id + '">' + (m.meet_lat != null || m.meet_note ? 'Change meeting spot' : 'Set meeting spot') + '</button>' : '');
  function meetDialog(matchId) {
    const x = matches.find((m) => m.id === matchId); if (!x) return;
    const q = [...otherReqs, ...extraReqs, ...(myReq ? [myReq] : [])].find((r) => r.id === x.request_id);
    const exactStart = x.meet_lat != null ? { lat: +x.meet_lat, lng: +x.meet_lng } : (q && q.pickup_lat != null ? { lat: +q.pickup_lat, lng: +q.pickup_lng } : null);
    const start = exactStart || (q && pt(q, 'pickup')) || { lat: 49.2827, lng: -123.1207 };
    let spot = exactStart;   // saved with the note; if the address was only a neighbourhood, the rider has to tap the map once
    const old = document.getElementById('mt-ov'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'mt-ov'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;overflow:auto';
    const hasMap = !!(window.google && google.maps);
    ov.innerHTML = '<div style="background:var(--card);color:var(--ink);border-radius:14px;padding:16px;max-width:460px;width:100%"><h2 style="margin:0 0 6px">Where should your driver meet you?</h2>'
      + (hasMap ? '<p class="mut" style="margin:0 0 8px">Move the pin, or tap the map, to the exact spot.</p><div id="mt-map" style="height:260px;border-radius:10px;background:var(--line)"></div>' : '<p class="mut hint">The map is not available right now. Use your current location, and add a note.</p>')
      + '<div style="margin:8px 0"><button class="btn ghost" id="mt-here">Use my current location</button></div>'
      + '<label>Note for the driver (optional)</label><textarea id="mt-note" rows="2" maxlength="200" placeholder="For example: outside the Tim Hortons, by the bus stop" style="' + INPUT + '">' + esc(x.meet_note || '') + '</textarea>'
      + '<p class="warn" id="mt-msg" role="alert"></p><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="mt-save">Save</button>' + (x.meet_lat != null || x.meet_note ? '<button class="btn ghost" id="mt-clear">Remove</button>' : '') + '<button class="btn ghost" id="mt-cancel">Cancel</button></div></div>';
    document.body.appendChild(ov);
    let marker = null, map = null;
    const place = (p) => { spot = p; if (marker) marker.setPosition(p); };
    if (hasMap) {
      try {
        map = new google.maps.Map(document.getElementById('mt-map'), { center: start, zoom: 17, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'greedy' });
        marker = new google.maps.Marker({ position: start, map, draggable: true, title: 'Meeting spot' });
        marker.addListener('dragend', (e) => { spot = { lat: e.latLng.lat(), lng: e.latLng.lng() }; });
        map.addListener('click', (e) => place({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      } catch (e) { map = null; }
    }
    document.getElementById('mt-here').onclick = () => {
      if (!navigator.geolocation) { document.getElementById('mt-msg').textContent = 'This device cannot share its location'; return; }
      navigator.geolocation.getCurrentPosition((p) => { const c = { lat: p.coords.latitude, lng: p.coords.longitude }; place(c); if (map) map.setCenter(c); }, () => { document.getElementById('mt-msg').textContent = 'Could not get your location'; }, { enableHighAccuracy: true, timeout: 15000 });
    };
    const send = async (lat, lng, note, msg) => {
      const e = (await sb.rpc('set_meet_spot', { p_match: matchId, p_lat: lat, p_lng: lng, p_note: note })).error;
      if (e) { document.getElementById('mt-msg').textContent = e.message; return; }
      Object.assign(x, { meet_lat: lat, meet_lng: lng, meet_note: note || null }); ov.remove(); toast(msg); formSig = ''; render(); loadAll();
    };
    document.getElementById('mt-cancel').onclick = () => ov.remove();
    document.getElementById('mt-save').onclick = () => {
      if (!spot) { document.getElementById('mt-msg').textContent = 'Tap the map or use your current location to set the exact spot.'; return; }
      send(spot.lat, spot.lng, document.getElementById('mt-note').value.trim(), 'Meeting spot saved. Your driver will see it.');
    };
    const clr = document.getElementById('mt-clear'); if (clr) clr.onclick = () => send(null, null, '', 'Meeting spot removed');
  }
  // alerts for a rider (seat confirmed, driver on the way, driver arrived) come from the same phone helper the drivers use
  let riderAlertsAt = 0;
  async function riderAlertsCheck() {
    const nat = nativeLoc(); if (!nat || !user || driveSession) return;
    const t0 = todayStr();
    if (!(matches.some((x) => x.rider_id === user.id && (x.status === 'accepted' || x.status === 'requested') && x.ride_date >= t0) || myLiveReq || myReq)) return;
    if (Date.now() - riderAlertsAt < 60000) return; riderAlertsAt = Date.now();
    try {
      const st = await nat.status(); if (st && st.running) return;
      const r = await sb.rpc('start_tracking'); if (r.error || !r.data) return;
      const res = await nat.start({ url: CFG.supabaseUrl, key: CFG.supabaseKey, token: r.data, riderOnly: true });
      if (res && res.notifications === false) toast('Phone alerts are off. Allow notifications for RideShare in your phone settings to hear when your driver is on the way.');
    } catch (e) { /* permission refused: no phone alerts */ }
  }
  const scoreTag = (id) => { const z = scores[id]; return z && z.n > 0 ? ' <span class="tag">' + Math.round(100 * z.up / z.n) + '% liked (' + z.n + ')</span>' : ''; };
  const unreadFor = (matchId) => msgs.filter((m) => m.match_id === matchId && m.recipient_id === (user && user.id) && !m.read_at).length;
  const msgButton = (m) => { if (!MSOK || !m) return ''; const n = unreadFor(m.id); return (m.status === 'accepted' || m.status === 'completed') ? '<button class="btn ghost" data-msg="' + m.id + '">Message' + (n ? ' (' + n + ' new)' : '') + '</button>' : ''; };
  const rateLine = (m, otherId) => !MSOK || !m || m.status !== 'completed' ? '' : (m.id in myRatings
    ? '<div class="mut" style="margin-top:4px">You rated ' + nm(otherId) + ': ' + (myRatings[m.id] ? 'good' : 'not good') + '</div>'
    : '<div style="margin-top:6px"><div class="mut">Rate ' + nm(otherId) + ':</div><div style="display:flex;gap:8px;margin-top:4px"><button class="btn ghost" style="flex:1" data-rate="' + m.id + '|1">Good</button><button class="btn ghost" style="flex:1" data-rate="' + m.id + '|0">Not good</button></div></div>');
  const noFn = (r) => !!(r && r.error && /could not find the function|PGRST202|schema cache/i.test((r.error.message || '') + ' ' + (r.error.code || '')));
  const cancelTrip = async (id) => { const r = await sb.rpc('cancel_trip', { p_trip: id }); return noFn(r) ? sb.from('trips').update({ active: false }).eq('id', id) : r; };
  const cancelRequest = async (id) => { const r = await sb.rpc('cancel_request', { p_request: id }); return noFn(r) ? sb.from('ride_requests').update({ active: false }).eq('id', id) : r; };
  // the planned road distance of a trip (an estimate from the map points); shown when the phone tracked clearly less than the trip
  const plannedKm = (t) => { const a = pt(t, 'origin'), b = pt(t, 'dest'); return a && b ? RS.roadKm(a, b) : null; };
  const kmLabel = (t, km) => { if (t.route_km) return ' &middot; ' + Number(t.route_km).toFixed(1) + ' km'; const p = plannedKm(t); if (km && (!p || km >= 0.7 * p)) return ' &middot; ' + km.toFixed(1) + ' km'; if (p) return ' &middot; about ' + Math.round(p) + ' km'; return km ? ' &middot; ' + km.toFixed(1) + ' km' : ''; };
  const reqOf = (m) => [...otherReqs, ...extraReqs, ...(myReq ? [myReq] : [])].find((r) => r.id === m.request_id);
  const payText = (x) => x.pay_with === 'points' ? x.points + ' pts' : 'cash' + (x.cash_cents ? ', about $' + (x.cash_cents / 100).toFixed(2) : ' gas-share');
  function detailDialog(title, html, reports) {
    const old = document.getElementById('dt-ov'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'dt-ov'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;overflow:auto';
    ov.innerHTML = '<div style="background:var(--card);color:var(--ink);border-radius:14px;padding:16px;max-width:480px;width:100%;max-height:92vh;overflow:auto"><h2 style="margin:0 0 8px">' + title + '</h2>' + html + '<div style="margin-top:12px"><button class="btn" id="dt-close">Close</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('dt-close').onclick = () => ov.remove();
    ov.querySelectorAll('[data-dtreport]').forEach((b) => { b.onclick = () => { const p = b.dataset.dtreport.split('|'); ov.remove(); reportDialog(p[0], p[1]); }; });
    return ov;
  }
  // the road distance Google Maps gives for the route that was driven, worked out by the server once and saved (migration 031)
  async function fetchRouteSummary(tripId) { try { const r = await sb.rpc('trip_route_summary', { p_trip: tripId }); return r.error ? null : r.data; } catch (e) { return null; } }
  function tripDetail(id) {
    const t = pastTrips.find((x) => x.id === id); if (!t) return;
    const all = matches.filter((x) => x.trip_id === id), done = all.filter((x) => x.status === 'completed'), other = all.filter((x) => x.status !== 'completed' && x.status !== 'requested');
    const ds = drives.filter((d) => d.trip_id === id), tracked = ds.reduce((a, d) => a + (+d.distance_km || 0), 0), planned = plannedKm(t);
    const mins = ds.reduce((a, d) => a + Math.max(0, (Date.parse(d.ended_at || d.last_at) - Date.parse(d.started_at)) / 60000), 0);
    const line = (a, b) => '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span class="mut">' + a + '</span><span style="text-align:right">' + b + '</span></div>';
    const kmText = (km, src) => Number(km).toFixed(1) + ' km' + (src === 'google' || src === 'google-saved' ? ' (Google Maps route)' : src === 'gps' ? ' (tracked by your phone)' : ' (map estimate)');
    const dist = '<div id="dt-km">' + (t.route_km ? line('Distance', kmText(t.route_km, t.route_source)) : line('Distance', 'working it out...')) + '</div>';
    const riders = done.length ? done.map((x) => { const q = reqOf(x); return '<div style="padding:8px 0;border-top:1px solid var(--line)">' + whoCard(x.rider_id, 'rider') + '<div class="mut" style="margin-top:4px">' + (q ? esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) + ' &middot; ' : '') + payText(x) + (+(x.route_km || x.ride_km) ? ' &middot; ' + (+(x.route_km || x.ride_km)).toFixed(1) + ' km together' : '') + '</div>' + (myRatings && x.id in myRatings ? '<div class="mut">You rated them: ' + (myRatings[x.id] ? 'good' : 'not good') + '</div>' : '') + (PCOK ? '<div style="margin-top:6px"><button class="btn ghost" data-dtreport="' + x.id + '|' + x.rider_id + '">Report a problem</button></div>' : '') + '</div>'; }).join('') : '<p class="mut">No riders on this trip.</p>';
    const earned = done.filter((x) => x.pay_with === 'points').reduce((a, x) => a + (+x.points || 0), 0);
    const ovT = detailDialog(esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')),
      line('When', esc(RSD.label(t.trip_date)) + ' at ' + clk(t.depart_min)) + line('Status', done.length ? 'completed' : 'no riders') + dist + (mins >= 1 ? line('Time recorded', Math.round(mins) + ' min') : '')
      + (earned ? line('Points earned', earned + ' pts') : '') + '<h3 style="margin:12px 0 0">Riders</h3>' + riders
      + (other.length ? '<p class="mut" style="margin-top:10px">Also: ' + other.map((x) => nm(x.rider_id) + ' (' + esc(statusText(x.status)) + ')').join(', ') + '</p>' : ''));
    if (!t.route_km) fetchRouteSummary(id).then((r) => {
      const el = ovT.querySelector('#dt-km'); if (!el) return;
      if (r && r.km) { t.route_km = r.km; t.route_min = r.minutes; t.route_source = r.source; el.innerHTML = line('Distance', kmText(r.km, r.source)); }
      else el.innerHTML = line('Distance', planned ? 'about ' + Math.round(planned) + ' km (map estimate)' : 'not available');
    });
  }
  function rideDetail(matchId) {
    const x = matches.find((m) => m.id === matchId); if (!x) return;
    const q = reqOf(x), t = tripBy(x.trip_id);
    const line = (a, b) => '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span class="mut">' + a + '</span><span style="text-align:right">' + b + '</span></div>';
    const ovR = detailDialog('Ride with ' + nm(x.driver_id),
      '<div style="margin-bottom:8px">' + whoCard(x.driver_id, 'driver') + '</div>' + (q ? line('From', esc(disp(q, 'pickup'))) + line('To', esc(disp(q, 'dropoff'))) : '')
      + line('When', when(x)) + line('Status', esc(statusText(x.status))) + line('Paid', payText(x) + (x.price_dollars ? ' (about $' + (+x.price_dollars).toFixed(2) + ')' : ''))
      + '<div id="dt-km">' + (+(x.route_km || 0) ? line('Distance in the car', (+x.route_km).toFixed(1) + ' km') : (x.status === 'completed' ? line('Distance in the car', 'working it out...') : '')) + '</div>' + (x.id in myRatings ? line('Your rating', myRatings[x.id] ? 'good' : 'not good') : '')
      + (PCOK ? '<div style="margin-top:8px"><button class="btn ghost" data-dtreport="' + x.id + '|' + x.driver_id + '">Report a problem</button></div>' : ''));
    if (x.status === 'completed' && !+(x.route_km || 0)) fetchRouteSummary(x.trip_id).then(async (r) => {
      const el = ovR.querySelector('#dt-km'); if (!el) return;
      let km = null; try { const mm = await sb.from('matches').select('route_km').eq('id', x.id).maybeSingle(); km = mm.data && mm.data.route_km; } catch (e) { /* keep waiting text */ }
      if (km) { x.route_km = km; el.innerHTML = line('Distance in the car', (+km).toFixed(1) + ' km'); } else el.innerHTML = '';
    });
  }
  const reportLine = (m, otherId) => (PCOK && m && ['completed', 'cancelled', 'no_show'].includes(m.status) ? '<div style="margin-top:6px"><button class="btn ghost" data-report="' + m.id + '|' + otherId + '">Report a problem</button></div>' : '');
  let msgTimer = null;
  function msgDialog(matchId) {
    const x = matches.find((m) => m.id === matchId); if (!x) return;
    const other = x.driver_id === user.id ? x.rider_id : x.driver_id;
    const old = document.getElementById('ms-ov'); if (old) old.remove(); clearInterval(msgTimer);
    const ov = document.createElement('div'); ov.id = 'ms-ov'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    ov.innerHTML = '<div style="background:var(--card);color:var(--ink);border-radius:14px;padding:16px;max-width:460px;width:100%;max-height:90vh;display:flex;flex-direction:column"><h2 style="margin:0 0 6px">Messages with ' + nm(other) + '</h2><p class="mut" style="margin:0 0 8px">Only the two of you can see this, while the seat is accepted.</p>'
      + '<div id="ms-list" style="flex:1;overflow:auto;min-height:120px;max-height:45vh;border:1px solid var(--line);border-radius:10px;padding:8px"></div>'
      + '<div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="ms-text" maxlength="500" placeholder="Write a message" style="' + INPUT + ';flex:1"><button class="btn" id="ms-send">Send</button></div><p class="warn" id="ms-msg" role="alert"></p><div style="margin-top:6px"><button class="btn ghost" id="ms-close">Close</button></div></div>';
    document.body.appendChild(ov);
    const paint = () => {
      const list = msgs.filter((m) => m.match_id === matchId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)), box = document.getElementById('ms-list'); if (!box) return;
      box.innerHTML = list.length ? list.map((m) => '<div style="margin:6px 0;text-align:' + (m.sender_id === user.id ? 'right' : 'left') + '"><span style="display:inline-block;max-width:85%;padding:6px 10px;border-radius:12px;background:' + (m.sender_id === user.id ? 'var(--acc)' : 'var(--line)') + ';color:' + (m.sender_id === user.id ? '#fff' : 'var(--ink)') + ';text-align:left">' + esc(m.body) + '</span></div>').join('') : '<p class="mut">No messages yet. Say hello, or tell them where you are.</p>';
      box.scrollTop = box.scrollHeight;
    };
    const pull = async () => {
      try { const r = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(300); if (!r.error) { msgs = r.data || []; paint(); } } catch (e) { /* try again */ }
      if (unreadFor(matchId)) { try { await sb.rpc('mark_messages_read', { p_match: matchId }); msgs.forEach((m) => { if (m.match_id === matchId && m.recipient_id === user.id) m.read_at = m.read_at || new Date().toISOString(); }); } catch (e) { /* ignore */ } }
    };
    paint(); pull(); msgTimer = setInterval(() => { if (!document.getElementById('ms-ov')) { clearInterval(msgTimer); return; } pull(); }, 5000);
    const close = () => { clearInterval(msgTimer); ov.remove(); formSig = ''; render(); };
    document.getElementById('ms-close').onclick = close;
    const send = async () => {
      const inp = document.getElementById('ms-text'), body = inp.value.trim(); if (!body) return;
      const e = (await sb.rpc('send_message', { p_match: matchId, p_body: body })).error;
      if (e) { document.getElementById('ms-msg').textContent = e.message; return; }
      document.getElementById('ms-msg').textContent = ''; inp.value = ''; pull();
    };
    document.getElementById('ms-send').onclick = send;
    document.getElementById('ms-text').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); send(); } };
  }
  const blockedCard = () => !myBlocks.size ? '' : card('People you blocked', '<p class="mut">You will not be matched with these people.</p>' + [...myBlocks].map((id) => '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--line)"><b>' + nm(id) + '</b><button class="btn ghost" data-unblockme="' + id + '">Unblock</button></div>').join(''));
  const adminCard = () => {
    if (!isTest || !MSOK) return '';
    const rows = adminReports.length ? adminReports.map((r) => '<div style="padding:8px 0;border-top:1px solid var(--line)"><b>' + esc(r.reported_name) + '</b> reported by ' + esc(r.reporter_name) + ' <span class="tag">' + esc(String(r.reason).replace(/_/g, ' ')) + '</span>' + (r.reported_blocked ? ' <span class="tag">blocked</span>' : '')
      + '<div class="mut">' + esc(r.details || 'No details') + ' &middot; ' + esc(new Date(r.created_at).toLocaleString()) + ' &middot; ' + r.reports_about_them + ' report' + (r.reports_about_them == 1 ? '' : 's') + ' about them</div>'
      + '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-adm="' + r.id + '|0">Mark handled</button><button class="btn ghost" data-adm="' + r.id + '|1">Handle and block ' + esc(r.reported_name) + '</button>' + (r.reported_blocked ? '<button class="btn ghost" data-unblock="' + r.reported_id + '">Unblock</button>' : '') + '</div></div>').join('') : '<p class="mut">No open reports.</p>';
    return card('Reports to review (admin)', '<p class="mut hint">Only you see this. Blocking stops that account posting trips or requests, getting seats, accepting riders and messaging.</p>' + rows);
  };
  // photo (and car plate for drivers) must be set before asking for or offering a ride
  const needProfile = (kind) => { if (!PCOK || !user) return false; const c = cards[user.id] || {}; const miss = !c.photo ? 'Add your photo first. It is at the top of the Me tab.' : (kind === 'drive' && !c.car_plate ? 'Add your car details first. They are at the top of the Me tab.' : ''); if (!miss) return false; toast(miss); const b = document.getElementById('nb-me'); if (b) b.click(); return true; };
  const REPORT_REASONS = [['late_or_absent', 'Late or not at the pickup spot'], ['unsafe', 'I felt unsafe'], ['wrong_car_or_person', 'Wrong car or wrong person'], ['rude', 'Rude or disrespectful'], ['payment', 'Payment problem'], ['other', 'Something else']];
  function reportDialog(matchId, otherId) {
    const old = document.getElementById('rp-ov'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'rp-ov'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:var(--card);color:var(--ink);border-radius:14px;padding:16px;max-width:420px;width:100%"><h2 style="margin:0 0 6px">Report a problem</h2><p class="mut" style="margin:0 0 8px">About ' + nm(otherId) + '. If you are in danger, call 911 first.</p><label>What happened?</label><select id="rp-reason" style="' + INPUT + '">' + REPORT_REASONS.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select><label>Tell us more (optional)</label><textarea id="rp-text" rows="3" maxlength="1000" style="' + INPUT + '"></textarea><label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="rp-block"> Never match me with this person again</label><div style="margin-top:12px;display:flex;gap:8px"><button class="btn" id="rp-send">Send report</button><button class="btn ghost" id="rp-cancel">Cancel</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById('rp-cancel').onclick = () => ov.remove();
    document.getElementById('rp-send').onclick = async () => {
      const rr = await sb.rpc('report_problem', { p_match: matchId, p_reason: document.getElementById('rp-reason').value, p_details: document.getElementById('rp-text').value.trim() || null });
      const e = (noFn(rr) ? await sb.from('reports').insert({ reported_id: otherId, match_id: matchId, reason: document.getElementById('rp-reason').value, details: document.getElementById('rp-text').value.trim() || null }) : rr).error;
      if (e) { toast('Could not send the report: ' + e.message); return; }
      let msg = 'Report sent. Thank you.';
      if (document.getElementById('rp-block') && document.getElementById('rp-block').checked) { const be = (await sb.rpc('block_person', { p_user: otherId })).error; msg = be ? msg + ' (Could not block: ' + be.message + ')' : msg + ' You will not be matched with them again.'; loadAll(); }
      ov.remove(); toast(msg);
    };
  }
  async function shareTrip(matchId) {
    const x = matches.find((m) => m.id === matchId); if (!x) return;
    const other = x.driver_id === user.id ? x.rider_id : x.driver_id, q = [...otherReqs, ...extraReqs, ...(myReq ? [myReq] : [])].find((r) => r.id === x.request_id), t = tripBy(x.trip_id);
    const text = 'I am sharing a ride with ' + (names[other] || 'someone') + (carLine(other) ? ' (' + carLine(other).replace(/&middot;/g, '-') + ')' : '') + (q ? ' from ' + disp(q, 'pickup') + ' to ' + disp(q, 'dropoff') : '') + (t ? ' at ' + clk(t.depart_min) : '') + ', arranged on RideShare.';
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a message to someone you trust.'); } catch (e) { toast(text); }
  }
  // Small warning next to a name when someone has recent cancellations (counts only, last 30 days).
  const badge = (id, role) => {
    const r = rel[id]; if (!r) return '';
    const bits = role === 'driver' ? (r.driver_cancels ? [r.driver_cancels + ' cancelled ride' + (r.driver_cancels > 1 ? 's' : '')] : [])
      : [r.late_cancels ? r.late_cancels + ' late cancel' + (r.late_cancels > 1 ? 's' : '') : '', r.no_shows ? r.no_shows + ' missed pickup' + (r.no_shows > 1 ? 's' : '') : ''].filter(Boolean);
    return bits.length ? ` <span class="tag" style="background:var(--warnbg);color:var(--warn)">${bits.join(', ')} (30 days)</span>` : '';
  };
  const who = (id, role) => nm(id) + badge(id, role);
  const LATE_MIN = 120;
  const tripBy = (id) => [...otherTrips, ...extraTrips, ...myChildren, ...myTrips, ...(myTrip ? [myTrip] : []), ...(myLiveTrip ? [myLiveTrip] : [])].find((t) => t.id === id);
  // "Leave by 7:48" for a driver who has not set off, "About 9 min" for one who is already driving
  const leaveLine = (id) => {
    const i = leaveInfo[id]; if (!i) return '';
    if (i.flex) return '<div style="margin-top:4px">' + (i.locked ? '<b>Your trip already leaves at ' + (i.leave_by_at ? leaveWhen(Date.parse(i.leave_by_at)) : clk(i.leave_by_min % 1440)) + '.</b> You reach them on time.' : '<b>Accepting sets your leave time to ' + (i.leave_by_at ? leaveWhen(Date.parse(i.leave_by_at)) : clk(i.leave_by_min % 1440)) + '.</b>') + ' <span class="mut">They are ready until ' + clk(i.ready_until_min % 1440) + '.</span></div>';
    if (i.moving) return '<div style="margin-top:4px"><b>About ' + Math.max(1, Math.round(i.offset_min)) + ' min to reach them.</b></div>';
    if (i.leave_by_min == null) return '';
    const late = i.leave_by_at && Date.parse(i.leave_by_at) < Date.now();
    return late ? '<div class="warn" style="margin-top:4px">It is too late to reach them in their ready time.</div>'
      : '<div style="margin-top:4px"><b>Leave by ' + (i.leave_by_at ? leaveWhen(Date.parse(i.leave_by_at)) : clk(i.leave_by_min % 1440)) + '</b> to reach them. <span class="mut">They are ready until ' + clk(i.ready_until_min % 1440) + '.</span></div>';
  };
  const pickupMs = (m) => { if (m.pickup_time) return Date.parse(m.pickup_time); const t = tripBy(m.trip_id); return t ? RSD.vanEpoch(m.ride_date, t.depart_min) : null; };
  const pickMin = (m, t) => {
    if (m.pickup_time) {
      try {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(m.pickup_time));
        const g = (k) => +p.find((z) => z.type === k).value;
        return (g('hour') % 24) * 60 + g('minute');
      } catch (e) { /* use the trip's leave time */ }
    }
    return t ? t.depart_min : null;
  };
  // the clock time (minutes since midnight, Vancouver) of a timestamp
  const vanMin = (iso) => {
    try {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
      const g = (k) => +p.find((z) => z.type === k).value;
      return (g('hour') % 24) * 60 + g('minute');
    } catch (e) { return null; }
  };
  const lateUsedThisMonth = (excludeId) => matches.some((x) => x.rider_id === user.id && x.id !== excludeId && x.late && x.cancelled_by === user.id && x.cancelled_at && RSD.vanMonth(Date.parse(x.cancelled_at)) === RSD.vanMonth(Date.now()));
  // Plain-language result of cancelling this match now (mirrors the database rules).
  function cancelInfo(m) {
    const isRider = m.rider_id === user.id, pts = m.pay_with === 'points' ? m.points : 0;
    if (m.status === 'requested') return { ok: true, text: 'Free to cancel. No points have moved.' };
    if (!isRider) return { ok: true, text: 'If you cancel, ' + nm(m.rider_id) + ' gets ' + (pts ? 'all ' + pts + ' points' : 'nothing charged') + ' back. Cancelling often shows as a warning next to your name.' };
    const pk = pickupMs(m); if (pk == null) return { ok: true, text: 'Cancel this ride.' };
    if (!m.arrived_at && Date.now() >= pk + 15 * 60000) return { ok: true, text: 'Your driver is very late. You can cancel and get ' + (pts ? 'all ' + pts + ' points' : 'nothing charged') + ' back.' };
    if (Date.now() >= pk) return { ok: false, text: 'The pickup time has passed, so this ride can no longer be cancelled. Your driver can close the ride as a missed pickup.' };
    const late = pk - Date.now() < LATE_MIN * 60000;
    if (!pts) return { ok: true, text: late ? 'Late cancel (within 2 hours). No points involved, but it counts toward your cancellation record.' : 'Free to cancel. No points involved.' };
    if (!late) return { ok: true, text: 'Free to cancel: you get all ' + pts + ' points back.' };
    if (!lateUsedThisMonth(m.id)) return { ok: true, text: 'This is a late cancel (within 2 hours), but your one free late cancel this month covers it: you get all ' + pts + ' points back.' };
    const keep = Math.floor(pts / 2);
    return { ok: true, text: 'Late cancel (within 2 hours) and your free one this month is used: your driver keeps ' + keep + ' points and you get ' + (pts - keep) + ' back.' };
  }
  // the driver has arrived at the pickup, and it is the rider's pickup time or later
  const canNoShow = (m) => { const pk = pickupMs(m); return m.status === 'accepted' && !m.picked_up_at && m.driver_id === user.id && pk != null && !!m.arrived_at && Date.now() >= pk; };
  // Ride steps (driver taps, rider sees): accepted -> on_my_way -> arrived -> picked_up -> dropped_off (completed)
  const stageOf = (m) => (m.status === 'completed' && m.dropped_off_at ? 'dropped_off' : m.picked_up_at ? 'picked_up' : m.arrived_at ? 'arrived' : m.en_route_at ? 'on_my_way' : 'accepted');
  const STEP_LABEL = { accepted: 'seat confirmed', on_my_way: 'driver on the way', arrived: 'driver has arrived', picked_up: 'ride in progress', dropped_off: 'completed' };
  const nextStep = (m, riderName) => ({ accepted: { step: 'on_my_way', label: 'On my way' }, on_my_way: { step: 'arrived', label: 'Arrived at pickup' }, arrived: { step: 'picked_up', label: 'Picked up ' + riderName }, picked_up: { step: 'dropped_off', label: 'Dropped off ' + riderName } }[stageOf(m)]);
  const stepsOpen = (m) => { const pk = pickupMs(m); return pk != null && Date.now() >= pk - LATE_MIN * 60000; };
  // Opens the Google Maps app with directions to the next stop (pickup, then drop-off). Areas are neighbourhood centres, not exact addresses.
  function mapsLink(m, req) {
    if (!req) return '';
    const spot = stageOf(m) !== 'picked_up' && m.meet_lat != null ? { lat: +m.meet_lat, lng: +m.meet_lng } : pt(req, stageOf(m) === 'picked_up' ? 'dropoff' : 'pickup'); if (!spot) return '';
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + spot.lat + ',' + spot.lng;
  }
  const statusText = (s) => ({ requested: 'requested', accepted: 'accepted', completed: 'completed', cancelled: 'cancelled', declined: 'declined', no_show: 'missed pickup' }[s] || s);

  const dowOf = (d) => { const x = d && new Date(d + 'T12:00:00'); return x && !isNaN(x) ? x.getDay() : undefined; };
  const driverObj = (t0, date) => { const t = forDate(t0, date); return ({ dow: dowOf(date || t.trip_date), origin: pt(t, 'origin'), dest: pt(t, 'dest'), departMin: t.depart_min, maxDetour: t.max_detour, maxTotal: t.max_total_detour == null ? null : t.max_total_detour, maxKm: t.max_detour_km == null ? null : +t.max_detour_km, maxTotalKm: t.max_total_detour_km == null ? null : +t.max_total_detour_km, maxPickups: t.max_pickups == null ? null : t.max_pickups, maxWait: t.max_wait, accepts: t.accepts, cpk: Number(t.cost_per_km) || 0.2, name: names[t.user_id] || 'Driver' }); };
  const riderObj = (r) => ({ id: r.id, name: names[r.user_id] || 'Rider', pickup: pt(r, 'pickup'), dropoff: pt(r, 'dropoff'), readyFrom: r.ready_from, readyTo: r.ready_to, pays: r.pays });
  const known = (x) => LOC[x.origin || x.pickup] && LOC[x.dest || x.dropoff];
  const baseOf = (x) => (x.live ? todayStr() : (x.trip_date || x.ride_date));
  const forDate = (t, d) => (!t || !d || t.series_parent ? t : (myChildren.find((c) => c.series_parent === t.id && c.trip_date === d && c.active !== false) || t));   // the day's own trip, if it has one
  const inFam = (id, t) => !!t && (id === t.id || myChildren.some((c) => c.id === id && c.series_parent === t.id));
  const rootId = (id) => { const t = tripBy(id); return (t && t.series_parent) || id; };
  const skipsOf = (id) => skipMap[id] || new Set();   // days the driver skipped on a repeating trip
  const rawOn = (x, d) => RSD.occursOn(baseOf(x), x.repeat_days, d, x.repeat_until, x.repeat_every, x.repeat_nth);
  const occOf = (x, n) => RSD.nextOccurrences(baseOf(x), x.repeat_days, new Date(), n, x.repeat_until, x.repeat_every, x.repeat_nth, x.trip_date ? skipsOf(x.id) : null);
  const tripOn = (t, d) => rawOn(t, d) && !skipsOf(t.id).has(d);   // Offer a ride now trips always count as today, even after midnight
  const reqOn = (r, d) => rawOn(r, d);

  // A repeating trip and a repeating request that were accepted once keep booking the coming week by themselves (server side).
  async function syncSeries() {
    if (!user || SYOK === false || Date.now() - lastSync < 600000) return;
    if (!(myTrips.some((t) => t.repeat_days && t.repeat_days.length) || (myReq && !myReq.live && myReq.repeat_days && myReq.repeat_days.length))) return;
    lastSync = Date.now();
    try {
      const r = await sb.rpc('sync_my_series');
      if (r.error) { if (/does not exist|schema cache|could not find/i.test(r.error.message)) SYOK = false; return; }
      if (r.data > 0) loadAll();
    } catch (e) { /* try again later */ }
  }
  async function loadAll() {
    if (!user || busy) return; busy = true;
    try {
      const uid = user.id;
      try { await sb.rpc('settle_due'); } catch (e) { /* older database: ignore */ }
      try { await sb.rpc('expire_live'); } catch (e) { /* older database: ignore */ }
      if (dndOn === null) refreshDnd();
      if (DKOK === null) DKOK = !(await sb.from('trips').select('max_detour_km').limit(1)).error;
      if (AAOK === null) AAOK = !(await sb.from('trips').select('auto_accept').limit(1)).error;
      if (UNOK === null) UNOK = !(await sb.from('trips').select('repeat_until').limit(1)).error;
      if (RPOK === null) RPOK = !(await sb.from('trips').select('repeat_nth').limit(1)).error;
      if (!PLOK) { const was = PLOK; PLOK = !!(window.RS_PLACES && window.RS_PLACES.available()) && !(await sb.from('trips').select('origin_lat').limit(1)).error; if (PLOK && was === false) formSig = ''; }
      const [p, w, l, t, r, m, ot, orq] = await Promise.all([
        sb.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        sb.from('wallets').select('points').eq('user_id', uid).maybeSingle(),
        sb.from('ledger').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(10),
        sb.from('trips').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(12),
        sb.from('ride_requests').select('*').eq('user_id', uid).eq('active', true).order('created_at', { ascending: false }).limit(6),
        sb.from('matches').select('*').order('created_at', { ascending: false }).limit(60),
        sb.from('trips').select('*').eq('active', true).neq('user_id', uid).limit(100),
        sb.from('ride_requests').select('*').eq('active', true).neq('user_id', uid).limit(100),
      ]);
      me = { name: (p.data && p.data.display_name) || '', points: (w.data && w.data.points) || 0 };
      const stillLive = (x) => x.live && x.expires_at && Date.parse(x.expires_at) > Date.now();
      ledger = l.data || [];
      myLiveTrip = (t.data || []).find(stillLive) || null; const nextOf = (x) => (occOf(x, 1)[0] || x.trip_date);
      myChildren = (t.data || []).filter((x) => !x.live && x.series_parent);
      myTrips = (t.data || []).filter((x) => !x.live && !x.series_parent).sort((a, b) => (nextOf(a) + String(10000 + (a.flex_from != null ? a.flex_from : a.depart_min))).localeCompare(nextOf(b) + String(10000 + (b.flex_from != null ? b.flex_from : b.depart_min))));
      myTrip = myTrips.find((x) => x.id === selTripId) || myTrips[0] || null; selTripId = myTrip ? myTrip.id : null; syncCur();
      if (!myLiveTrip) autoAlerts = false; else if (!autoAlerts && !driveSession && nativeLoc()) { autoAlerts = true; startAlerts(nativeLoc()); }
      riderAlertsCheck();
      myLiveReq = (r.data || []).find(stillLive) || null; myReq = (r.data || []).find((x) => !x.live) || null; curReq = myLiveReq || myReq;
      matches = m.data || []; otherTrips = ot.data || []; otherReqs = orq.data || [];
      const tIds = [...new Set(matches.map((x) => x.trip_id))], rIds = [...new Set(matches.map((x) => x.request_id))];
      const [et, er] = await Promise.all([
        tIds.length ? sb.from('trips').select('*').in('id', tIds) : { data: [] },
        rIds.length ? sb.from('ride_requests').select('*').in('id', rIds) : { data: [] },
      ]);
      extraTrips = et.data || []; extraReqs = er.data || [];
      // places outside the built-in list that are already on saved trips and requests
      [t.data, r.data, ot.data, orq.data, et.data, er.data].forEach((rows) => (rows || []).forEach((x) => [['origin', 'origin'], ['dest', 'dest'], ['pickup', 'pickup'], ['dropoff', 'dropoff']].forEach(([k, p]) => { if (x[k] && x[p + '_lat'] != null && x[p + '_lng'] != null) registerArea(x[k], +x[p + '_lat'], +x[p + '_lng']); })));
      const ids = new Set([uid, ...otherTrips.map((x) => x.user_id), ...otherReqs.map((x) => x.user_id), ...extraTrips.map((x) => x.user_id), ...extraReqs.map((x) => x.user_id), ...matches.flatMap((x) => [x.driver_id, x.rider_id])]);
      const n = await sb.from('profiles').select('id,display_name').in('id', [...ids]);
      (n.data || []).forEach((x) => { names[x.id] = x.display_name; });
      if (PCOK === null) PCOK = !(await sb.from('profile_cards').select('user_id').limit(1)).error;
      if (PCOK) { try { const pc = await sb.from('profile_cards').select('*').in('user_id', [...ids]); cards = {}; (pc.data || []).forEach((x) => { cards[x.user_id] = x; }); } catch (e) { cards = {}; } }
      try {
        const ub = await sb.from('user_blocks').select('blocked');
        if (!ub.error) {
          myBlocks = new Set((ub.data || []).map((z) => z.blocked));
          otherTrips = otherTrips.filter((x) => !myBlocks.has(x.user_id)); otherReqs = otherReqs.filter((x) => !myBlocks.has(x.user_id));
          if (myBlocks.size) { const bn = await sb.from('profiles').select('id,display_name').in('id', [...myBlocks]); (bn.data || []).forEach((z) => { names[z.id] = z.display_name; }); }
        }
      } catch (e) { /* older database: no personal blocks */ }
      if (MSOK === null) MSOK = !(await sb.from('messages').select('id').limit(1)).error;
      if (MSOK) {
        try {
          const ms = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(300); msgs = ms.data || [];
          const rt = await sb.from('ratings').select('match_id,up').limit(300); myRatings = {}; (rt.data || []).forEach((z) => { myRatings[z.match_id] = z.up; });
          const sm = await sb.rpc('rating_summaries', { p_ids: [...ids] }); scores = {}; (sm.data || []).forEach((z) => { scores[z.user_id] = { n: z.n, up: z.up }; });
        } catch (e) { /* keep the last values */ }
      }
      try { const ta = await sb.from('test_accounts').select('user_id,test_mode').eq('user_id', uid).maybeSingle(); isTest = !!ta.data; testMode = !!(ta.data && ta.data.test_mode); } catch (e) { isTest = false; testMode = false; }
      if (isTest && MSOK) { try { const ar = await sb.rpc('admin_reports', { p_open: true }); adminReports = ar.error ? [] : (ar.data || []); } catch (e) { adminReports = []; } }
      try { const pt = await sb.from('trips').select('*').eq('user_id', uid).eq('active', false).order('created_at', { ascending: false }).limit(12); pastTrips = pt.data || []; } catch (e) { pastTrips = []; }
      try { let left = 3; for (const t of pastTrips.slice(0, 8)) { if (left <= 0) break; if (t.route_km || t.active || !(matches.some((x) => x.trip_id === t.id && x.status === 'completed') || t.live)) continue; left--; const r = await fetchRouteSummary(t.id); if (r && r.km) { t.route_km = r.km; t.route_min = r.minutes; t.route_source = r.source; } } } catch (e) { /* older database */ }
      try {
        const asks = matches.filter((x) => x.driver_id === uid && (x.status === 'requested' || (x.status === 'accepted' && !x.en_route_at && !x.picked_up_at))).slice(0, 8); const li = {};
        await Promise.all(asks.map(async (x) => { const r = await sb.rpc('leave_info', { p_match: x.id }); if (!r.error && r.data && r.data.ok) li[x.id] = r.data; }));
        leaveInfo = li;
      } catch (e) { leaveInfo = {}; /* older database: no leave-by */ }
      if (CDOK === null) CDOK = !(await sb.from('trips').select('changed_day').limit(1)).error;
      if (NTOK !== false) { try { const nr = await sb.from('notices').select('id,kind,title,body,created_at').is('read_at', null).order('created_at', { ascending: false }).limit(10); if (nr.error) { NTOK = false; notices = []; } else { NTOK = true; notices = nr.data || []; } } catch (e) { notices = []; } }
      if (RPOK) {
        try {
          const ids = [...new Set([...myTrips, ...otherTrips, ...extraTrips].filter((x) => x.repeat_days && x.repeat_days.length).map((x) => x.id))];
          const sk = ids.length ? await sb.from('trip_skips').select('trip_id,skip_date').in('trip_id', ids.slice(0, 150)) : { data: [] }; skipMap = {};
          (sk.data || []).forEach((r) => { (skipMap[r.trip_id] = skipMap[r.trip_id] || new Set()).add(r.skip_date); });
          myChildren.forEach((c) => { if (c.active !== false && skipMap[c.series_parent]) skipMap[c.series_parent].delete(c.trip_date); });   // for me the day is still part of my repeating trip
        } catch (e) { skipMap = {}; }
      }
      if (SYOK !== false) { try { const so = await sb.from('series_off').select('trip_id,request_id'); if (so.error) { offSet = new Set(); } else offSet = new Set((so.data || []).map((r) => r.trip_id + '|' + r.request_id)); } catch (e) { offSet = new Set(); } }
      try {
        const mineEx = matches.filter((x) => x.driver_id === uid && x.status === 'accepted' && !x.dropped_off_at && x.ride_date >= todayStr()).slice(0, 8), exo = {};
        await Promise.all(mineEx.map(async (x) => { const r = await sb.rpc('match_exact', { p_match: x.id }); if (!r.error && r.data) exo[x.id] = r.data; }));
        exactBy = exo;
      } catch (e) { exactBy = {}; /* older database: rounded places only */ }
      try {
        const rq = matches.filter((x) => x.driver_id === uid && x.status === 'requested').slice(0, 12); const fv = {};
        await Promise.all(rq.map(async (x) => { const f = await sb.rpc('request_fits', { p_match: x.id }); if (!f.error && typeof f.data === 'boolean') fv[x.id] = f.data; }));
        fitServer = fv;
      } catch (e) { fitServer = {}; /* older database: nothing is hidden */ }
      try { const ds = await sb.from('drive_sessions').select('*').order('started_at', { ascending: false }).limit(60); drives = ds.data || []; } catch (e) { drives = []; }
      try { const st = await sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle(); mySet = st.data || null; const sr = await sb.rpc('ride_styles', { p_ids: [...ids] }); styles = {}; (sr.data || []).forEach((x) => { styles[x.user_id] = x; }); } catch (e) { /* older database without settings: ignore */ }
      const rl = await sb.from('reliability').select('*'); rel = {}; (rl.data || []).forEach((x) => { rel[x.user_id] = x; });
      const pp = await sb.from('driver_positions').select('*'); positions = {}; (pp.data || []).forEach((x) => { positions[x.driver_id] = x; });
    } catch (e) { fail(e); } finally { busy = false; syncSeries(); }
    render();
  }

  // ---------- sign in ----------
  function renderAuth() {
    const bar = $('auth-bar');
    bar.classList.toggle('signedin', !!user);
    if (user) {
      bar.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span>Signed in as <b>${esc(me.name || user.email)}</b> <span class="mut">&middot; ${me.points} pts</span></span><button class="btn ghost" id="lv-out">Sign out</button></div>`;
      $('lv-out').onclick = async () => { try { await sb.rpc('stop_sharing'); } catch (e) { /* signing out matters more */ } try { const nat = nativeLoc(); if (nat) nat.stop(); } catch (e) { /* ignore */ } sb.auth.signOut(); };
      return;
    }
    bar.innerHTML = `<div class="card"><h2>Sign in</h2>
      <button class="btn" id="lv-google" style="width:100%;padding:12px;font-size:15px">Continue with Google</button>
      <p class="mut hint">Others only see your first name and neighbourhood-level areas. Or use an email link:</p>
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
    const today = todayStr(), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    // a scheduled trip: plan the next day that has an accepted rider (today if there is one)
    let d = today;
    if (!curTrip.live) { const days = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, curTrip) && x.ride_date >= today && x.status === 'accepted').map((x) => x.ride_date).sort(); if (days.length && !days.includes(today)) d = days[0]; }
    if (hv() === 'trip' && viewD && !curTrip.live) d = viewD;
    const isToday = d === today;
    const acc = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, curTrip) && x.ride_date === d && x.status === 'accepted' && reqById[x.request_id] && known(reqById[x.request_id]));
    if (!acc.length) {
      // every rider is dropped off, but the driver is not at the destination yet: keep a final step until they end the trip
      let on = ''; try { on = localStorage.getItem('rs_trip_on') || ''; } catch (e) { /* storage blocked */ }
      if (!curTrip.live) return null;
      if (!(on && on === curTrip.id)) {
        // trip on, no riders yet: show the route with a Start trip button; riders who are accepted become stops
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes() + 2, dr0 = Object.assign({}, driverObj(curTrip, d), { departMin: nowMin });
        const o = pt(curTrip, 'origin'), de = pt(curTrip, 'dest'), mins = RS.minutes(o, de, nowMin, dr0.dow);
        const row = (i, t, label) => '<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)"><span style="flex:none;width:24px;height:24px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center">' + i + '</span><b style="min-width:76px;white-space:nowrap">' + clk(t) + '</b><span>' + label + '</span></div>';
        return { stops: [{ loc: o, type: 'origin' }, { loc: de, type: 'dest' }],
          html: '<p class="mut" style="margin-top:0">No riders yet. About ' + fmtMin(mins) + ' if you drive straight there. Riders who ask for a seat show up at the top of this page. Accepted riders are added as stops.</p>' + row(1, nowMin, 'Start: <b>' + esc(disp(curTrip, 'origin')) + '</b>') + row(2, nowMin + mins, 'Arrive: <b>' + esc(disp(curTrip, 'dest')) + '</b>')
            + '<div style="margin-top:12px"><button class="btn" data-startnav="1" style="width:100%;padding:14px;font-size:17px">Start trip</button></div><div style="margin-top:12px"><button class="btn ghost" data-reset="trip">Cancel this trip</button></div>' };
      }
      return { stops: [{ loc: pt(curTrip, 'origin'), type: 'origin' }, { loc: pt(curTrip, 'dest'), type: 'dest' }],
        html: '<p style="margin-top:0">' + (matches.some((x) => x.driver_id === user.id && x.ride_date === d && x.status === 'completed') ? '<b>All riders are dropped off.</b> Keep driving to <b>' : '<b>You are on your way.</b> Riders along your route can still ask for a seat. Keep driving to <b>') + esc(disp(curTrip, 'dest')) + '</b>.</p><div style="margin-top:12px"><button class="btn" data-reset="end" style="width:100%;padding:14px;font-size:17px">I have arrived: end trip</button></div><p class="mut hint" style="margin:8px 0 0">Tap this when you reach your destination. It turns off driving mode and takes the trip down.</p>' };
    }
    let dr = driverObj(curTrip, d);
    if (curTrip.live) { const n = new Date(); dr = Object.assign({}, dr, { departMin: n.getHours() * 60 + n.getMinutes() + 2 }); }   // an Offer a ride now trip leaves about now
    const objs = acc.map((x) => riderObj(withMeet(x, reqById[x.request_id])));
    const stops = RS.buildRoute(dr, objs) || RS.buildRoute(dr, objs, true) || RS.buildRoute(dr, []);
    const direct = RS.minutes(dr.origin, dr.dest, dr.departMin, dr.dow);
    let ev = RS.evaluate(stops, dr.departMin, dr.maxWait, dr.dow);
    if (curTrip.live) {   // leaving about now: plain driving times, no waiting for a rider's window
      let t = dr.departMin; ev = { timeline: stops.map((st, i) => { if (i > 0) t += RS.minutes(stops[i - 1].loc, st.loc, t, dr.dow); return { stop: st, arrive: t }; }) }; ev.totalMin = t - dr.departMin;
    }
    // the place as the app knows it: the street or spot the person chose, then the neighbourhood; plus a link that opens that point on the map
    const placeTxt = (row, k) => { const lab = row && row[k + '_label'], area = row && row[k]; return esc(lab || area || '') + (lab && area && lab !== area && !String(lab).includes(area) ? ' <span class="mut">(' + esc(area) + ')</span>' : ''); };
    const mapLink = (loc) => (loc && loc.lat != null && loc.lng != null ? ' <a ' + mapAttrs(loc.lat, loc.lng) + '>Open on map</a>' : '');
    const label = (s) => {
      const x = s.rider && acc.find((m) => m.request_id === s.rider.id), q = x ? withMeet(x, reqById[s.rider.id]) : s.rider && reqById[s.rider.id];
      const meet = s.type === 'pickup' && x ? meetLine(x) : '';
      if (s.type === 'origin') return 'Start: <b>' + placeTxt(curTrip, 'origin') + '</b>' + mapLink(s.loc);
      if (s.type === 'dest') return 'Arrive: <b>' + placeTxt(curTrip, 'dest') + '</b>' + mapLink(s.loc);
      if (s.type === 'pickup') return 'Pick up <b>' + esc(s.rider.name) + '</b>' + (q ? '<div>' + placeTxt(q, 'pickup') + mapLink(s.loc) + '</div>' : '') + meet;
      return 'Drop off <b>' + esc(s.rider.name) + '</b>' + (q ? '<div>' + placeTxt(q, 'dropoff') + mapLink(s.loc) + '</div>' : '');
    };
    const rows = ev.timeline.map((t, i) => '<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)"><span style="flex:none;width:24px;height:24px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center">' + (i + 1) + '</span><b style="min-width:76px;white-space:nowrap">' + (i === 0 ? clk(dr.departMin) : clk(t.arrive)) + '</b><span>' + label(t.stop) + '</span></div>').join('');
    const extra = Math.max(0, Math.round(ev.totalMin - direct));
    // One big button at a time, in order: Start trip, then Picked up (per rider, in route order), then Dropped off. Same actions as the phone notification.
    let tripOnId = ''; try { tripOnId = localStorage.getItem('rs_trip_on') || ''; } catch (e) { /* storage blocked */ }
    const started = isToday && (acc.some((x) => x.en_route_at) || !!curTrip.live);   // a Leave now trip has already set off: no Start trip, straight to Picked up / Dropped off
    const bigBtn = (attr, label) => '<button class="btn" ' + attr + ' style="width:100%;padding:14px;font-size:17px">' + label + '</button>';
    let next = '';
    if (!started) next = isToday ? bigBtn('data-startnav="1"', 'Start trip') : '';
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
    const pax = acc.map((x) => { const q = withExact(x, reqById[x.request_id]);
      return '<div style="padding:8px 0;border-top:1px solid var(--line)"><b>' + nm(x.rider_id) + '</b>' + badge(x.rider_id, 'rider') + tagsFor(x.rider_id, 'rider') + '<div class="mut">' + (x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share') + (q ? ' &middot; ' + esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) : '') + '</div>' + meetLine(x) + (msgButton(x) || meetButton(x) ? '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">' + msgButton(x) + meetButton(x) + '</div>' : '') + '</div>'; }).join('');
    const paxBlock = '<div style="margin-top:12px"><b>' + (acc.length > 1 ? 'Passengers' : 'Passenger') + '</b>' + pax + '<p class="mut hint" style="margin:8px 0 0">For privacy the app only keeps the street or place name (within about 100 m), never a house number. Use <b>Meeting spot</b> to agree the exact place with each rider.</p></div>';
    // Detour: how much extra time and distance the riders add, against the driver's limits
    const baseStops = [{ loc: dr.origin, type: 'origin' }, { loc: dr.dest, type: 'dest' }], limMin = Math.max(dr.maxTotal == null ? dr.maxDetour : dr.maxTotal, dr.maxDetour);
    const limKm = dr.maxKm == null && dr.maxTotalKm == null ? null : Math.max(dr.maxTotalKm == null ? dr.maxKm : dr.maxTotalKm, dr.maxKm || 0);
    const totKm = Math.max(0, RS.km(stops) - RS.km(baseStops)), totMin = Math.max(0, extra);
    const parts = objs.map((r) => { const without = RS.buildRoute(dr, objs.filter((o) => o !== r), true); if (!without) return ''; const ew = RS.evaluate(without, dr.departMin, dr.maxWait, dr.dow); return esc(r.name) + ' +' + Math.max(0, Math.round(ev.totalMin - ew.totalMin)) + ' min'; }).filter(Boolean).join(', ');
    const over = totMin > limMin + 0.5 || (limKm != null && totKm > limKm + 0.1);
    const detourBlock = '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:' + (over ? '#fdecea' : 'var(--acc2)') + '"><b>Detour: +' + Math.round(totMin) + ' min</b> of ' + limMin + ' allowed' + (limKm != null ? ' &middot; <b>+' + totKm.toFixed(1) + ' km</b> of ' + limKm + ' allowed' : (totKm > 0.05 ? ' &middot; +' + totKm.toFixed(1) + ' km' : '')) + (parts ? '<div class="mut" style="margin-top:2px">' + parts + '</div>' : '') + (over ? '<div class="warn" style="margin-top:2px">Over your limit. Accepted riders stay on the trip.</div>' : '') + '</div>';
    const note = started
      ? '<p class="mut hint" style="margin:8px 0 0">This is the next step. The same button also appears in your phone notification, so you can stay in Google Maps. </p><button class="btn ghost" data-startnav="1" style="margin-top:6px">Open Google Maps again</button>'
      : !isToday ? '<p class="mut hint" style="margin:8px 0 0">On the day, open the app and tap <b>Start trip</b> (or <b>Leave now</b>). This plan updates by itself when you accept or cancel a rider.</p>'
      : '<p class="mut hint" style="margin:8px 0 0">Start trip tells your riders you are on your way and opens Google Maps with all of these stops. If Maps is already navigating, tap X in Maps first.</p>';
    return { stops, html: '<p class="mut" style="margin-top:0">' + (started ? 'Your trip is under way. About ' : isToday ? 'Review this, then tap Start trip. About ' : 'Your plan for <b>' + esc(RSD.label(d)) + '</b>: leave at <b>' + clk(dr.departMin) + '</b>. About ') + fmtMin(ev.totalMin) + ' in all' + (extra ? ', ' + extra + ' min more than driving alone' : '') + '.</p>' + rows
      + detourBlock
      + paxBlock
      + '<div style="margin-top:12px">' + next + '</div>' + note
      + '<div style="margin-top:12px"><button class="btn ghost" data-reset="trip">Cancel this trip</button></div>' };
  }
  // Seat requests at the very top of Home, so a rider asking is the first thing the driver sees.
  const optNum = (id) => { const e = $(id), v = e ? String(e.value).trim() : ''; return v === '' ? null : Math.max(0, Math.round(+v * 10) / 10); };
  const kmCols = (src) => (DKOK ? { max_detour_km: src.d_detour_km == null ? null : src.d_detour_km, max_total_detour_km: src.d_total_detour_km == null ? null : src.d_total_detour_km } : {});
  // Does this request (a match in the 'requested' state) fit my limits together with the riders I have already accepted?
  // Returns null when it cannot be worked out (then it is shown), { fits: false } to hide it, or the numbers to show.
  function reqFit(x) {
    try {
      if (!curTrip || !known(curTrip) || !user) return null;
      const reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
      const q = reqById[x.request_id]; if (!q || !known(q)) return null;
      const dr = driverObj(curTrip, x.ride_date);
      if (curTrip.live) dr.departMin = new Date().getHours() * 60 + new Date().getMinutes() + 2;
      const ctd = forDate(curTrip, x.ride_date); if (isFlexFree(ctd)) { const dep = flexDepart(ctd, dr, riderObj(q), x.ride_date); if (dep == null) return { fits: false }; dr.departMin = dep; }   // a flexible trip: the leave time that suits this rider
      const accObjs = matches.filter((a) => a.driver_id === user.id && a.trip_id === x.trip_id && a.ride_date === x.ride_date && a.status === 'accepted' && reqById[a.request_id] && known(reqById[a.request_id])).map((a) => riderObj(reqById[a.request_id]));
      const res = RS.findMatches(dr, [riderObj(q)], accObjs);
      if (!res.length) return { fits: false };
      const m = res[0], limMin = Math.max(dr.maxTotal == null ? dr.maxDetour : dr.maxTotal, dr.maxDetour);
      const limKm = dr.maxKm == null && dr.maxTotalKm == null ? null : Math.max(dr.maxTotalKm == null ? dr.maxKm : dr.maxTotalKm, dr.maxKm || 0);
      return { fits: true, addMin: m.addedDetour, addKm: m.addedKm, totalMin: m.detour, totalKm: m.detourKm, limMin, limKm, riders: accObjs.length };
    } catch (e) { return null; }
  }
  const fitsOk = (x) => { const f = reqFit(x); return !f || f.fits; };
  const detourLine = (f) => !f || !f.fits ? '' : '<div style="margin-top:4px"><b>+' + Math.max(0, Math.round(f.addMin)) + ' min detour</b> for this rider' + (f.addKm > 0.05 ? ' (+' + f.addKm.toFixed(1) + ' km)' : '') + '</div><div class="mut">' + (f.riders ? 'With your ' + f.riders + ' rider' + (f.riders > 1 ? 's' : '') + ' so far, your total detour becomes ' : 'Your total detour would be ') + '<b>+' + Math.max(0, Math.round(f.totalMin)) + ' min</b> (limit ' + f.limMin + ')' + (f.limKm != null ? ' and <b>+' + Math.max(0, f.totalKm).toFixed(1) + ' km</b> (limit ' + f.limKm + ')' : '') + '</div>';
  // One waiting seat request: who, WHICH DAY, which of my trips, the rider's journey, the extra time, Accept / Decline
  function requestCard(x, inTrip) {
    const q = [...otherReqs, ...extraReqs].find((r) => r.id === x.request_id); if (!q) return '';
    return '<div style="padding:8px 0;border-top:1px solid var(--line)"><b style="font-size:17px">' + nm(x.rider_id) + '</b>' + badge(x.rider_id, 'rider') + tagsFor(x.rider_id, 'rider') + (() => { const tr = tripBy(x.trip_id); return '<div style="margin:4px 0;font-size:16px"><b>' + esc(dateLong(x.ride_date)) + '</b>' + (tr ? ' &middot; ' + (isFlexFree(tr) ? 'you leave between ' + clk(tr.flex_from) + ' and ' + clk(tr.flex_to) : 'you leave ' + clk(tr.depart_min)) : '') + '</div>' + (tr && !inTrip ? '<div class="mut">Your trip: ' + esc(disp(tr, 'origin')) + ' to ' + esc(disp(tr, 'dest')) + '</div>' : ''); })() + '<div class="mut">Rider: ' + esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) + ' &middot; ready ' + clk(q.ready_from) + ' to ' + clk(q.ready_to) + ' &middot; ' + (x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share') + '</div>' + detourLine(reqFit(x)) + leaveLine(x.id) + '<div style="margin-top:8px"><button class="btn" data-acc="' + x.id + '" style="padding:12px 22px;font-size:16px">Accept</button> <button class="btn ghost" data-dec="' + x.id + '">Decline</button></div></div>';
  }
  function renderRequests() {
    const wrap = $('req-wrap'); if (!wrap) return;
    const reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const t0 = todayStr(), nowMs = Date.now();
    const mineAll = user ? matches.filter((x) => x.driver_id === user.id && x.ride_date >= t0) : [];
    const gone = (x) => { const q = reqById[x.request_id]; return !q || q.active === false || (q.expires_at && Date.parse(q.expires_at) < nowMs); };
    const asks = mineAll.filter((x) => x.status === 'requested' && !gone(x) && fitServer[x.id] !== false);
    // riders I accepted who are still waiting for me to set off, with the time I must leave by
    const waiting = mineAll.filter((x) => x.status === 'accepted' && !x.en_route_at && !x.picked_up_at && leaveInfo[x.id] && !leaveInfo[x.id].moving && leaveInfo[x.id].leave_by_ms)
      .sort((p, q) => leaveInfo[p.id].leave_by_ms - leaveInfo[q.id].leave_by_ms);
    if (!asks.length && !waiting.length) { wrap.classList.add('hide'); return; }
    wrap.classList.remove('hide');
    $('req-title').textContent = asks.length ? (asks.length > 1 ? asks.length + ' riders are asking for a seat' : 'A rider is asking for a seat') : 'Time to leave';
    let banner = '';
    if (waiting.length) {
      const w = waiting[0], ms = leaveInfo[w.id].leave_by_ms, left = Math.round((ms - nowMs) / 60000);
      const when = left > 0 ? 'in ' + fmtLeft(left) : left === 0 ? 'now' : fmtLeft(Math.abs(left)) + ' ago';
      banner = '<div class="' + (left <= 5 ? 'warn' : '') + '" style="padding:8px 0"><b>' + (left <= 0 ? 'Leave now to reach ' : 'Leave by ' + leaveWhen(ms) + ' (' + when + ') to reach ') + nm(w.rider_id) + '.</b>' + (left <= 0 ? ' <span class="mut">Your leave-by time was ' + leaveWhen(ms) + ' (' + when + ').</span>' : '') + '</div>';
    }
    const cardArr = asks.map((x) => requestCard(x));
    const more = cardArr.length - 2, cards = cardArr.slice(0, 2).join('') + (more > 0 ? fold('f-more-asks', more + ' more request' + (more === 1 ? '' : 's'), cardArr.slice(2).join('')) : '');
    $('req-body').innerHTML = banner + cards;
  }
  // Requests that ended without a seat: kept out of the Home card; shown small at the bottom of the Riders list for 24 hours.
  function earlierRequests() {
    if (!user) return '';
    const reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const t0 = todayStr(), nowMs = Date.now();
    const gone = (x) => { const q = reqById[x.request_id]; return !q || q.active === false || (q.expires_at && Date.parse(q.expires_at) < nowMs); };
    const missed = matches.filter((x) => x.driver_id === user.id && x.ride_date >= t0 && ((x.status === 'requested' && gone(x) && fitServer[x.id] !== false) || x.status === 'declined' || (x.status === 'cancelled' && x.cancelled_by !== user.id)))
      .filter((x) => x.created_at && nowMs - Date.parse(x.created_at) < 24 * 3600 * 1000).sort((p, q) => Date.parse(q.created_at) - Date.parse(p.created_at)).slice(0, 6);
    if (!missed.length) return '';
    const outcome = (x) => x.status === 'declined' ? 'You declined' : x.status === 'cancelled' ? 'The rider cancelled' : 'Ended before you answered';
    return '<details class="card"><summary class="mut" style="cursor:pointer">Earlier requests (' + missed.length + ')</summary>' + missed.map((x) => { const q = reqById[x.request_id], t = vanMin(x.created_at);
      return '<div class="mut" style="padding:3px 0">' + nm(x.rider_id) + ' asked at ' + (t == null ? '' : clk(t)) + (q ? ' &middot; ' + esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) : '') + ' &middot; ' + outcome(x) + '</div>'; }).join('') + '</details>';
  }
  // The plan card has its own map (map-plan) that is never rebuilt, so it does not flicker when the page refreshes.
  function renderPlan() {
    const wrap = $('plan-wrap'); if (!wrap) return;
    const r = planData();
    if (!r) { wrap.classList.add('hide'); return; }
    wrap.classList.remove('hide'); $('plan-body').innerHTML = r.html;
    window.__ldStops = r.stops;
    const sig = routeSig(r.stops);
    if (mapSig.p !== sig) { mapSig.p = sig; window.RS_UI.drawMap('map-plan', r.stops, []); }
  }
  // Every scheduled trip, soonest first. Tap one to see its riders and plan.
  function tripsList() {
    if (myTrips.length < 2 || editing.trip || (pending && pending.kind === 'trip')) return '';
    const rows = myTrips.map((t) => {
      const nd = occOf(t, 1)[0] || t.trip_date, mine = matches.filter((x) => inFam(x.trip_id, t) && x.ride_date >= todayStr());
      const asks = mine.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length, acc = mine.filter((x) => x.status === 'accepted').length;
      const here = !myLiveTrip && myTrip && t.id === myTrip.id;
      return `<div class="item"><div><b>${esc(disp(t, 'origin'))}</b> to <b>${esc(disp(t, 'dest'))}</b><div class="mut">${tripWhen(t)}${acc ? ' &middot; ' + acc + ' accepted' : ''}${asks ? ' &middot; <b>' + asks + ' asking</b>' : ''}</div></div><div>${here ? '<span class="mut">Showing</span>' : '<button class="btn ghost" data-seltrip="' + t.id + '">Show</button>'}</div></div>`;
    }).join('');
    return card('My trips (' + myTrips.length + ')', fold('f-mytrips', myTrips.length + ' trips &middot; tap to show', rows));
  }
  // Home: the way out of everything at once (only shown when there is something upcoming)
  function cancelAllCard() {
    if (!user) return '';
    const t0 = todayStr(), any = myTrips.length || myLiveTrip || myReq || myLiveReq || matches.some((x) => (x.status === 'accepted' || x.status === 'requested') && !x.picked_up_at && x.ride_date >= t0 && (x.driver_id === user.id || x.rider_id === user.id));
    if (!any) return '';
    return card('Cancel all upcoming', '<p class="mut hint">Cancels all your upcoming trips, ride requests and booked rides in one go. Anyone booked with you is told and gets their points back. Your history stays.</p><p><button class="btn ghost" data-cancelall="1" style="color:var(--bad);border-color:var(--bad)">Cancel all my upcoming trips and rides</button></p>');
  }
  // The trip page: which day, the route, Start trip, and the ways to change or cancel. The plan, map, riders and requests follow below it.
  const confirmedDates = (t) => (user ? matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.status === 'accepted' && !x.dropped_off_at && x.ride_date >= todayStr()).length : 0);
  function tripHeader() {
    const t = curTrip; if (!t || !known(t)) return '';
    const dates = occOf(t, 7), d = viewD || dates[0] || todayStr(), ft = forDate(t, d), isToday = d === todayStr(), rep = !!(t.repeat_days && t.repeat_days.length) && !t.live, flex = isFlexFree(ft);
    const when = t.live ? 'Offering seats now' : RSD.label(d) + ' &middot; ' + (flex ? 'leave between ' + clk(ft.flex_from) + ' and ' + clk(ft.flex_to) : 'leave ' + clk(ft.depart_min));
    const dl0 = RSD.label(d), dlw = /^(Today|Tomorrow)$/.test(dl0) ? dl0.toLowerCase() : dl0;
    const confOnDate = matches.some((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.ride_date === d && x.status === 'accepted' && !x.dropped_off_at);
    const dayBtns = (rep || ft.changed_day) && CDOK && !confOnDate ? '<button class="btn ghost" data-editday="' + t.id + '|' + d + '">Change this date</button>' : '';
    const backBtn = ft.changed_day && CDOK && !confOnDate ? '<button class="btn ghost" data-restoreday="' + ft.id + '">Put back to the repeating trip</button>' : '';
    const changes = '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px"><button class="btn ghost" data-edittrip="' + t.id + '">Edit</button>' + dayBtns + backBtn + (rep && RPOK ? '<button class="btn ghost" data-skipday="' + t.id + '|' + d + '">Skip ' + esc(dlw) + '</button>' : '') + '<button class="btn ghost" data-reset="trip" data-tid="' + t.id + '">' + (rep ? 'Stop repeating trip' : 'Cancel trip') + '</button></div>';
    return card(when, '<p><b>' + esc(disp(t, 'origin')) + '</b> to <b>' + esc(disp(t, 'dest')) + '</b></p>' + (rep ? '<p class="mut">Repeats ' + esc(RSD.repeatLabel(t.repeat_days, t.repeat_every, t.repeat_nth)) + untilTxt(t.repeat_until) + '</p>' : '') + (flex ? '<p class="mut">Waiting for your first rider to set the time.</p>' : '')
      + (isToday && !t.live ? '<p><button class="btn" data-startnav="1" style="width:100%;padding:14px;font-size:17px">Start trip</button></p>' : '') + fold('f-trip-change', 'Change or cancel', (confirmedDates(t) ? '<p class="mut">Riders are confirmed on ' + confirmedDates(t) + (confirmedDates(t) === 1 ? ' date' : ' dates') + ', so the whole repeating trip can no longer be changed.' + (CDOK ? ' You can still change a single date that has no confirmed rider (Change this date).' : '') + ' To change all of it, cancel the trip (the riders are told and get their points back) and create a new one.</p>' : '') + (confOnDate ? '<p class="mut">A rider is confirmed on this date, so this date cannot be changed. Cancel it (Skip) first.</p>' : '') + changes));
  }
  // Home: the next trip (Driving) or the next ride (Riding), only when there is one. Details are one tap away.
  function homeItems() {
    if (!user) return [];
    const t0 = todayStr(), items = [];
    [myLiveTrip, ...myTrips].filter(Boolean).forEach((t) => {
      (t.live ? [t0] : occOf(t, 14)).forEach((d) => {
        if (d < t0) return;
        const ft = forDate(t, d), ms = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.ride_date === d);
        items.push({ kind: 'drive', t, d, ft, acc: ms.filter((x) => x.status === 'accepted').length, time: t.live ? t.depart_min : (isFlexFree(ft) ? ft.flex_from : ft.depart_min) });
      });
    });
    matches.filter((x) => x.rider_id === user.id && (x.status === 'accepted' || x.status === 'requested') && x.ride_date >= t0 && !x.dropped_off_at).forEach((x) => {
      const tr = tripBy(x.trip_id), pm = tr ? pickMin(x, tr) : null; items.push({ kind: 'ride', x, tr, d: x.ride_date, time: pm == null ? 0 : pm });
    });
    if (myReq && !myReq.live) occOf(myReq, 14).forEach((d) => { if (d >= t0 && !matches.some((x) => x.request_id === myReq.id && x.ride_date === d && (x.status === 'accepted' || x.status === 'requested'))) items.push({ kind: 'looking', q: myReq, d, time: myReq.ready_from }); });
    if (myLiveReq) items.push({ kind: 'looking', q: myLiveReq, d: t0, time: 0, live: true });
    items.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.time - b.time));
    return items;
  }
  function heroHtml(it) {
    const t0 = todayStr(), route = (a, b) => '<b>' + esc(a) + '</b> to <b>' + esc(b) + '</b>';
    if (it.kind === 'drive') {
      const when = it.t.live ? 'Offering seats now' : RSD.label(it.d) + ' &middot; ' + (isFlexFree(it.ft) ? 'leave between ' + clk(it.ft.flex_from) + ' and ' + clk(it.ft.flex_to) : 'leave ' + clk(it.ft.depart_min));
      return card('Next trip', '<p style="font-size:18px"><b>' + when + '</b></p><p>' + route(disp(it.t, 'origin'), disp(it.t, 'dest')) + '</p><p class="mut">' + (it.acc ? it.acc + (it.acc === 1 ? ' rider confirmed' : ' riders confirmed') : 'No riders yet') + '</p>'
        + (it.d === t0 && !it.t.live ? '<p><button class="btn" data-starttrip="' + it.t.id + '|' + it.d + '" style="width:100%;padding:14px;font-size:17px">Start trip</button></p>' : '') + '<p><button class="btn ghost" data-opentrip="' + it.t.id + '|' + it.d + '" style="width:100%">View details</button></p>');
    }
    const q = it.kind === 'looking' ? it.q : (myReq && it.x.request_id === myReq.id ? myReq : null);
    const rt = q ? route(disp(q, 'pickup'), disp(q, 'dropoff')) : (it.tr ? route(disp(it.tr, 'origin'), disp(it.tr, 'dest')) : '');
    const when = it.kind === 'ride' ? RSD.label(it.d) + (it.time ? ' &middot; pickup ' + clk(it.time) : '') : (it.live ? 'Looking for a ride now' : RSD.label(it.d) + ' &middot; ready ' + clk(it.q.ready_from));
    const st = it.kind === 'ride' ? (it.x.status === 'accepted' ? STEP_LABEL[stageOf(it.x)] : 'Waiting for the driver to accept') : 'Looking for a driver';
    return card('Next ride', '<p style="font-size:18px"><b>' + when + '</b></p><p>' + rt + '</p><p class="mut">' + (it.kind === 'ride' ? 'Driver ' + esc(nm(it.x.driver_id)) + ' &middot; ' + esc(st) : st) + '</p><p><button class="btn ghost" data-openride="' + it.d + '" style="width:100%">View ride</button></p>');
  }
  const driveHero = () => { const it = homeItems().find((i) => i.kind === 'drive'); return it ? heroHtml(it) : ''; };
  const rideHero = () => { const it = homeItems().find((i) => i.kind !== 'drive'); return it ? heroHtml(it) : ''; };
  function backBar() { return '<div style="margin:2px 0 10px"><button class="btn ghost" data-homeback="1" style="padding:8px 14px;min-height:0">&lsaquo; ' + (detailFrom === 'trips' ? 'Trips' : 'Home') + '</button></div>'; }
  function tripRequests() {
    const t = curTrip; if (!t || !user) return '';
    const live = (x) => { const q = [...otherReqs, ...extraReqs].find((r) => r.id === x.request_id); return !!q && q.active !== false && !(q.expires_at && Date.parse(q.expires_at) < Date.now()); };
    const asks = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.status === 'requested' && x.ride_date >= todayStr() && fitServer[x.id] !== false && live(x)).sort((a, b) => (a.ride_date < b.ride_date ? -1 : a.ride_date > b.ride_date ? 1 : 0));
    if (!asks.length) return '';
    return card('Seat requests (' + asks.length + ')', asks.map((x) => requestCard(x, true)).join(''));
  }
  function driverTop() { return hv() === 'classic' ? tripsList() + driverTopOne() + cancelAllCard() : hv() === 'trip' ? tripHeader() + tripRequests() : hv() === 'feed' ? noticeBanner() + driveHero() : ''; }
  function driverTopOne() {
    if (!curTrip || !known(curTrip) || curTrip.live) return '';
    if (false) return card('Start here', `<p><b>1.</b> Fill in the form below: where you drive from and to, the date and time.</p><p><b>2.</b> Tap <b>Review trip</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Riders who ask for a seat will appear on this page for you to accept.</p><p>${goTo('ld-form')}Go to the form</button></p>`);
    const dates = occOf(curTrip, 7), d = pickView(viewD, dates);
    const mine = d ? matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, curTrip) && x.ride_date === d) : [];
    const asks = mine.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length, acc = mine.filter((x) => x.status === 'accepted').length;
    const isToday = d === todayStr();
    const line = asks ? `<b>${asks} rider${asks > 1 ? 's' : ''} asked for a seat.</b> Tap <b>See riders</b> to accept.` : acc ? `<b>${acc} rider${acc > 1 ? 's' : ''} accepted.</b> ${isToday ? 'Tap <b>Start trip</b> when you set off.' : 'You can start on the day of the trip.'}` : 'No riders yet. They will show up here when they ask for a seat.';
    return card('Your trip', `<p><b>${esc(disp(curTrip, 'origin'))}</b> to <b>${esc(disp(curTrip, 'dest'))}</b></p><p class="mut">${tripWhen(curTrip)}</p><p>${line}</p>
      <div class="row2">${isToday ? '<button class="btn" data-startnav="1">Start trip</button> ' : ''}${goTo(asks ? 'seat-requests' : acc ? (isToday ? 'plan-wrap' : 'riding-with-me') : 'ld-lists')}See riders</button> <button class="btn ghost" data-edit="trip">Edit trip</button> <button class="btn ghost" data-reset="trip">Cancel this trip</button></div>`);
  }
  // Days of my regular request that have no driver any more (the driver cancelled, or I ended the booking). The rider chooses the new driver.
  function lostRides() {
    if (!user || !myReq || myReq.live) return [];
    return occOf(myReq, 7).filter((ds) => {
      const ms = matches.filter((x) => x.rider_id === user.id && x.request_id === myReq.id && x.ride_date === ds);
      if (!ms.length || ms.some((x) => ['requested', 'accepted', 'completed'].includes(x.status))) return false;
      return ms.some((x) => x.status === 'cancelled' && (x.cancelled_by !== user.id || offSet.has(rootId(x.trip_id) + '|' + x.request_id)));
    });
  }
  function lostBanner() {
    const l = lostRides();
    if (!l.length) return '';
    return card('Needs a new driver', '<p>' + (l.length === 1 ? 'Your ride on <b>' + esc(RSD.label(l[0])) + '</b> has no driver.' : 'These days have no driver: <b>' + l.map((d) => esc(RSD.label(d))).join(', ') + '</b>.') + ' Nobody is booked for you without your OK.</p><p>' + l.slice(0, 3).map((d) => '<button class="btn" data-lostgo="' + d + '">Find a driver for ' + esc(RSD.label(d)) + '</button>').join(' ') + '</p>');
  }
  // What was cancelled, when, the route and the points returned. Shown at the top of Home until it is dismissed.
  function noticeBanner() {
    if (!user || !notices.length) return '';
    const show = notices.slice(0, 3), more = notices.length - show.length;
    return card('Update', show.map((n) => '<div style="padding:6px 0;border-top:1px solid var(--line)"><b>' + esc(n.title) + '</b><div>' + esc(n.body) + '</div><div style="margin-top:6px"><button class="btn ghost" data-notice-read="' + n.id + '">OK</button>' + (n.kind === 'ride_cancelled_by_driver' ? ' <button class="btn" data-askride="1">Find another ride</button>' : '') + '</div></div>').join('') + (more > 0 ? '<p class="mut">' + more + ' more</p>' : '') + (notices.length > 1 ? '<p><button class="btn ghost" data-notice-read="all">OK to all</button></p>' : ''));
  }
  function riderTop() { return hv() === 'classic' ? lostBanner() + riderTopOne() + cancelAllCard() : hv() === 'ride' ? lostBanner() + riderTopOne() : hv() === 'feed' ? noticeBanner() + lostBanner() + rideHero() : ''; }
  function riderTopOne() {
    if (!curReq || !known(curReq)) return '';
    if (false) return card('Start here', `<p><b>1.</b> Fill in the form below: where you want to be picked up and dropped off, the date and when you are ready.</p><p><b>2.</b> Tap <b>Review request</b>, then <b>Confirm and post</b>.</p><p><b>3.</b> Pick a driver from the list and tap <b>Request</b>.</p><p>${goTo('lr-form')}Go to the form</button></p>`);
    const dates = occOf(curReq, 7), d = pickView(viewR, dates);
    const mine = d ? matches.filter((x) => x.rider_id === user.id && x.request_id === curReq.id && x.ride_date === d) : [];
    const acc = mine.find((x) => x.status === 'accepted' || x.status === 'completed'), pend = mine.some((x) => x.status === 'requested');
    const line = acc ? `<b>${esc(STEP_LABEL[stageOf(acc)])}.</b> Tap <b>See my ride</b> for live updates.` : pend ? 'You asked a driver for a seat. Waiting for them to accept. Nothing is confirmed yet.' : 'No driver has been asked yet. Posting your request does not reserve a seat. Pick a driver below and tap <b>Request</b>.';
    return card(acc ? 'Seat confirmed' : pend ? 'Seat requested' : 'Looking for a ride', `<p><b>${esc(disp(curReq, 'pickup'))}</b> to <b>${esc(disp(curReq, 'dropoff'))}</b></p><p class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${clk(curReq.ready_from)} to ${clk(curReq.ready_to)}</p><p>${line}</p>
      <div class="row2">${goTo('lr-lists')}${acc ? 'See my ride' : 'See drivers'}</button> <button class="btn ghost" data-edit="req">Edit request</button> <button class="btn ghost" data-offreq="${curReq.id}">Cancel this request</button></div>`);
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
  // The exact places a rider just chose (only places picked this time, never an old rounded point), saved privately for the driver of a booked ride
  const plExact = (idP, idD) => { const a = PL[idP], b = PL[idD], ok = (p) => p && !p.isArea && p.full && p.lat != null; return { p_pickup_label: ok(a) ? a.full : null, p_pickup_lat: ok(a) ? a.lat : null, p_pickup_lng: ok(a) ? a.lng : null, p_dropoff_label: ok(b) ? b.full : null, p_dropoff_lat: ok(b) ? b.lat : null, p_dropoff_lng: ok(b) ? b.lng : null }; };
  const saveExact = async (reqId, ex) => { if (!PLOK || !reqId || !ex || (ex.p_pickup_lat == null && ex.p_dropoff_lat == null)) return; try { await sb.rpc('save_exact_places', Object.assign({ p_request: reqId }, ex)); } catch (e) { /* older database: only the rounded place is kept */ } };
  const plNeed = (id, what) => (!PLOK ? 'Address search is not ready yet. Tap Try again.' : (!PL[id] ? 'Choose ' + what + ' from the suggestions (or tap Use my location)' : ''));
  const samePlace = (a, b, ia, ib) => a === b && !(PL[ia] && PL[ib] && !PL[ia].isArea && !PL[ib].isArea && RS.haversineKm(PL[ia], PL[ib]) > 0.3);
  async function setCols(table, id, ...cols) { if (PLOK && id) { const patchRow = Object.assign({}, ...cols); const r = await sb.from(table).update(patchRow).eq('id', id); if (r.error) throw r.error; } }
  const LOCBTN = { 'ln-o': 'ln-loc', 'rn-p': 'rn-loc' };
  function placeField(id, label, row, k, area) {
    if (!PLOK) return `<label>${label}</label><div><input type="text" id="${id}-q" disabled placeholder="Address search is starting..." style="${INPUT}"><select id="${id}" style="display:none">${opts(area)}</select><div class="pfrow">${LOCBTN[id] ? `<button type="button" class="btn ghost" id="${LOCBTN[id]}" disabled>Use my location</button>` : ''}<button type="button" class="btn ghost" data-plretry="1">Try again</button></div></div>`;
    if (PL[id] === undefined) PL[id] = row && row[k] ? (row[k + '_lat'] != null ? { label: row[k + '_label'] || row[k], lat: +row[k + '_lat'], lng: +row[k + '_lng'], area: row[k] } : { label: row[k], area: row[k], isArea: true }) : null;
    const p = PL[id], a = p ? p.area : area;
    return `<label>${label}</label><div data-pf="${id}"><input type="text" id="${id}-q" autocomplete="off" placeholder="Type an address or place" value="${esc(p ? p.label : '')}" style="${INPUT}"><div class="pfsug" id="${id}-sug"></div>
      <div class="pfrow"><button type="button" class="btn ghost" data-ploc="${id}">Use my location</button></div>
      <div class="mut" id="${id}-note" style="font-size:12px;margin-top:4px">${p && !p.isArea ? 'Neighbourhood: ' + esc(a) + (p.acc ? ' &middot; GPS accurate to about ' + p.acc + ' m' + (p.acc > 50 ? ' (weak signal: step outside or by a window and try again)' : '') : '') : ''}</div>
      <select id="${id}" style="display:none;margin-top:6px">${opts(a)}</select></div>`;
  }
  const PL_PAIRS = [['ln-o', 'ln-d'], ['lt-o', 'lt-d'], ['rn-p', 'rn-d'], ['lr-p', 'lr-d']];
  function wirePlaces() {
    PL_PAIRS.forEach(([a, b]) => {
      const A = document.querySelector('[data-pf="' + a + '"]'), B = document.querySelector('[data-pf="' + b + '"]');
      if (!A || !B || document.querySelector('[data-pswap="' + a + '|' + b + '"]')) return;
      const lab = B.previousElementSibling; if (!lab) return;
      const row = document.createElement('div'); row.style.cssText = 'text-align:center;margin:2px 0 4px';
      row.innerHTML = '<button type="button" class="btn ghost" data-pswap="' + a + '|' + b + '" style="padding:6px 14px;min-height:0">\u21c5 Swap the two places</button>';
      lab.parentNode.insertBefore(row, lab);
      row.firstChild.onclick = () => { const pa = PL[a], pb = PL[b]; PL[a] = pb === undefined ? null : pb; PL[b] = pa === undefined ? null : pa; formSig = ''; render(); };
    });
    document.querySelectorAll('[data-plretry]').forEach((b) => { b.onclick = () => { PLOK = null; formSig = ''; loadAll(); }; });
    document.querySelectorAll('[data-pf]').forEach((box) => {
      const id = box.dataset.pf, q = $(id + '-q'), sug = $(id + '-sug'), sel = $(id), note = $(id + '-note');
      let seq = 0, tm = null, list = [];
      const setP = (p) => { PL[id] = p; sel.value = p.area; nowSel[id] = p.area; q.value = p.label; note.textContent = p.isArea ? '' : (p.addr ? 'Exact spot: ' + p.addr + ' \u00b7 ' : '') + 'Neighbourhood: ' + p.area + (p.acc ? ' \u00b7 GPS accurate to about ' + p.acc + ' m' + (p.acc > 50 ? ' (weak signal: step outside or by a window and try again)' : '') : ''); sug.innerHTML = ''; };
      // Near a known neighbourhood (Metro Vancouver): use it. Anywhere else in Canada or the USA: name the place after its town or city.
      const covered = (lat, lng, city) => {
        const n = nearestArea(lat, lng); if (n.km <= 15) return n;
        if (city) { registerArea(city, lat, lng); return { a: city, km: 0 }; }
        if (n.km <= 40) return n;
        note.textContent = 'Could not tell which town that is. Try another spot nearby.'; return null;
      };
      q.oninput = () => {
        PL[id] = null; note.textContent = ''; clearTimeout(tm);
        const v = q.value.trim(); if (v.length < 3) { sug.innerHTML = ''; return; }
        tm = setTimeout(async () => {
          const my = ++seq, r = await window.RS_PLACES.suggest(v); if (my !== seq) return;
          if (!window.RS_PLACES.available()) { note.textContent = 'Address search is not working right now. Check your connection and try again.'; return; }
          list = r;
          sug.innerHTML = r.length ? r.map((s, i) => '<button type="button" data-i="' + i + '">' + esc(s.main) + '<span>' + esc(s.sub) + '</span></button>').join('') : '';
          sug.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
            const s = list[+b.dataset.i]; note.textContent = 'Finding that place...';
            try { const d = await window.RS_PLACES.details(s.id), n = covered(d.lat, d.lng, d.city ? d.city + (d.region ? ' (' + d.region + ')' : '') : ''); if (n) setP({ label: s.main, full: s.main + (s.sub ? ', ' + s.sub : ''), addr: d.addr, lat: d.lat, lng: d.lng, area: n.a }); }
            catch (e) { note.textContent = 'Could not load that place. Try again.'; }
          }));
        }, 250);
      };
      box.querySelector('[data-ploc]').onclick = () => {
        if (!navigator.geolocation) { note.textContent = 'This device cannot share its location'; return; }
        // Wait up to 12 s for a good GPS fix (30 m or better) instead of taking the first, rough one.
        let best = null, done = false, watchId = null, timer = null;
        note.textContent = 'Finding you...';
        const finish = async () => {
          if (done) return; done = true; navigator.geolocation.clearWatch(watchId); clearTimeout(timer);
          if (!best) { note.textContent = 'Could not find your location'; return; }
          note.textContent = 'Finding the address...';
          const addr = await window.RS_PLACES.where(best.latitude, best.longitude), acc = Math.round(best.accuracy);
          const n = covered(best.latitude, best.longitude, (addr.split(',')[1] || '').trim()); if (!n) return;
          setP({ label: addr || 'My location', full: addr || '', lat: best.latitude, lng: best.longitude, area: n.a, acc });
        };
        watchId = navigator.geolocation.watchPosition((pos) => {
          if (!best || pos.coords.accuracy < best.accuracy) best = pos.coords;
          note.textContent = 'Finding you... accurate to about ' + Math.round(best.accuracy) + ' m';
          if (best.accuracy <= 30) finish();
        }, (e) => { if (done) return; done = true; clearTimeout(timer); navigator.geolocation.clearWatch(watchId); note.textContent = e && e.code === 1 ? 'Location is blocked. Allow it in your settings.' : 'Could not find your location'; },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        timer = setTimeout(finish, 12000);
      };
      sel.onchange = () => setP({ label: sel.value, area: sel.value, isArea: true });
    });
  }

  // ---------- Leave now (driver) and I need a ride now (rider) ----------
  // A town or city outside the built-in list: remember it by name so it can be shown in the pickers and on saved trips.
  function registerArea(name, lat, lng) { if (!name || LOC[name]) return; LOC[name] = { lat, lng }; areas.push(name); document.querySelectorAll('select[id="ln-o"], select[id="ln-d"], select[id="rn-p"], select[id="rn-d"]').forEach((sl) => { if (![...sl.options].some((o) => o.value === name)) sl.add(new Option(name, name)); }); }
  const nearestArea = (lat, lng) => areas.map((a) => ({ a, km: RS.haversineKm({ lat, lng }, LOC[a]) })).sort((x, y) => x.km - y.km)[0];
  const minsLeft = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
  function driverNow() {
    const share = sharingCard() + driveCard();
    if (hv() === 'trip') return share;
    if (hv() === 'post' || hv() === 'ride') return '';
    if (myLiveTrip) return share + card('Where are you driving?', `<p><b>${esc(disp(myLiveTrip, 'origin'))}</b> to <b>${esc(disp(myLiveTrip, 'dest'))}</b></p><p class="mut" style="margin-top:-6px">Leaving about ${clk(myLiveTrip.depart_min)}</p><div class="swrow"><div><b>Offering seats to riders</b><div class="mut">Riders along your route can ask for a seat until you switch this off.</div></div><label class="sw"><input type="checkbox" checked id="ln-sw-off"><span></span></label></div>`);
    const o = nowSel['ln-o'] || (myTrip && myTrip.origin) || 'Surrey Central', d = nowSel['ln-d'] || (myTrip && myTrip.dest) || 'BCIT / Willingdon (Burnaby)';
    if (!myTrip || hv() === 'feed') {   // on Home the form is always open, even when a trip is already posted
      if (editing.trip || (pending && pending.kind === 'trip')) return share;   // the full form or the confirm card is showing
      const sx = S_(), seg = (m, label) => '<button type="button" class="btn' + (tripMode === m ? '' : ' ghost') + '" data-tmode="' + m + '" style="flex:1;min-width:0">' + label + '</button>';
      const val = (id, dflt) => esc(LV[id] != null ? LV[id] : dflt);
      const later = whenBox('ln', '<input type="date" id="ln-date" min="' + todayStr() + '" max="' + maxDate() + '" value="' + val('ln-date', defaultDate('', 450)) + '">', val('ln-t', '07:30'), !!LV['ln-flex'], null, LV['ln-t2'] == null ? null : hm(LV['ln-t2']), LV['ln-mode'], false)
        + repeatBox('ln', { repeat_days: LV.days || [] })
        + '<details style="margin-top:12px"><summary class="mut" style="cursor:pointer">More options (rider limits, payment)</summary>'
        + (AAOK ? '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="ln-auto"' + ((LV['ln-auto'] != null ? LV['ln-auto'] === '1' : sx.d_auto_accept) ? ' checked' : '') + '> Accept riders automatically: anyone who fits my limits, until the car is full</label>' : '')
        + '<label>Most riders I will take</label><select id="ln-pk">' + [1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === +(LV['ln-pk'] != null ? LV['ln-pk'] : Math.min(4, sx.d_seats)) ? ' selected' : '') + '>' + (n === 1 ? 'Just 1 rider' : 'Up to ' + n) + '</option>').join('') + '</select>'
        + '<label>Extra minutes I accept for my whole trip</label><input type="number" id="ln-dt" min="0" max="60" value="' + val('ln-dt', sx.d_detour) + '">'
        + (DKOK ? '<label>Extra km I accept for my whole trip (optional)</label><input type="number" id="ln-dk" min="0" max="200" step="0.5" placeholder="no limit" value="' + val('ln-dk', sx.d_detour_km == null ? '' : sx.d_detour_km) + '">' : '')
        + '<label>Payment I accept</label><select id="ln-a">' + [['either', 'Points or cash'], ['points', 'Points only'], ['cash', 'Cash gas-share only']].map(([v, l]) => '<option value="' + v + '"' + (v === (LV['ln-a'] || sx.d_accepts) ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></details>'
        + '<div style="margin-top:12px"><button class="btn" id="ln-review" style="width:100%;padding:12px;font-size:16px">Review trip</button></div>';
      const now = '<p class="mut hint" data-once="leave-now" style="margin:12px 0 0">Riders along your route can ask for a seat, and you get a phone alert for each one. You can switch this off any time.</p><div style="margin-top:12px"><button class="btn" id="ln-nav" style="width:100%;padding:14px;font-size:17px">Leave now</button></div><div style="margin-top:8px;text-align:center"><button class="btn ghost" data-tmode="later">Plan a trip for later instead</button></div>';
      return share + card('Create a new trip', placeField('ln-o', 'From', null, 'origin', o) + placeField('ln-d', 'To', null, 'dest', d)
        + (tripMode === 'later' ? '<p class="mut" style="margin:12px 0 0">Plan a trip for later. <button class="btn ghost" data-tmode="now" style="padding:4px 10px">Leave now instead</button></p>' + later : now) + '<p class="warn" id="ln-msg" role="alert"></p>');
    }
    if (!offerOpen && hv() === 'classic') return share + card('Driving', '<div class="row2"><button class="btn" data-offeropen="1">Offer a ride now</button> <button class="btn ghost" data-newtrip="1">Post a trip</button></div>');
    return share + card('Offer a ride now', `<p class="mut hint" data-once="offer-now">For a spur-of-the-moment drive: no date or time. Switch it on and riders along your route can ask for a seat. You get a phone alert for each request, even before you leave. It stays on until you switch it off (or after 12 hours). Already posted a trip? Use <b>Start trip</b> instead.</p>
      ${placeField('ln-o', 'From', myTrip, 'origin', o)}
      ${placeField('ln-d', 'To', myTrip, 'dest', d)}
      <div style="margin-top:10px"><button class="btn" id="ln-go" style="width:100%;padding:12px;font-size:16px">Offer a ride now</button> <button class="btn ghost" data-offerclose="1" style="width:100%;margin-top:8px">Close</button></div><p class="warn" id="ln-msg" role="alert"></p>`);
  }
  const rideToggle = () => '<div style="display:flex;gap:8px;margin:0 0 12px">' + [['now', 'Now'], ['later', 'Schedule']].map(([m, l]) => '<button type="button" class="btn' + (rideMode === m ? '' : ' ghost') + '" data-rmode="' + m + '" style="flex:1;min-width:0">' + l + '</button>').join('') + '</div>';
  function riderNow() {
    { const v = hv(); if (v !== 'classic' && v !== 'feed' && !(v === 'ride' && myLiveReq)) return ''; }
    if (myLiveReq) return card('You are looking for a ride now', `<p><b>${esc(disp(myLiveReq, 'pickup'))}</b> to <b>${esc(disp(myLiveReq, 'dropoff'))}</b></p><p class="mut">Visible to drivers for ${minsLeft(myLiveReq.expires_at)} more minutes.</p><p><button class="btn ghost" data-stoplive="req">Stop</button></p>`);
    if (rideMode === 'later') return '';
    const p = nowSel['rn-p'] || (myReq && myReq.pickup) || 'Whalley (Surrey)', d = nowSel['rn-d'] || (myReq && myReq.dropoff) || 'Brentwood (Burnaby)', pay = nowSel['rn-pay'] || 'points';
    return card('Ask for a ride', `${rideToggle()}<p class="mut hint">Leaving now. Your request stays visible to matching drivers for 20 minutes.</p>
      ${placeField('rn-p', 'Pick me up at', myReq, 'pickup', p)}
      ${placeField('rn-d', 'Drop me at', myReq, 'dropoff', d)}
      <label>I'll pay with</label><select id="rn-pay"><option value="points" ${pay === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${pay === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${pay === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="rn-go" style="width:100%;padding:12px;font-size:16px">Request a ride now</button></div><p class="warn" id="rn-msg" role="alert"></p>`);
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
    return card('Your drives', rows + '<p class="mut hint">Time includes pickups and waiting. Distance is counted while your phone shares its location during a ride.</p>');
  };
  const rideStats = (m) => (m.picked_up_at && m.dropped_off_at ? '<p>Your ride: ' + fmtMin((Date.parse(m.dropped_off_at) - Date.parse(m.picked_up_at)) / 60000) + (+m.ride_km > 0 ? ' &middot; ' + (+m.ride_km).toFixed(1) + ' km' : '') + '</p>' : '');
  // Test tools (only for accounts listed in test_accounts): a made-up rider asks for a seat on my latest trip, now or after a delay.
  const testBtns = () => (false && isTest ? '<p class="mut">Test tools (only you see this)' + (testMode ? ': <b>Test mode is ON</b>, a made-up rider will ask for a seat about every 2 minutes.' : ':') + '</p><p><button class="btn ghost" data-testsend="30">Test request in 30 s</button> <button class="btn ghost" data-testsend="0">Test request now</button></p>' : '');
  const driveCard = () => (user && driveSession && !shouldShare() ? `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px"><span><b>Alerts are on.</b> <span class="mut">You get a phone alert when a rider asks for a seat.</span></span><button class="btn ghost" data-stopdrive="1">Turn off</button></div>` : '');
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
  function sharingInner() { if (!shareState.err && nativeLoc()) return `<p>Riders on this ride can see you on their map, even while Google Maps is open.</p><p class="mut hint">Android shows a small "RideShare is sharing your location" notification while this is on. It stops by itself when the ride ends.</p>`; return shareState.err ? `<p class="warn">${esc(shareState.err)}</p>` : `<p>Riders on this ride can see you on their map. Last sent: ${ago(shareState.lastOk)}.</p><p class="mut hint">Keep this screen open. If you use Google Maps for directions, put RideShare and Google Maps side by side (split screen) so sharing keeps working.</p>`; }
  const sharingCard = () => (user && shouldShare() ? `<div class="card" id="share-card"><h2>Sharing your location</h2><div id="share-inner">${sharingInner()}</div></div>` : '');
  function paintSharing() { const e = $('share-inner'); if (e) e.innerHTML = sharingInner(); }

  // ---------- rider: where is my driver, and when will they arrive ----------
  window.__carPos = null;
  const applyCar = () => { try { window.RS_UI.setCar('map-lr', window.__carPos); } catch (e) {} };
  function trackInfo(m, t, meO) {
    const stg = stageOf(m), dn = nm(t.user_id), pos = positions[m.driver_id], pk = pickupMs(m);
    window.__carPos = null;
    let html = '';
    if (stg === 'accepted' && pk != null && !m.arrived_at && Date.now() >= pk + 15 * 60000) {
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
    if ((stg === 'accepted' || stg === 'on_my_way') && pk != null && !m.arrived_at) html = (Date.now() >= pk + 60000
      ? `<p class="warn"><b>${dn} is running late.</b> You can cancel for free if they have not arrived 15 minutes after ${clk(pickMin(m, t))}.</p>`
      : `<p><b>Be at the pickup spot by ${clk(pickMin(m, t))}.</b> <span class="mut">If you are not there, your driver may drive on.</span></p>`) + html;
    return html;
  }

  // ---------- driver tab ----------
  function driverForm() {
    if (!showsDrive('post') && !(hv() === 'feed' && pending && pending.kind === 'trip')) return '';
    if (pending && pending.kind === 'trip') {
      const r = pending.row, upd = myTrip && !editing.newTrip;
      return card('Confirm your trip', `<p><b>${esc(disp(r, 'origin'))}</b> to <b>${esc(disp(r, 'dest'))}</b></p><p>${tripWhen(r)}</p>${pending.note ? '<p class="mut">' + esc(pending.note) + '</p>' : ''}
        <p class="mut">${r.max_pickups === 1 ? 'One pickup only' : 'Up to ' + r.max_pickups + ' pickups'} &middot; max ${r.max_detour} extra min for one pickup${r.max_pickups > 1 && r.max_total_detour != null ? ' &middot; max ' + r.max_total_detour + ' extra min for all pickups together' : ''} &middot; accepts ${r.accepts === 'either' ? 'points or cash' : r.accepts === 'points' ? 'points only' : 'cash gas-share only'}${r.auto_accept ? ' &middot; accepts riders automatically' : ''}</p>
        <div style="margin-top:10px"><button class="btn" id="lt-confirm">${upd ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lt-back">Back</button></div>`);
    }
    if (myTrip && !editing.trip) return '';
    if (!myTrip && !myLiveTrip && !editing.trip) return '';
    if (myLiveTrip && !myTrip && !editing.trip) return card('Plan ahead', '<p class="mut">Want to drive on a set day and time? Post a scheduled trip.</p><p><button class="btn ghost" data-edit="trip">Post a scheduled trip</button></p>');
    const dayD = editing.dayOnly ? editing.dayOnly.d : null;
    const mt = dayD ? forDate(myTrip, dayD) : editing.newTrip ? null : myTrip;
    const t = mt || { origin: 'Surrey Central', dest: 'BCIT / Willingdon (Burnaby)', depart_min: 450, max_detour: S_().d_detour, max_total_detour: S_().d_total_detour, max_pickups: Math.min(4, S_().d_seats), max_wait: S_().d_wait, accepts: S_().d_accepts, trip_date: todayStr(), repeat_days: [] };
    const date = dayD || defaultDate(t.trip_date, t.depart_min);
    return card(dayD ? 'Change ' + RSD.label(dayD) + ' only' : mt ? 'My trip' : 'Post a trip', `${placeField('lt-o', 'From', mt, 'origin', t.origin)}${placeField('lt-d', 'To', mt, 'dest', t.dest)}
      ${whenBox('lt', dayD ? `<input type="date" id="lt-date" value="${date}" disabled>` : `<input type="date" id="lt-date" min="${todayStr()}" max="${maxDate()}" value="${date}">`, hmIn(t.flex_to != null && !t.flex_locked ? t.flex_from : t.depart_min), t.flex_to != null && !t.flex_locked, t.flex_from, t.flex_to, 'leave', !!t.flex_locked)}
      ${dayD ? '' : repeatBox('lt', t)}
      <label>Most riders I will take</label><select id="lt-pk">${[1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === (t.max_pickups || 1) ? ' selected' : '') + '>' + (n === 1 ? 'Just 1 rider' : 'Up to ' + n) + '</option>').join('')}</select>
      <label>Extra minutes I accept for my whole trip</label><input type="number" id="lt-dt" min="0" max="60" value="${t.max_detour}">
      ${DKOK ? `<label>Extra km I accept for my whole trip <span class="mut">(optional)</span></label><input type="number" id="lt-dk" min="0" max="200" step="0.5" placeholder="no limit" value="${t.max_detour_km == null ? '' : t.max_detour_km}">` : ''}
      <label>Payment I accept</label><select id="lt-a"><option value="either" ${t.accepts === 'either' ? 'selected' : ''}>Points or cash</option><option value="points" ${t.accepts === 'points' ? 'selected' : ''}>Points only</option><option value="cash" ${t.accepts === 'cash' ? 'selected' : ''}>Cash gas-share only</option></select>
      ${AAOK ? '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="lt-auto"' + ((t.auto_accept == null ? S_().d_auto_accept : t.auto_accept) ? ' checked' : '') + '> Accept riders automatically: anyone who fits my limits, until the car is full</label>' : ''}
      <div style="margin-top:10px"><button class="btn" id="lt-review">Review trip</button>${myTrip || myLiveTrip || editing.newTrip ? ' <button class="btn ghost" data-edit-off="trip">Cancel</button>' : ''}</div><p class="warn" id="lt-msg" role="alert"></p>`);
  }

  function driverLists() {
    // No trip: nothing to show. Hide the driver map (and the test preview card) so no old route is left behind.
    const showMap = !!curTrip && known(curTrip), mapEl = $('map-ld'), simEl = $('sim-ld');
    if (mapEl) mapEl.style.display = showMap ? '' : 'none';
    if (simEl && !showMap) simEl.style.display = 'none';
    if (!showMap) { mapSig.d = ''; window.__ldStops = []; window.__ldAcc = []; return ''; }
    const dates = occOf(curTrip, 7);
    viewD = pickView(viewD, dates);
    const dr = driverObj(curTrip, viewD), reqById = {}; [...otherReqs, ...extraReqs].forEach((q) => { reqById[q.id] = q; });
    const dateCard = card('Date', dateChips('ld-dates', dates, viewD) + `<p class="mut" style="margin-top:8px">${tripWhen(curTrip)}</p>`);
    if (!viewD) return dateCard;
    const mine = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, curTrip) && x.ride_date === viewD);
    const inc = mine.filter((x) => x.status === 'requested' && fitServer[x.id] !== false);
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
      ${DEV ? '<button class="btn ghost" id="ld-start">Preview route (watch the car)</button> <button class="btn ghost" id="ld-stop">Stop preview</button>' : ''}
      <p class="mut" style="margin-top:8px">${viewD === todayStr() ? 'When you set off, tap Start trip at the top. It opens Google Maps with your destination and your riders as stops, and tells your riders you are on the way.' : 'Start trip is available on the day of the trip.'}</p>`);
    const reqs = hv() === 'trip' ? '' : card('Seat requests', inc.length ? inc.map((x) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(x.rider_id)}</b>${badge(x.rider_id, 'rider')} <span class="mut">pays ${x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share'}</span>${detourLine(reqFit(x))}${leaveLine(x.id)}
        <div style="margin-top:6px"><button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button></div></div>`).join('') : '<p class="mut">None yet. Riders ask you for a seat; you accept here.</p>');
    const riding = card('Confirmed riders', acc.length ? acc.map((x) => { const q = reqById[x.request_id], ns = nextStep(x, esc(names[x.rider_id] || 'rider')), open = stepsOpen(x), link = mapsLink(x, q);
      return `<div style="padding:8px 0;border-top:1px solid var(--line)">${whoCard(x.rider_id, 'rider')}<div style="margin:4px 0"><span class="tag">${esc(STEP_LABEL[stageOf(x)])}</span>${x.rider_confirmed_at ? ' <span class="tag">rider confirmed</span>' : ''}</div><div class="mut">${x.pay_with === 'points' ? x.points + ' pts held until drop-off' : 'cash gas-share'}${q ? ' &middot; ' + esc(q.pickup) + ' to ' + esc(q.dropoff) : ''}</div>${leaveLine(x.id)}${meetLine(x)}
        <div style="margin-top:6px">${open ? `<button class="btn" data-step="${x.id}|${ns.step}">${ns.label}</button>` : '<span class="mut">Steps open 2 hours before pickup.</span>'} ${link && open ? `<a class="btn ghost" style="display:inline-block;text-decoration:none" href="${link}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''} ${canNoShow(x) ? `<button class="btn ghost" data-noshow="${x.id}">Rider isn't here</button>` : ''} ${msgButton(x)} ${PCOK ? `<button class="btn ghost" data-report="${x.id}|${x.rider_id}">Report a problem</button>` : ''}</div></div>`; }).join('') : '<p class="mut">No riders yet.</p>');
    const near = !found.length ? '' : card('Matching ride requests', found.map((m) => { const q = reqById[m.rider.id]; return `<div style="padding:6px 0;border-top:1px solid var(--line)"><b>${nm(q.user_id)}</b>${badge(q.user_id, 'rider')}${tagsFor(q.user_id, 'rider')}${q.live ? ' <span class="tag">needs a ride now</span>' : ''} <span class="mut">${esc(q.pickup)} to ${esc(q.dropoff)} &middot; +${Math.round(m.addedDetour)} min detour &middot; pick up ${clk(m.pickupAt)} &middot; drop ${clk(m.dropAt)}</span></div>`; }).join(''));
    return dateCard + summary + '<div id="seat-requests">' + reqs + '</div><div id="riding-with-me">' + riding + '</div>' + near + earlierRequests();
  }

  function drawDriverMap(stops, grey, date) {
    const sig = routeSig(stops) + grey.map((g) => g.id).join(',') + date;
    if (mapSig.d === sig) return; mapSig.d = sig;
    window.RS_UI.drawMap('map-ld', stops, grey.map((g) => ({ loc: g.pickup, label: g.name + ' (waiting)' })));
  }
  const routeSig = (stops) => stops.map((s) => s.loc.lat + ',' + s.loc.lng).join('|');

  // ---------- rider tab ----------
  function riderForm() {
    if (!showsDrive('feed', 'ask')) return '';
    if (pending && pending.kind === 'req') {
      const r = pending.row;
      return card('Confirm your request', `<p><b>${esc(disp(r, 'pickup'))}</b> to <b>${esc(disp(r, 'dropoff'))}</b></p><p>${RSD.label(r.ride_date)}, ready ${clk(r.ready_from)} to ${clk(r.ready_to)}${r.repeat_days.length ? ' &middot; repeats ' + RSD.repeatLabel(r.repeat_days, r.repeat_every, r.repeat_nth) + untilTxt(r.repeat_until) : ' &middot; one time'}</p>
        <p class="mut">Paying with ${r.pays === 'either' ? 'points or cash' : r.pays === 'points' ? 'points' : 'cash gas-share'}</p>
        <div style="margin-top:10px"><button class="btn" id="lr-confirm">${myReq ? 'Confirm and update' : 'Confirm and post'}</button> <button class="btn ghost" id="lr-back">Back</button></div>`);
    }
    if (myReq && !editing.req) return '';
    if (rideMode === 'now' && !myReq) return '';
    const r = myReq || { pickup: 'Whalley (Surrey)', dropoff: 'Brentwood (Burnaby)', ready_from: 440, ready_to: 470, pays: S_().r_pays, ride_date: todayStr(), repeat_days: [] };
    const date = defaultDate(r.ride_date, r.ready_from);
    return card(myReq ? 'My ride' : 'Schedule a ride', `${myReq ? '' : rideToggle()}${placeField('lr-p', 'Pick me up at', myReq, 'pickup', r.pickup)}${placeField('lr-d', 'Drop me at', myReq, 'dropoff', r.dropoff)}
      <label>Date</label><input type="date" id="lr-date" min="${todayStr()}" max="${maxDate()}" value="${date}">
      <div class="row"><div><label>Earliest pickup</label><input type="time" id="lr-f" value="${hmIn(r.ready_from)}"></div><div><label>Latest pickup</label><input type="time" id="lr-u" value="${hmIn(r.ready_to)}"></div></div>
      ${repeatBox('lr', r)}
      <label>I'll pay with</label><select id="lr-pay"><option value="points" ${r.pays === 'points' ? 'selected' : ''}>Points</option><option value="cash" ${r.pays === 'cash' ? 'selected' : ''}>Cash gas-share</option><option value="either" ${r.pays === 'either' ? 'selected' : ''}>Either</option></select>
      <div style="margin-top:10px"><button class="btn" id="lr-review">Review request</button>${myReq ? ' <button class="btn ghost" data-edit-off="req">Cancel</button>' : ''}</div><p class="warn" id="lr-msg" role="alert"></p>
      <div class="mut" style="margin-top:10px">Your points: <b>${me.points} pts</b></div>`);
  }

  function riderLists() {
    if (!curReq || !known(curReq)) return card('Drivers going your way', '<p class="mut">Ask for a ride on Home to see matching drivers.</p>');
    const dates = occOf(curReq, 7);
    viewR = pickView(viewR, dates);
    const dateCard = card('Date', dateChips('lr-dates', dates, viewR) + `<p class="mut" style="margin-top:8px">Ready ${clk(curReq.ready_from)} to ${clk(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatLabel(curReq.repeat_days, curReq.repeat_every, curReq.repeat_nth) + untilTxt(curReq.repeat_until) : ' &middot; one time'}</p>`);
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
      html += card('Your ride', `<div style="margin-bottom:8px">${whoCard(accepted.driver_id, 'driver')}${meetLine(accepted)}${msgButton(accepted) || meetButton(accepted) ? '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' + msgButton(accepted) + meetButton(accepted) + '</div>' : ''}</div><p>${live}</p>${trackInfo(accepted, accTrip, meO)}${rideStats(accepted)}<p class="mut">${esc(RSD.label(viewR))} &middot; ${accepted.pay_with === 'points' ? accepted.points + ' pts' + (stg === 'dropped_off' ? ' paid' : ' held until drop-off') : 'cash gas-share (settle with your driver)'}</p>${inCar}<p style="margin-top:8px"><button class="btn ghost" id="lr-watch">Preview route</button> <button class="btn ghost" id="lr-stop">Stop</button></p>${stg === 'accepted' || stg === 'on_my_way' ? '<p class="mut">Manage this booking in Trips.</p>' : ''}`);
    }
    let list = '';
    otherTrips.filter((t) => known(t) && tripOn(t, viewR)).forEach((t) => {
      const dr = driverObj(t, viewR);
      if (isFlexFree(t)) { const dep = flexDepart(t, dr, meO, viewR); if (dep == null) return; dr.departMin = dep; }
      const found = RS.findMatches(dr, [meO], []); if (!found.length) return;
      const m = found[0], dollars = RS.priceRoute(m.stops, dr.cpk).riderPay.get(meO) || 0, pts = RS.toPoints(dollars);
      const payWith = curReq.pays === 'either' ? (t.accepts === 'cash' ? 'cash' : 'points') : curReq.pays;
      if (!(t.accepts === 'either' || t.accepts === payWith)) return;
      const st = mine.find((x) => x.trip_id === t.id);
      const price = 'about ' + (payWith === 'points' ? pts + ' pts (' + RS.money(pts * RS.POINT_VALUE) + ')' : RS.money(dollars));
      const btn = st ? `<span class="tag">${esc(st.status === 'requested' ? 'seat requested' : statusText(st.status))}</span>${st.status === 'requested' ? ` <button class="btn ghost" data-can="${st.id}">Cancel</button>` : ''}` : `<button class="btn" data-req="${t.id}" data-rq="${curReq.id}" data-pay="${payWith}" data-pts="${pts}" data-date="${viewR}" data-dmin="${Math.max(0, m.addedDetour).toFixed(1)}" data-dkm="${Math.max(0, m.addedKm || 0).toFixed(1)}">Request &middot; ${price}</button>`;
      list += `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${nm(t.user_id)}</b>${badge(t.user_id, 'driver')}${scoreTag(t.user_id)}${tagsFor(t.user_id, 'driver')}${t.live ? ' <span class="tag">leaving now</span>' : ''} <span class="mut">leaves ${clk(dr.departMin)}${isFlexFree(t) ? ' (the driver is flexible: ' + clk(t.flex_from) + ' to ' + clk(t.flex_to) + ')' : ''} &middot; picks you up ${clk(m.pickupAt)} &middot; drops ${clk(m.dropAt)} &middot; adds ${Math.round(m.addedDetour)} min for them</span><div style="margin-top:6px">${btn}</div></div>`;
    });
    html += card('Drivers going your way on ' + esc(RSD.label(viewR)), (list ? '<p class="mut hint" style="margin:0 0 6px">These prices are estimates. When you ask for a seat, RideShare works out the final extra time and price itself, using live traffic. Your price goes down as more riders join.</p>' : '') + (list || '<p class="mut">No drivers match on this date. Check back soon.</p>'));
    const sig = routeSig(mapStops) + viewR; if (mapSig.r !== sig) { mapSig.r = sig; window.RS_UI.drawMap('map-lr', mapStops); }
    return html;
  }

  // ---------- upcoming tab ----------
  function upcomingMain() {
    const t0 = todayStr(), tripById = {}, reqById = {};
    [...otherTrips, ...extraTrips, ...myTrips].concat(curTrip ? [curTrip] : []).forEach((t) => { tripById[t.id] = t; });
    [...otherReqs, ...extraReqs].concat(curReq ? [curReq] : []).forEach((q) => { reqById[q.id] = q; });
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const passedT = (t) => !t.live && !(t.repeat_days && t.repeat_days.length) && (t.trip_date < t0 || (t.trip_date === t0 && (isFlexFree(t) ? t.flex_to : t.depart_min) + 60 < nowMin));
    const tripList = [myLiveTrip, ...myTrips].filter(Boolean).filter((t) => !passedT(t));
    // One trip: collapsed to its route and a short line; open it to see every date (tap a date to open that day) and the buttons.
    const tripRow = (t) => {
      const rep = !!(t.repeat_days && t.repeat_days.length) && !t.live, dates = t.live ? [] : occOf(t, 31), id = 'f-trip-' + t.id;
      const fam = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.ride_date >= t0);
      const asksAll = fam.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length;
      const rows = dates.map((d) => {
        const ms = fam.filter((x) => x.ride_date === d), acc = ms.filter((x) => x.status === 'accepted').length, ask = ms.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length, ft = forDate(t, d);
        const time = isFlexFree(ft) ? clk(ft.flex_from) + ' to ' + clk(ft.flex_to) : clk(ft.depart_min), tags = (acc ? acc + (acc === 1 ? ' rider' : ' riders') : '') + (ask ? (acc ? ' &middot; ' : '') + '<b>' + ask + ' asking</b>' : '');
        return '<button type="button" class="btn ghost" data-opentrip="' + t.id + '|' + d + '" style="width:100%;text-align:left;margin:3px 0;display:flex;justify-content:space-between;gap:8px"><span>' + esc(RSD.label(d)) + ' &middot; ' + time + '</span><span class="mut">' + tags + '</span></button>';
      }).join('');
      const sub = t.live ? 'Offering seats now &middot; started at ' + clk(t.depart_min) : rep ? 'Repeats ' + esc(RSD.repeatLabel(t.repeat_days, t.repeat_every, t.repeat_nth)) + untilTxt(t.repeat_until) + ' &middot; ' + dates.length + (dates.length === 1 ? ' date' : ' dates') : tripWhen(t);
      const buttons = '<div style="margin:6px 0;display:flex;flex-wrap:wrap;gap:8px"><button class="btn" data-opentrip="' + t.id + '|' + (t.live ? todayStr() : (dates[0] || t.trip_date)) + '">Open</button><button class="btn ghost" data-edittrip="' + t.id + '">Edit</button><button class="btn ghost" data-offtrip="' + t.id + '"' + (rep ? ' data-rep="1"' : '') + '>' + (rep ? 'Stop repeating trip' : 'Cancel trip') + '</button></div>';
      return '<details data-fold="' + id + '"' + (foldOpen.has(id) ? ' open' : '') + ' style="border-top:1px solid var(--line);padding:6px 0"><summary style="cursor:pointer;padding:4px 0"><b>' + esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')) + '</b><div class="mut">' + sub + (asksAll ? ' &middot; <b>' + asksAll + ' asking</b>' : '') + (t.auto_accept ? ' &middot; accepts automatically' : '') + '</div></summary>' + buttons + (rows ? '<div class="mut" style="margin:8px 0 2px">Dates (tap one to open it)</div>' + rows : '') + '</details>';
    };
    const dayItems = [];
    tripList.forEach((t) => {
      if (t.live) { dayItems.push({ t, d: t0, time: t.depart_min }); return; }
      occOf(t, 31).forEach((d) => { const ft = forDate(t, d); dayItems.push({ t, d, time: isFlexFree(ft) ? ft.flex_from : ft.depart_min }); });
    });
    dayItems.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.time - b.time));
    const dayStat = (it) => { const ms = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, it.t) && x.ride_date === it.d); return { acc: ms.filter((x) => x.status === 'accepted').length, ask: ms.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length }; };
    const dayRow = (it) => {
      const t = it.t, ft = forDate(t, it.d), { acc, ask } = dayStat(it);
      const when = t.live ? 'Offering seats now' : esc(RSD.label(it.d)) + ' &middot; ' + (isFlexFree(ft) ? clk(ft.flex_from) + ' to ' + clk(ft.flex_to) : clk(ft.depart_min));
      const tags = (acc ? acc + (acc === 1 ? ' rider' : ' riders') : '') + (ask ? (acc ? ' &middot; ' : '') + '<b>' + ask + ' asking</b>' : '');
      return '<button type="button" class="btn ghost" data-opentrip="' + t.id + '|' + it.d + '" style="width:100%;text-align:left;margin:3px 0;display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b><span class="tag">Driving</span> ' + (ft.changed_day ? '<span class="tag">changed</span> ' : '') + when + '</b><span class="mut">' + tags + '</span></div><div class="mut" style="font-size:13px;font-weight:400">' + esc(disp(ft, 'origin')) + ' to ' + esc(disp(ft, 'dest')) + '</div></button>';
    };
    const dayRows = dayItems.map(dayRow), SHOW = 10;
    const mineTrip = dayRows.slice(0, SHOW).join('') + (dayRows.length > SHOW ? fold('f-more-dates', 'Show ' + (dayRows.length - SHOW) + ' more dates', dayRows.slice(SHOW).join('')) : '')
      + '<div style="margin-top:10px">' + fold('f-manage-trips', 'My trips (' + tripList.length + '): edit or stop', tripList.map(tripRow).join('')) + '</div>';
    const mineReq = curReq ? `<div style="padding:6px 0"><b>${esc(disp(curReq, 'pickup'))} to ${esc(disp(curReq, 'dropoff'))}</b><div class="mut">${esc(RSD.label(curReq.ride_date))}, ready ${clk(curReq.ready_from)} to ${clk(curReq.ready_to)}${curReq.repeat_days.length ? ' &middot; repeats ' + RSD.repeatLabel(curReq.repeat_days, curReq.repeat_every, curReq.repeat_nth) : ' &middot; one time'}</div><div style="margin-top:6px"><button class="btn ghost" data-go="t-rider">Edit</button> <button class="btn ghost" data-offreq="${curReq.id}">Cancel my request</button></div></div>` : '<p class="mut">No ride requested. Use <b>I need a ride</b>.</p>';
    const live = matches.filter((x) => (x.status === 'requested' || x.status === 'accepted') && x.ride_date >= t0).sort((a, b) => (a.ride_date < b.ride_date ? -1 : 1));
    const asRider = live.filter((x) => x.rider_id === user.id), asDriver = live.filter((x) => x.driver_id === user.id && (x.status !== 'requested' || fitsOk(x)));
    const when = (x) => { const t = tripBy(x.trip_id); const pm = pickMin(x, t); return esc(RSD.label(x.ride_date)) + (pm != null ? ' at ' + clk(pm) : ''); };
    const isRegular = (x) => { const t0 = tripById[x.trip_id], tt = t0 && t0.series_parent ? (tripById[t0.series_parent] || t0) : t0, qq = reqById[x.request_id]; return x.status === 'accepted' && !!tt && !!qq && !!(tt.repeat_days && tt.repeat_days.length) && !!(qq.repeat_days && qq.repeat_days.length) && !offSet.has(rootId(x.trip_id) + '|' + x.request_id); };
    const row = (x, isRider) => {
      const other = isRider ? x.driver_id : x.rider_id, pay = x.pay_with === 'points' ? x.points + ' pts' : 'cash gas-share';
      let actions = '';
      if (askCancel === x.id) {
        const ci = cancelInfo(x);
        actions = `<div class="open" style="margin-top:6px">${esc(ci.text)}</div><div style="margin-top:6px">${ci.ok ? `<button class="btn" data-cancelgo="${x.id}">${isRider ? 'Yes, cancel ride' : 'Yes, cancel pickup'}</button> ` : ''}<button class="btn ghost" data-cancelno="1">${isRider ? 'Keep ride' : 'Keep pickup'}</button></div>`;
      } else {
        const b = [];
        if (!isRider && x.status === 'requested') b.push(`<button class="btn" data-acc="${x.id}">Accept</button> <button class="btn ghost" data-dec="${x.id}">Decline</button>`);
        if (canNoShow(x)) b.push(`<button class="btn ghost" data-noshow="${x.id}">Rider isn't here</button>`);
        if ((isRider || x.status === 'accepted') && !x.picked_up_at) b.push(`<button class="btn ghost" data-cancelask="${x.id}">${!isRider ? 'Cancel pickup' : x.status === 'requested' ? 'Cancel request' : 'Cancel ride'}</button>`);
        if (msgButton(x) && x.status === 'accepted') b.push(msgButton(x));
        if (isRider && meetButton(x)) b.push(meetButton(x));
        if (isRegular(x) && !x.picked_up_at) b.push(`<button class="btn ghost" data-stopseries="${x.trip_id}|${x.request_id}">End regular booking</button>`);
        if (x.status === 'accepted' && PCOK) b.push(`<button class="btn ghost" data-share="${x.id}">Share trip details</button>`, `<button class="btn ghost" data-report="${x.id}|${other}">Report a problem</button>`);
        actions = b.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${b.join(' ')}</div>` : '';
      }
      const held = x.status === 'accepted' && x.pay_with === 'points' && !x.settled ? ' (held until the ride)' : '';
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${when(x)}</b> <span class="tag">${esc(x.status === 'accepted' ? STEP_LABEL[stageOf(x)] : statusText(x.status))}</span>${isRegular(x) ? ' <span class="tag">regular</span>' : ''}${x.status === 'accepted' ? '<div style="margin:8px 0">' + whoCard(other, isRider ? 'driver' : 'rider') + '</div>' + meetLine(x) : ''}<div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(other)}${badge(other, isRider ? 'driver' : 'rider')} &middot; ${pay}${held}</div>${actions}</div>`;
    };
    const riderRows = asRider.length ? asRider.map((x) => row(x, true)).join('') : '<p class="mut">No upcoming rides.</p>';
    const driverRows = asDriver.length ? asDriver.map((x) => row(x, false)).join('') : '<p class="mut">No upcoming passengers.</p>';
    const past = matches.filter((x) => ['completed', 'cancelled', 'no_show', 'declined'].includes(x.status)).slice(0, 30);
    const pastRows = past.length ? past.slice(0, 8).map((x) => { const isRider = x.rider_id === user.id; return `<div style="padding:6px 0;border-top:1px solid var(--line)">${when(x)} <span class="tag">${esc(statusText(x.status))}</span><div class="mut">${isRider ? 'Driver' : 'Rider'} ${nm(isRider ? x.driver_id : x.rider_id)} &middot; ${x.pay_with === 'points' ? x.points + ' pts' : 'cash'}${x.refunded ? ' &middot; ' + x.refunded + ' pts returned' : ''}</div></div>`; }).join('') : '<p class="mut">Nothing yet.</p>';
    const policy = `<p class="mut hint">Points are held when a driver accepts a rider, and paid to the driver after the ride. Cash rides: no points move.</p>
      <p style="margin:10px 0 2px"><b>If you are the rider</b></p><ul class="mut" style="margin:4px 0 0 18px;padding:0"><li>Cancel more than 2 hours before pickup: you get all your points back.</li><li>Cancel within 2 hours: your first late cancel each month is free. After that, the driver keeps half of the points reserved for this ride.</li><li>You cannot cancel after the pickup time.</li></ul>
      <p style="margin:10px 0 2px"><b>If you are the driver</b></p><ul class="mut" style="margin:4px 0 0 18px;padding:0"><li>If you cancel a pickup, the rider gets all their points back.</li><li>If the rider is not at the pickup spot when you get there, tap Rider isn't here (not before their pickup time). The ride closes as a missed pickup and you keep the points.</li></ul>`;
    // Past trips: my finished trips (route, date, who rode, distance) and the rides I took as a rider
    const kmOf = (id) => drives.filter((d) => d.trip_id === id).reduce((a, d) => a + (+d.distance_km || 0), 0);
    const pastTripItems = pastTrips.filter((t) => (known(t) || t.origin) && (matches.some((x) => x.trip_id === t.id && x.status === 'completed') || kmOf(t.id) > 0)).slice(0, 30).map((t) => {
      const ms = matches.filter((x) => x.trip_id === t.id), done = ms.filter((x) => x.status === 'completed'), km = kmOf(t.id);
      const who = done.length ? done.map((x) => nm(x.rider_id)).join(', ') : '';
      const html = '<div style="padding:8px 0;border-top:1px solid var(--line)"><b><span class="tag">Driving</span> ' + esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')) + '</b> <span class="tag">' + (done.length ? 'completed' : 'no riders') + '</span> <button class="btn ghost" style="padding:4px 10px;min-height:0" data-ptrip="' + t.id + '">Details</button><div class="mut">' + esc(RSD.label(t.trip_date)) + ' at ' + clk(t.depart_min) + (who ? ' &middot; ' + who : '') + ' &middot; ' + done.length + ' rider' + (done.length === 1 ? '' : 's') + kmLabel(t, km) + '</div>' + done.map((x) => rateLine(x, x.rider_id) + reportLine(x, x.rider_id)).join('') + '</div>';
      return { role: 'drive', past: true, tripId: t.id, date: t.trip_date, time: t.depart_min, html, f: { completed: done.length > 0, cancelled: done.length === 0 } };
    });
    const tripRows = pastTripItems.slice(0, 8).map((i) => i.html).join('');
    const pastRideItems = past.filter((x) => x.rider_id === user.id).map((x) => ({ role: 'ride', past: true, date: x.ride_date, time: 0, f: { completed: x.status === 'completed', cancelled: x.status !== 'completed' }, html: '<div style="padding:8px 0;border-top:1px solid var(--line)"><b><span class="tag">Riding</span> Ride with ' + nm(x.driver_id) + '</b> <span class="tag">' + esc(statusText(x.status)) + '</span> <button class="btn ghost" style="padding:4px 10px;min-height:0" data-pride="' + x.id + '">Details</button><div class="mut">' + when(x) + ' &middot; ' + (x.pay_with === 'points' ? x.points + ' pts' : 'cash') + '</div>' + rateLine(x, x.driver_id) + reportLine(x, x.driver_id) + '</div>' }));
    const rideRows = pastRideItems.slice(0, 8).map((i) => i.html).join('');
    // Calendar: one month, a dot for each day I drive (D) or ride (R); tap a day to see it
    const pad2 = (n) => String(n).padStart(2, '0');
    if (!calMonth) calMonth = t0.slice(0, 7);
    const [cy, cm] = calMonth.split('-').map(Number), dim = new Date(cy, cm, 0).getDate(), lead = (new Date(cy, cm - 1, 1).getDay() + 6) % 7;
    const dayInfo = (ds) => {
      const dt = myTrips.filter((t) => tripOn(t, ds)), dl = myLiveTrip && ds === t0 ? [myLiveTrip] : [];
      const dm = matches.filter((x) => x.driver_id === user.id && x.ride_date === ds && (x.status === 'accepted' || (x.status === 'requested' && fitsOk(x))));
      const rm = matches.filter((x) => x.rider_id === user.id && x.ride_date === ds && (x.status === 'accepted' || x.status === 'requested'));
      return { trips: dt.concat(dl), dm, rm, skipped: myTrips.filter((t) => rawOn(t, ds) && skipsOf(t.id).has(ds)) };
    };
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    for (let dd = 1; dd <= dim; dd++) {
      const ds = cy + '-' + pad2(cm) + '-' + pad2(dd), inf = dayInfo(ds), nAcc = inf.dm.filter((x) => x.status === 'accepted').length, nAsk = inf.dm.length - nAcc;
      const chip = (txt, bg, fg) => '<span style="display:block;font-size:10px;line-height:14px;border-radius:7px;margin-top:1px;background:' + bg + ';color:' + fg + '">' + txt + '</span>';
      cells += '<button type="button" data-calday="' + ds + '" style="border:1px solid ' + (ds === calDay ? 'var(--acc)' : 'var(--line)') + ';background:' + (ds === t0 ? 'var(--acc2)' : 'var(--card)') + ';color:var(--ink);border-radius:8px;padding:3px 0;min-height:52px;font:inherit;font-size:13px;cursor:pointer;opacity:' + (ds < t0 ? '.55' : '1') + '">' + dd
        + (inf.trips.length ? chip('D' + (nAcc ? ' ' + nAcc : ''), 'var(--acc)', 'var(--card)') : inf.skipped.length ? chip('skip', 'var(--line)', 'var(--mut)') : '') + (nAsk ? chip(nAsk + ' ask', 'var(--warnbg)', 'var(--warn)') : '') + (inf.rm.length ? chip('R', 'var(--mut)', 'var(--card)') : '') + '</button>';
    }
    const mName = new Date(cy, cm - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    let dayBox = '';
    if (calDay && calDay.slice(0, 7) === calMonth) {
      const inf = dayInfo(calDay);
      const dRows = inf.trips.map((t) => '<div style="padding:6px 0;border-top:1px solid var(--line)"><b>' + clk(t.live ? t.depart_min : (isFlexFree(forDate(t, calDay)) ? t.flex_from : forDate(t, calDay).depart_min)) + (isFlexFree(forDate(t, calDay)) ? ' or later' : '') + ' &middot; ' + esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')) + '</b>' + (inf.dm.filter((x) => inFam(x.trip_id, t)).map((x) => row(x, false)).join('') || '<div class="mut">No riders yet.</div>') + (t.live ? '' : '<div style="margin-top:6px"><button class="btn" data-opentrip="' + t.id + '|' + calDay + '">Open</button>' + (RPOK && calDay >= t0 && t.repeat_days && t.repeat_days.length ? ' <button class="btn ghost" data-skipday="' + t.id + '|' + calDay + '">Skip ' + esc(/^(Today|Tomorrow)$/.test(RSD.label(calDay)) ? RSD.label(calDay).toLowerCase() : RSD.label(calDay)) + '</button>' : '') + '</div>') + '</div>').join('');
      const rRows = inf.rm.map((x) => row(x, true)).join('');
      const sRows = inf.skipped.map((t) => '<div style="padding:6px 0;border-top:1px solid var(--line)"><b>Skipped</b> &middot; ' + esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')) + ' <button class="btn ghost" data-unskipday="' + t.id + '|' + calDay + '">Bring this day back</button></div>').join('');
      dayBox = '<div style="margin-top:10px"><b>' + esc(RSD.label(calDay)) + '</b>' + (dRows ? '<div class="mut" style="margin-top:6px">Driving</div>' + dRows : '') + sRows + (rRows ? '<div class="mut" style="margin-top:6px">Riding</div>' + rRows : '') + (!dRows && !rRows && !sRows ? '<p class="mut">Nothing planned this day.</p>' : '') + '</div>';
    }
    const calCard = card('Calendar', '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><button type="button" class="btn ghost" data-calmove="-1" aria-label="Previous month">&lsaquo;</button><b>' + esc(mName) + '</b><button type="button" class="btn ghost" data-calmove="1" aria-label="Next month">&rsaquo;</button></div>'
      + '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center"><span class="mut" style="font-size:11px">Mon</span><span class="mut" style="font-size:11px">Tue</span><span class="mut" style="font-size:11px">Wed</span><span class="mut" style="font-size:11px">Thu</span><span class="mut" style="font-size:11px">Fri</span><span class="mut" style="font-size:11px">Sat</span><span class="mut" style="font-size:11px">Sun</span>' + cells + '</div>'
      + '<p class="mut hint" data-once="calendar" style="margin-top:8px;font-size:12px"><b>D</b> = you drive (number = riders booked), <b>R</b> = you ride. Tap a day to see it.</p>' + dayBox);
    const segT = (v, label) => '<button type="button" class="btn' + (tripsView === v ? '' : ' ghost') + '" data-tview="' + v + '" style="flex:1;min-width:0">' + label + '</button>';
    const toggle = '<div style="display:flex;gap:8px;margin:0 0 12px">' + segT('driver', 'As a driver') + segT('rider', 'As a rider') + '</div>';
    const paneSeg = (v, l) => '<button type="button" class="btn' + (tripsPane === v ? '' : ' ghost') + '" data-tpane="' + v + '" style="flex:1;min-width:0">' + l + '</button>';
    const paneSegBar = () => '<div style="display:flex;gap:8px;margin:0 0 12px">' + paneSeg('cal', 'Calendar') + paneSeg('list', 'List') + '</div><div class="row2" style="margin-bottom:10px"><button class="btn" data-newtrip="1">+ Post a trip</button> <button class="btn ghost" data-askride="1">+ Ask for a ride</button></div>';
    const bar = '<div style="display:flex;gap:8px;margin:0 0 12px">' + paneSeg('cal', 'Calendar') + paneSeg('list', 'List') + '</div>' + (tripsView === 'driver' ? '<p><button class="btn" data-newtrip="1" style="width:100%">+ Post a trip</button></p>' : '<p><button class="btn" data-askride="1" style="width:100%">+ Ask for a ride</button></p>');
    // ---- Trips > List: everything in one list (driving and riding, upcoming and past) with quick filters ----
    const rideItemRow = (it) => {
      const q = it.kind === 'looking' ? it.q : (myReq && it.x.request_id === myReq.id ? myReq : null);
      const rt = q ? esc(disp(q, 'pickup')) + ' to ' + esc(disp(q, 'dropoff')) : (it.tr ? esc(disp(it.tr, 'origin')) + ' to ' + esc(disp(it.tr, 'dest')) : '');
      const when = it.kind === 'ride' ? esc(RSD.label(it.d)) + (it.time ? ' &middot; pickup ' + clk(it.time) : '') : (it.live ? 'Looking for a ride now' : esc(RSD.label(it.d)) + ' &middot; ready ' + clk(it.q.ready_from));
      const st = it.kind === 'ride' ? (it.x.status === 'accepted' ? 'Confirmed with ' : 'Waiting for ') + esc(nm(it.x.driver_id)) : 'Looking for a driver';
      return '<button type="button" class="btn ghost" data-openride="' + it.d + '" style="width:100%;text-align:left;margin:3px 0;display:block"><div><b><span class="tag">Riding</span> ' + when + '</b></div><div class="mut" style="font-size:13px;font-weight:400">' + rt + (rt ? ' &middot; ' : '') + st + '</div></button>';
    };
    const allItems = [];
    dayItems.forEach((it) => {
      const { acc, ask } = dayStat(it), ft = forDate(it.t, it.d), rep = !!(it.t.repeat_days && it.t.repeat_days.length) && !it.t.live;
      allItems.push({ role: 'drive', past: false, tripId: it.t.id, date: it.d, time: it.time, html: dayRow(it), f: { waiting: ask > 0, confirmed: acc > 0, empty: acc === 0 && ask === 0, repeating: rep, oneTime: !rep, flex: isFlexFree(ft) } });
    });
    homeItems().filter((i) => i.kind !== 'drive').forEach((it) => {
      const rep = it.kind === 'looking' ? !!(it.q.repeat_days && it.q.repeat_days.length) : !!(myReq && it.x.request_id === myReq.id && myReq.repeat_days && myReq.repeat_days.length);
      allItems.push({ role: 'ride', past: false, date: it.d, time: it.time, html: rideItemRow(it), f: { waiting: it.kind === 'looking' || it.x.status === 'requested', confirmed: it.kind === 'ride' && it.x.status === 'accepted', repeating: rep, oneTime: !rep } });
    });
    pastTripItems.concat(pastRideItems).forEach((it) => allItems.push(it));
    // A trip as a group: the trip itself on top, its dates under it (the first few; the rest one tap away). Close a group to hide its dates.
    const groupHtml = (t, rep, dates) => {
      const its = allItems.filter((i) => i.role === 'drive' && !i.past && i.tripId === t.id && (!tf.st.size || [...tf.st].some((k) => i.f[k])));
      const asksAll = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.ride_date >= t0 && x.status === 'requested' && fitServer[x.id] !== false).length;
      const sub = t.live ? 'Offering seats now &middot; started at ' + clk(t.depart_min) : rep ? 'Repeats ' + esc(RSD.repeatLabel(t.repeat_days, t.repeat_every, t.repeat_nth)) + untilTxt(t.repeat_until) : tripWhen(t);
      const buttons = '<div style="margin:6px 0;display:flex;flex-wrap:wrap;gap:8px"><button class="btn" data-opentrip="' + t.id + '|' + (t.live ? todayStr() : (dates[0] || t.trip_date)) + '">Open</button><button class="btn ghost" data-edittrip="' + t.id + '">Edit</button><button class="btn ghost" data-offtrip="' + t.id + '"' + (rep ? ' data-rep="1"' : '') + '>' + (rep ? 'Stop repeating trip' : 'Cancel trip') + '</button></div>';
      const rows = its.map((i) => i.html), id = 'g-' + t.id;
      return '<details data-fold="' + id + '"' + (foldOpen.has(id) ? ' open' : '') + ' style="border-top:2px solid var(--line);padding:8px 0"><summary style="cursor:pointer;padding:4px 0"><b>' + esc(disp(t, 'origin')) + ' to ' + esc(disp(t, 'dest')) + '</b><div class="mut">' + sub + ' &middot; ' + (t.live ? '' : (dates.length + (dates.length === 1 ? ' date' : ' dates'))) + (asksAll ? ' &middot; <b>' + asksAll + ' asking</b>' : '') + (t.auto_accept ? ' &middot; accepts automatically' : '') + '</div></summary>' + buttons
        + (rows.length ? rows.slice(0, 4).join('') + (rows.length > 4 ? fold('f-gm-' + t.id, 'Show ' + (rows.length - 4) + ' more dates', rows.slice(4).join('')) : '') : '<p class="mut">No dates match the filters.</p>') + '</details>';
    };
    // By trip: one group per trip I drive (a repeating trip is ONE row; open it for its dates, Edit, Stop), instead of one row per date
    const seriesItems = tripList.map((t) => {
      const rep = !!(t.repeat_days && t.repeat_days.length) && !t.live, dates = t.live ? [] : occOf(t, 31), fam = matches.filter((x) => x.driver_id === user.id && inFam(x.trip_id, t) && x.ride_date >= t0);
      const asks = fam.filter((x) => x.status === 'requested' && fitServer[x.id] !== false).length, acc = fam.filter((x) => x.status === 'accepted').length, first = dates[0] || t.trip_date;
      return { role: 'drive', past: false, tripId: t.id, date: first, time: t.depart_min, html: groupHtml(t, rep, dates), f: { waiting: asks > 0, confirmed: acc > 0, empty: asks === 0 && acc === 0, repeating: rep, oneTime: !rep, flex: isFlexFree(forDate(t, first)) } };
    });
    const byTrip = tf.view === 'trip' && tf.role !== 'ride', pool = byTrip ? seriesItems.concat(pastTripItems) : allItems;
    const tripOk = (it) => !tf.trip || it.tripId === tf.trip;
    const whenOk = (it) => tf.when === 'all' || (tf.when === 'past') === it.past, roleOk = (it) => tf.role === 'all' || tf.role === it.role;
    const STAT = [['waiting', 'Waiting'], ['confirmed', 'With passengers'], ['empty', 'No riders yet'], ['repeating', 'Repeating'], ['oneTime', 'One-time'], ['flex', 'Flexible time'], ['completed', 'Completed'], ['cancelled', 'Cancelled or empty']];
    const chip = (attr, val, label, on) => '<button type="button" ' + attr + '="' + val + '" class="' + (on ? 'on' : '') + '">' + label + '</button>';
    const nWhen = (w) => pool.filter((it) => roleOk(it) && tripOk(it) && (w === 'all' || (w === 'past') === it.past)).length, nRole = (r) => pool.filter((it) => whenOk(it) && tripOk(it) && (r === 'all' || it.role === r)).length;
    const base = pool.filter((it) => whenOk(it) && roleOk(it) && tripOk(it));
    const statChips = STAT.map(([k, l]) => ({ k, l, n: base.filter((it) => it.f[k]).length })).filter((c) => c.n > 0 || tf.st.has(c.k) || (c.k === 'waiting' || c.k === 'confirmed') && tf.role !== 'ride').map((c) => chip('data-tfs', c.k, c.l + ' (' + c.n + ')', tf.st.has(c.k))).join('');
    const filtered = base.filter((it) => !tf.st.size || [...tf.st].some((k) => it.f[k])).sort((a, b) => (a.past !== b.past ? (a.past ? 1 : -1) : a.past ? (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) : (a.date < b.date ? -1 : a.date > b.date ? 1 : a.time - b.time)));
    const filtersOn = tf.when !== 'upcoming' || tf.role !== 'all' || tf.st.size > 0 || !!tf.trip, LIM = 12;
    const shortRep = (t) => { const ds = (t.repeat_days || []).slice().sort((a, b) => a - b); if (t.repeat_nth) return 'monthly'; if (!ds.length) return RSD.label(t.trip_date); if (ds.length === 7) return 'daily'; if (ds.join('') === '12345') return 'weekdays'; return (t.repeat_every > 1 ? 'every ' + t.repeat_every + ' wks ' : '') + ds.map((d) => RSD.DAY_NAMES[d - 1]).join(' '); };
    const tripChips = tripList.length >= 2 && !byTrip ? '<div class="days" style="margin-bottom:6px">' + tripList.map((t) => chip('data-tft', t.id, esc(disp(t, 'dest')) + ' &middot; ' + esc(shortRep(t)), tf.trip === t.id)).join('') + '</div>' : '';
    const viewBar = tripList.length >= 1 && tf.role !== 'ride' ? '<div class="days" style="margin-bottom:6px">' + chip('data-tfv', 'trip', 'Trips and their dates (' + tripList.length + ')', tf.view === 'trip') + chip('data-tfv', 'date', 'All dates together', tf.view !== 'trip') + '</div>' : '';
    const listBody = filtered.length ? filtered.slice(0, LIM).map((i) => i.html).join('') + (filtered.length > LIM ? fold('f-list-more', 'Show ' + (filtered.length - LIM) + ' more', filtered.slice(LIM).map((i) => i.html).join('')) : '') : '<p class="mut">Nothing matches.' + (filtersOn ? ' <button type="button" class="btn ghost" data-tfclear="1" style="padding:4px 10px;min-height:0">Clear filters</button>' : '') + '</p>';
    const filterBar = viewBar + '<div class="days" style="margin-bottom:6px">' + chip('data-tfw', 'upcoming', 'Upcoming (' + nWhen('upcoming') + ')', tf.when === 'upcoming') + chip('data-tfw', 'past', 'Past (' + nWhen('past') + ')', tf.when === 'past') + chip('data-tfw', 'all', 'All', tf.when === 'all') + '</div>'
      + '<div class="days" style="margin-bottom:6px">' + chip('data-tfr', 'all', 'All', tf.role === 'all') + chip('data-tfr', 'drive', 'Driving (' + nRole('drive') + ')', tf.role === 'drive') + chip('data-tfr', 'ride', 'Riding (' + nRole('ride') + ')', tf.role === 'ride') + '</div>'
      + tripChips + (statChips ? '<div class="days" style="margin-bottom:6px">' + statChips + '</div>' : '') + (filtersOn && filtered.length ? '<div style="margin-bottom:4px"><button type="button" class="btn ghost" data-tfclear="1" style="padding:4px 10px;min-height:0">Clear filters</button></div>' : '');
    const listPaneHtml = paneSegBar() + lostBanner() + card('Trips', filterBar + listBody) + (tripList.length && !byTrip ? card('Manage my trips', fold('f-manage-trips', 'My trips (' + tripList.length + '): edit or stop', tripList.map(tripRow).join(''))) : '') + cancelAllCard();
    window.__rules = card('Cancellation rules', policy);
    if (tripsPane === 'list') return listPaneHtml;
    if (tripsView === 'rider') {
      const comingR = (curReq ? card('Upcoming ride request', mineReq) : '') + (asRider.length ? card('Upcoming rides', riderRows) : '')
        || card('Upcoming rides', '<p class="mut">Nothing yet. Ask for a ride on <b>Home</b> and your driver will show up here.</p>');
      return toggle + bar + lostBanner() + (tripsPane === 'cal' ? calCard : comingR) + card('Past rides', rideRows ? fold('f-past-rides', 'Show past rides', rideRows) : '<p class="mut">Nothing yet. Rides you have taken show up here.</p>') + cancelAllCard();
    }
    const askN = asDriver.filter((x) => x.status === 'requested').length;
    const comingD = (tripList.length ? card('Upcoming trips', mineTrip) : '') + (asDriver.length ? card('Upcoming riders', driverRows) : '')
      || card('Upcoming trip', '<p class="mut">Nothing yet. Switch on <b>Offer seats to riders</b> on Home, or post a trip for a set day and time.</p>');
    return toggle + bar + (tripsPane === 'cal' ? calCard : comingD) + card('Past trips', tripRows ? fold('f-past-trips', 'Show past trips', tripRows) : '<p class="mut">Nothing yet. Finished trips show up here.</p>') + cancelAllCard();
  }

  // ---------- settings tab ----------
  const CHAT = [['quiet', 'Quiet ride (prefer not to talk)'], ['some', 'A bit of chat is fine'], ['chatty', 'Happy to chat']];
  function settingsMain() {
    const x = S_(), sel = (id, list, cur) => '<select id="' + id + '" style="' + INPUT + '">' + list.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    const chk = (id, on, text) => '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + text + '</label>';
    const optIn = (id, v, max) => '<input type="number" id="' + id + '" min="0" max="' + max + '" step="0.5" placeholder="no limit" value="' + (v == null ? '' : v) + '" style="' + INPUT + '">';
    const num = (id, v, max) => '<input type="number" id="' + id + '" min="0" max="' + max + '" value="' + v + '" style="' + INPUT + '">';
    return adminCard() + profileCard() + blockedCard() + card('Driver settings', '<p class="mut hint">Defaults for new trips. Changing them here does not change trips you already posted.</p>'
      + '<label>Extra minutes I accept for my whole trip</label>' + num('ls-detour', x.d_total_detour == null ? x.d_detour : x.d_total_detour, 60)
      + (DKOK ? '<label>Extra km I accept for my whole trip <span class="mut">(optional, empty = no distance limit)</span></label>' + optIn('ls-detourkm', x.d_total_detour_km == null ? x.d_detour_km : x.d_total_detour_km, 400) + '<p class="mut">A request has to fit every limit you set: minutes and kilometres.</p>' : '')
      + '<label>Payment I accept</label>' + sel('ls-accepts', [['either', 'Points or cash'], ['points', 'Points only'], ['cash', 'Cash gas-share only']], x.d_accepts)
      + '<label>Most riders I will take</label>' + sel('ls-seats', [1, 2, 3, 4].map((n) => [n, n === 1 ? 'Just 1 rider' : 'Up to ' + n]), Math.min(4, x.d_seats))
      + chk('ls-auto', x.d_auto_accept, 'Accept riders automatically when they fit my limits, until the car is full (for new trips; you can change it on each trip). Riders who do not fit are never shown to me.')
      + '<label>My ride style</label>' + sel('ls-dchat', CHAT, x.d_chat)
      + chk('ls-dpets', x.d_pets, 'Pets are welcome in my car')
      + '<div style="margin-top:12px"><button class="btn" id="ls-save-d">Save driver settings</button></div>')
      + card('Rider settings', '<p class="mut">These fill in each new ride request for you.</p>'
      + '<label>I usually pay with</label>' + sel('ls-pays', [['points', 'Points'], ['cash', 'Cash gas-share']], x.r_pays)
      + '<label>My ride style</label>' + sel('ls-rchat', CHAT, x.r_chat)
      + chk('ls-rpets', x.r_pets, 'I travel with a pet')
      + '<div style="margin-top:12px"><button class="btn" id="ls-save-r">Save rider settings</button></div>')
      + (isTest ? card('Admin and test tools (only you see this)', '<p><b>Test mode: ' + (testMode ? 'ON' : 'OFF') + '</b></p><p class="mut hint">While test mode is ON and driving mode is running (after Start trip), a made-up rider asks for a seat on your trip about every 2 minutes, so you get alerts while you navigate.</p><p><button class="btn' + (testMode ? ' ghost' : '') + '" id="ts-mode">' + (testMode ? 'Turn test mode OFF' : 'Turn test mode ON') + '</button></p><hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><p class="mut hint">Or send one test request by hand. Pick a delay if you want to start driving first.</p><label>Send it</label><select id="ts-delay" style="' + INPUT + '"><option value="0">Right now</option><option value="30" selected>In 30 seconds</option><option value="60">In 1 minute</option><option value="120">In 2 minutes</option></select><div style="margin-top:10px"><button class="btn" id="ts-send">Send a test request</button> <button class="btn ghost" id="ts-clear">Remove test requests</button></div><hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><p class="mut">Pretend to drive without moving. First tap <b>Start trip</b> in the Trip plan, then:</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="ts-fake-pick">Pretend I am at the next pickup</button><button class="btn ghost" id="ts-fake-drop">Pretend I am at the next drop-off</button><button class="btn ghost" id="ts-fake-off">Use my real GPS again</button></div><p class="mut hint" style="margin-top:10px">Test the leave-by reminders without a rider (keep Offer a ride now on):</p><button class="btn ghost" id="ts-leave-test">Test the leave-by reminder (due in 2 min)</button>') : '')
      + (nativeLoc() ? card('Rider alerts', '<p><b>Status: ' + (dndOn ? 'ON' : 'OFF') + '</b></p><p class="mut">' + (dndOn ? 'Seat requests can alert you even when your phone is on Do Not Disturb or Sleeping mode.' : 'Seat requests are silent when your phone is on Do Not Disturb or Sleeping mode. Tap the button, then switch on <b>Override Do Not Disturb</b> on the screen that opens.') + '</p><p><button class="btn' + (dndOn ? ' ghost' : '') + '" id="dnd-go">' + (dndOn ? 'Open alert settings' : 'Let alerts break through Do Not Disturb') + '</button></p>') : '')
      + (nativeLoc() ? card('Floating RideShare button', '<p><b>Status: ' + (overlayOn ? 'ON' : 'OFF') + '</b></p><p class="mut">' + (overlayOn ? 'While a ride is under way, a small round RideShare button floats over Google Maps. Tap it to come back to RideShare. You can drag it out of the way.' : 'Shows a small round RideShare button over Google Maps while a ride is under way, so one tap brings you back to RideShare. Tap the button, then switch on <b>Allow display over other apps</b> on the screen that opens.') + '</p><p><button class="btn' + (overlayOn ? ' ghost' : '') + '" id="ov-go">' + (overlayOn ? 'Open settings' : 'Allow the floating button') + '</button> ' + (overlayOn ? '<button class="btn ' + (bubbleHidden ? '' : 'ghost') + '" id="ov-hide">' + (bubbleHidden ? 'Show the floating button again' : 'Hide the floating button') + '</button>' : '') + '</p><p class="mut hint">You can also press and hold the floating button for a second to make it go away until your next ride.</p>') : '')
      + (isTest ? card('Layout', '<p class="mut hint">You are using the new layout. If something feels off, you can switch back at any time.</p><p><button class="btn ghost" data-uimode="classic">Use the old layout</button></p>') : '')
      + card('Good to know', '<p class="mut hint">Driver and rider settings are separate, so you can be both at the same time. Other people only see your ride style (like "quiet ride") and whether you accept automatically. Nothing else in here is shared.</p>');
  }
  const saveSettings = () => {
    const g = (id) => $(id), n = (id, max) => Math.max(0, Math.min(max, Math.round(+g(id).value || 0)));
    const base = S_(), row = Object.assign({}, base, { user_id: user.id, updated_at: new Date().toISOString() });
    if (g('ls-detour')) Object.assign(row, { d_detour: n('ls-detour', 60), d_wait: 0, d_accepts: g('ls-accepts').value, d_seats: Math.max(1, Math.min(4, +g('ls-seats').value || 1)), d_total_detour: n('ls-detour', 60), ...(DKOK ? { d_detour_km: optNum('ls-detourkm'), d_total_detour_km: optNum('ls-detourkm') } : {}), d_auto_accept: g('ls-auto').checked, d_chat: g('ls-dchat').value, d_pets: g('ls-dpets').checked });
    if (g('ls-pays')) Object.assign(row, { r_pays: g('ls-pays').value, r_chat: g('ls-rchat').value, r_pets: g('ls-rpets').checked });
    return row;
  };

  // ---------- points tab ----------
  function profileCard() {
    if (!PCOK || !user) return '';
    const c = cards[user.id] || {}, g = (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || '';
    return card('My profile', '<p class="mut hint">The person you are matched with sees your photo, first name and (if you drive) your car once a seat is accepted, and for 30 days after the ride. Other signed-in users can see only your first name.</p>'
      + '<div style="display:flex;gap:12px;align-items:center;margin:8px 0">' + avatar(user.id, 72) + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pc-pick">' + (c.photo ? 'Change photo' : 'Add a photo') + '</button>' + (g && c.photo_source !== 'google' ? '<button class="btn ghost" id="pc-google">Use my Google photo</button>' : '') + (c.photo ? '<button class="btn ghost" id="pc-clear">Remove</button>' : '') + '</div></div>'
      + '<input type="file" id="pc-file" accept="image/*" style="display:none">'
      + '<label>Car: make and model (only if you drive)</label><input type="text" id="pc-make" maxlength="40" value="' + esc(c.car_make || '') + '" style="' + INPUT + '">'
      + '<label>Car colour</label><input type="text" id="pc-color" maxlength="30" value="' + esc(c.car_color || '') + '" style="' + INPUT + '">'
      + '<label>Licence plate</label><input type="text" id="pc-plate" maxlength="12" value="' + esc(c.car_plate || '') + '" style="' + INPUT + ';text-transform:uppercase">'
      + '<div style="margin-top:12px"><button class="btn" id="pc-save">Save car details</button></div>');
  }
  function walletMain() {
    const sum = (list) => list.reduce((a, x) => a + x.points, 0), heldList = matches.filter((x) => x.status === 'accepted' && !x.settled && x.pay_with === 'points');
    const heldAsRider = sum(heldList.filter((x) => x.rider_id === user.id)), pendingAsDriver = sum(heldList.filter((x) => x.driver_id === user.id));
    return card('Your name and points', `<label>First name shown to others</label><input type="text" id="lv-name" maxlength="30" value="${esc(me.name)}" style="${INPUT}">
      <div style="margin-top:8px"><button class="btn ghost" id="lv-savename">Save name</button></div>
      <div class="stat" style="margin-top:12px"><div><span class="mut">Points balance</span><b>${me.points}</b></div><div><span class="mut">Held for your rides</span><b>${heldAsRider}</b></div><div><span class="mut">Coming to you</span><b>${pendingAsDriver}</b></div><div><span class="mut">Value</span><b>1 pt = $0.10</b></div></div>
      <p class="mut hint" data-once="points">Earn points by driving riders who pay in points. Spend them when you ride. Out of points? You can still ride by paying a driver a cash gas-share. Points can't be cashed out or transferred, and they never exceed the real cost of the trip, so nobody profits.</p>`)
      + card('Your data', '<p class="mut hint">We store your first name, email, photo and car details, the places and map points you post, your rides, messages, ratings and points. Your live location is shared with your riders only while you drive, and the latest position is deleted when the ride ends. The person you are matched with can see your photo, first name and car during the ride and for 30 days after. <a href="privacy.html">Privacy policy</a> &middot; <a href="terms.html">Terms</a></p><label>To erase your account and all your data, type DELETE</label><input type="text" id="del-confirm" autocomplete="off" style="' + INPUT + '"><div style="margin-top:8px"><button class="btn ghost" id="del-go" disabled>Delete my account</button></div><p class="warn" id="del-msg" role="alert"></p>')
      + (isTest ? card('Track yourself', '<p class="mut hint">Walk or drive and watch yourself move on the map, with speed, distance and a trail. Your location stays on this device.</p><a class="btn" href="gps.html" style="display:inline-block;text-decoration:none">Open GPS test</a>') : '')
      + card('History', ledger.length ? ledger.map((x) => `<div style="padding:4px 0">${(x.delta > 0 ? '+' : '') + x.delta} pts <span class="mut">${esc(x.reason)}</span></div>`).join('') : '<p class="mut">Nothing yet.</p>');
  }

  // ---------- render + wiring ----------
  function render() {
    renderAuth();
    ['sim-d', 'sim-ld', 'map-card'].forEach((id) => { const e = $(id); if (e) e.style.display = isTest && DEV ? '' : 'none'; });
    if (!user) { ['ld-top', 'lr-top'].forEach((id) => { $(id).innerHTML = ''; }); ['ld-form', 'ld-lists', 'lr-form', 'lr-lists', 'lu-main', 'lw-main', 'ls-main'].forEach((id) => { $(id).innerHTML = /form|main/.test(id) ? hint : ''; }); return; }
    autoBack();
    const sig = JSON.stringify([myTrips, selTripId, myReq, me.points, pending, mySet, isTest, testMode, homeView]);
    const typing = document.activeElement && /^(lt|lr|lv|ls|ln|rn)-/.test(document.activeElement.id || '') && document.activeElement.tagName !== 'BUTTON' && !pending;
    if (!typing && sig !== formSig) { formSig = sig; $('ld-form').innerHTML = guard('trip form', driverForm); $('lr-form').innerHTML = guard('ride form', riderForm); $('lw-main').innerHTML = guard('points', walletMain); $('ls-main').innerHTML = guard('settings', settingsMain); }
    const busyIn = (id) => { const a = document.activeElement; return a && /SELECT|INPUT/.test(a.tagName) && a.closest && a.closest('#' + id); };
    try { syncAutopilot(); } catch (e) { /* ignore */ }
    try { renderRequests(); } catch (e) { console.error('requests', e); }
    const dBack = hv() === 'trip' || hv() === 'post' || hv() === 'now' ? backBar() : '', rBack = hv() === 'ride' || hv() === 'ask' ? backBar() : '';
    if (showsDrive('trip')) { if (!busyIn('ld-top')) try { renderPlan(); } catch (e) { console.error('plan', e); } } else { const pw = $('plan-wrap'); if (pw) pw.classList.add('hide'); }
    if (!busyIn('ld-top')) { const dN = guard('leave now', driverNow), dT = guard('driver summary', driverTop); $('ld-top').innerHTML = dBack + (hv() === 'feed' ? dT + dN : dN + dT); }   // on Home the next trip comes first, then the open form
    if (!busyIn('lr-top')) { const rN = guard('ride now', riderNow), rT = guard('rider summary', riderTop); $('lr-top').innerHTML = rBack + (hv() === 'feed' ? rT + rN : rN + rT); }
    if (showsDrive('trip')) $('ld-lists').innerHTML = guard('riders list', driverLists); else { $('ld-lists').innerHTML = ''; const me1 = $('map-ld'); if (me1) me1.style.display = 'none'; }
    if (showsDrive('ride')) $('lr-lists').innerHTML = guard('drivers list', riderLists); else { $('lr-lists').innerHTML = ''; const me2 = $('map-lr'); if (me2) me2.style.display = 'none'; }
    const upHtml = guard('upcoming', upcomingMain); $('lu-main').innerHTML = upHtml + (tripsView === 'driver' ? guard('drive log', driveLogCard) : '') + (window.__rules || '');
    applyCar(); syncSharing();
    try { wire(); } catch (e) { console.error('wire', e); showErr('buttons: ' + (e && e.message || e)); }
    try { tipify(); } catch (e) { console.error('tips', e); }
  }

  // Forget everything typed or chosen on screen, so the app looks as it does when first opened. Used by Reset trip and Start fresh.
  function resetClientState() {
    stopShare(true);
    editing.trip = false; editing.req = false; editing.newTrip = false; editing.dayOnly = null;
    homeView = 'feed'; detailTripId = null; selTripId = null; pending = null; viewD = null; viewR = null; calDay = null; calMonth = null; askCancel = null; mapSig = {}; formSig = '';
    [nowSel, LV].forEach((o) => Object.keys(o).forEach((k) => { delete o[k]; }));
    plReset('ln-o', 'ln-d', 'lt-o', 'lt-d', 'lr-p', 'lr-d', 'rn-p', 'rn-d');
    tripMode = 'now'; rideMode = 'now'; tripsView = 'driver'; offerOpen = false; tripsPane = 'list'; tf = { when: 'upcoming', role: 'all', st: new Set(), view: 'trip', trip: null }; saveTf(); keep('rs_trips_pane', 'list');
    try { localStorage.setItem('rs_trip_mode', 'now'); localStorage.removeItem('rs_trip_on'); localStorage.removeItem('rs_ride_mode'); localStorage.removeItem('rs_trips_view'); } catch (e) { /* storage blocked */ }
  }
  async function run(p, ok) { try { const r = await p; if (r.error) throw r.error; if (ok) toast(ok); return true; } catch (e) { fail(e); return false; } finally { formSig = ''; await loadAll(); } }

  function wire() {
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    document.querySelectorAll('#lt-days button, #lr-days button').forEach((b) => (b.onclick = () => b.classList.toggle('on')));
    ['ln-date', 'ln-t', 'ln-pk', 'ln-dt', 'ln-a', 'ln-dk'].forEach((id) => { const e = $(id); if (e) e.onchange = () => { LV[id] = e.value; }; });
    ['ln', 'lt'].forEach((p) => {
      const box = $(p + '-flex'); if (!box) return;
      const mode = $(p + '-mode');
      const relabel = () => {
        const ar = mode && mode.value === 'arrive', l1 = $(p + '-t-lbl'), l2 = $(p + '-t2-lbl');
        if (l1) l1.textContent = box.checked ? 'From' : ar ? 'Arrive by' : 'Leave at';
        if (l2) l2.textContent = 'To';
      };
      box.onchange = () => { $(p + '-flexbox').style.display = box.checked ? '' : 'none'; if (p === 'ln') LV['ln-flex'] = box.checked ? '1' : ''; relabel(); };
      if (mode) mode.onchange = () => { if (p === 'ln') LV['ln-mode'] = mode.value; relabel(); };
      relabel();
      const seg = $(p + '-seg');
      if (seg) seg.querySelectorAll('button').forEach((bt) => (bt.onclick = () => {
        const v = bt.dataset.seg; mode.value = v === 'arrive' ? 'arrive' : 'leave'; box.checked = v === 'range';
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === bt)); box.onchange(); mode.onchange();
      }));
      const t2 = $(p + '-t2'); if (t2 && p === 'ln') t2.onchange = () => { LV['ln-t2'] = t2.value; };
    });
    document.querySelectorAll('#ln-days button').forEach((b) => (b.onclick = () => { b.classList.toggle('on'); LV.days = readDays('ln-days'); }));
    on('ln-review', () => {
      const rp = repeatRead('ln', $('ln-date').value); if (rp.err) { formMsg('ln-msg', rp.err); return; }
      const row = { origin: $('ln-o').value, dest: $('ln-d').value, trip_date: $('ln-date').value, depart_min: hm($('ln-t').value || '07:30'), repeat_days: rp.days, ...rp.extra, ...(AAOK && $('ln-auto') ? { auto_accept: $('ln-auto').checked } : {}), max_detour: +$('ln-dt').value, max_total_detour: +$('ln-dt').value, max_pickups: +$('ln-pk').value, max_wait: 0, accepts: $('ln-a').value, ...(DKOK ? { max_detour_km: optNum('ln-dk'), max_total_detour_km: optNum('ln-dk') } : {}), ...plCols('ln-o', 'origin'), ...plCols('ln-d', 'dest') };
      if (rp.days.length) { const f0 = RSD.nthDate(row.trip_date, rp.days, rp.every, rp.nth, 1); if (f0) row.trip_date = f0; }
      const need = plNeed('ln-o', 'where you start') || plNeed('ln-d', 'where you are going'); if (need) { formMsg('ln-msg', need); return; }
      if (row.max_pickups === 1) row.max_total_detour = null; else if (row.max_total_detour < row.max_detour) { formMsg('ln-msg', 'The total for all pickups cannot be less than the time for one pickup'); return; }
      formMsg('ln-msg', '');
      if (samePlace(row.origin, row.dest, 'ln-o', 'ln-d')) { formMsg('ln-msg', 'Pick two different places'); return; }
      if (!row.trip_date) { formMsg('ln-msg', 'Pick a date'); return; }
      const trn = timesRead('ln', row, 'ln-o', 'ln-d'); if (trn.err) { formMsg('ln-msg', trn.err); return; }
      const bad = RSD.check(row.trip_date, row.flex_to != null ? row.flex_to : row.depart_min); if (bad) { formMsg('ln-msg', bad); return; }
      editing.newTrip = true; pending = { kind: 'trip', row, note: trn.note }; formSig = ''; render();   // a trip posted from Home is a new trip, never an edit of another one
    });
    on('lt-review', () => {
      const rp = repeatRead('lt', $('lt-date').value); if (rp.err) { formMsg('lt-msg', rp.err); return; }
      const row = { origin: $('lt-o').value, dest: $('lt-d').value, trip_date: $('lt-date').value, depart_min: hm($('lt-t').value || '07:30'), repeat_days: rp.days, max_detour: +$('lt-dt').value, max_total_detour: +$('lt-dt').value, ...(DKOK ? { max_detour_km: optNum('lt-dk'), max_total_detour_km: optNum('lt-dk') } : {}), max_pickups: +$('lt-pk').value, max_wait: 0, accepts: $('lt-a').value, ...(AAOK && $('lt-auto') ? { auto_accept: $('lt-auto').checked } : {}), ...rp.extra, ...plCols('lt-o', 'origin'), ...plCols('lt-d', 'dest') };
      if (rp.days.length) { const f0 = RSD.nthDate(row.trip_date, rp.days, rp.every, rp.nth, 1); if (f0) row.trip_date = f0; }
      const need = plNeed('lt-o', 'where you start') || plNeed('lt-d', 'where you are going'); if (need) { formMsg('lt-msg', need); return; }
      if (row.max_pickups === 1) row.max_total_detour = null; else if (row.max_total_detour < row.max_detour) { formMsg('lt-msg', 'The total for all pickups cannot be less than the time for one pickup'); return; }
      formMsg('lt-msg', '');
      if (samePlace(row.origin, row.dest, 'lt-o', 'lt-d')) { formMsg('lt-msg', 'Pick two different places'); return; }
      if (!row.trip_date) { formMsg('lt-msg', 'Pick a date'); return; }
      if (row.repeat_until && row.repeat_until < row.trip_date) { formMsg('lt-msg', 'The last day cannot be before the first day'); return; }
      const trt = timesRead('lt', row, 'lt-o', 'lt-d'); if (trt.err) { formMsg('lt-msg', trt.err); return; }
      if (row.flex_to == null && myTrip && !editing.newTrip && myTrip.flex_to != null && !myTrip.flex_locked) { row.flex_from = null; row.flex_to = null; }   // the window was switched off
      const bad = RSD.check(row.trip_date, row.flex_to != null ? row.flex_to : row.depart_min); if (bad) { formMsg('lt-msg', bad); return; }
      pending = { kind: 'trip', row, note: trt.note }; formSig = ''; render();
    });
    on('lt-back', () => { pending = null; formSig = ''; render(); });
    on('lt-confirm', async () => {
      if (needProfile('drive')) return;
      if (editing.dayOnly) {
        const dd = editing.dayOnly, r = pending.row, keys = ['origin', 'dest', 'origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'depart_min', 'max_detour', 'max_total_detour', 'max_detour_km', 'max_total_detour_km', 'max_pickups', 'accepts', 'auto_accept'], ch = {};
        keys.forEach((k) => { if (r[k] !== undefined) ch[k] = r[k]; });
        ch.flex_from = r.flex_from == null ? null : r.flex_from; ch.flex_to = r.flex_to == null ? null : r.flex_to;
        const okd = await run(sb.rpc('edit_trip_day', { p_trip: dd.id, p_date: dd.d, p_changes: ch }), RSD.label(dd.d) + ' changed. The other dates are not affected.');
        if (okd) { editing.trip = false; editing.newTrip = false; editing.dayOnly = null; plReset('lt-o', 'lt-d', 'ln-o', 'ln-d'); Object.keys(LV).forEach((k) => delete LV[k]); pending = null; viewD = null; mapSig = {}; formSig = ''; render(); }
        return;
      }
      const row = pending.row, upd = myTrip && !editing.newTrip;
      if (!upd && myTrips.length >= 5) { toast('You can keep up to 5 trips. Cancel one first.'); return; }
      const ok = await run(upd ? sb.from('trips').update(row).eq('id', myTrip.id) : sb.from('trips').insert(row).select('id').single().then((r) => { if (!r.error && r.data) selTripId = r.data.id; return r; }), 'Trip saved');
      if (ok) { editing.trip = false; editing.newTrip = false; plReset('lt-o', 'lt-d', 'ln-o', 'ln-d'); Object.keys(LV).forEach((k) => delete LV[k]); pending = null; viewD = null; mapSig = {}; formSig = ''; render(); }
    });
    on('lr-review', () => {
      const rp = repeatRead('lr', $('lr-date').value); if (rp.err) { formMsg('lr-msg', rp.err); return; }
      const row = { pickup: $('lr-p').value, dropoff: $('lr-d').value, ride_date: $('lr-date').value, ready_from: hm($('lr-f').value || '07:20'), ready_to: hm($('lr-u').value || '07:50'), repeat_days: rp.days, pays: $('lr-pay').value, ...rp.extra, ...plCols('lr-p', 'pickup'), ...plCols('lr-d', 'dropoff') };
      if (rp.days.length) { const f0 = RSD.nthDate(row.ride_date, rp.days, rp.every, rp.nth, 1); if (f0) row.ride_date = f0; }
      formMsg('lr-msg', '');
      const need = plNeed('lr-p', 'where to pick you up') || plNeed('lr-d', 'where to drop you off'); if (need) { formMsg('lr-msg', need); return; }
      if (samePlace(row.pickup, row.dropoff, 'lr-p', 'lr-d')) { formMsg('lr-msg', 'Pick two different places'); return; }
      if (!row.ride_date) { formMsg('lr-msg', 'Pick a date'); return; }
      if (row.repeat_until && row.repeat_until < row.ride_date) { formMsg('lr-msg', 'The last day cannot be before the first day'); return; }
      if (row.ready_to < row.ready_from) { formMsg('lr-msg', '"Latest pickup" must be after "Earliest pickup"'); return; }
      const bad = RSD.check(row.ride_date, row.ready_from); if (bad) { formMsg('lr-msg', bad); return; }
      pending = { kind: 'req', row }; formSig = ''; render();
    });
    on('lr-back', () => { pending = null; formSig = ''; render(); });
    on('lr-confirm', async () => {
      if (needProfile('ride')) return;
      const row = pending.row, ex = plExact('lr-p', 'lr-d'), save = myReq ? sb.from('ride_requests').update(row).eq('id', myReq.id).select('id').single() : sb.from('ride_requests').insert(row).select('id').single();
      const ok = await run(save.then(async (r) => { if (!r.error && r.data) await saveExact(r.data.id, ex); return r; }), 'Request saved');
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
    const saveCard = async (patch, msg) => {
      const row = Object.assign({ user_id: user.id, updated_at: new Date().toISOString() }, patch), e = (await sb.from('profile_cards').upsert(row)).error;
      if (e) { toast('Could not save: ' + e.message); return; }
      cards[user.id] = Object.assign({}, cards[user.id] || {}, row); toast(msg); formSig = ''; render();
    };
    document.querySelectorAll('[data-adm]').forEach((b) => { b.onclick = async () => { const p = b.dataset.adm.split('|'), block = p[1] === '1'; const note = window.prompt(block ? 'Why are you blocking this person? (saved with the block)' : 'Note (optional)'); if (note === null) return; const e = (await sb.rpc('admin_resolve_report', { p_id: p[0], p_note: note, p_block: block })).error; if (e) { toast(e.message); return; } toast(block ? 'Handled and blocked' : 'Marked handled'); loadAll(); }; });
    document.querySelectorAll('[data-unblockme]').forEach((b) => { b.onclick = async () => { const e = (await sb.rpc('unblock_person', { p_user: b.dataset.unblockme })).error; if (e) { toast(e.message); return; } toast('Unblocked'); loadAll(); }; });
    document.querySelectorAll('[data-unblock]').forEach((b) => { b.onclick = async () => { const e = (await sb.rpc('admin_unblock', { p_user: b.dataset.unblock })).error; if (e) { toast(e.message); return; } toast('Unblocked'); loadAll(); }; });
    on('pc-pick', () => $('pc-file').click());
    const pcf = $('pc-file');
    if (pcf) pcf.onchange = () => {
      const f = pcf.files && pcf.files[0]; if (!f) return;
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => { const S = 320, cv = document.createElement('canvas'); cv.width = cv.height = S; const m = Math.min(img.width, img.height); cv.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S); URL.revokeObjectURL(url); saveCard({ photo: cv.toDataURL('image/jpeg', 0.8), photo_source: 'upload' }, 'Photo saved'); };
      img.onerror = () => toast('Could not read that photo'); img.src = url;
    };
    on('pc-google', () => { const g = user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture); if (g && /^https:\/\//.test(g)) saveCard({ photo: g, photo_source: 'google' }, 'Google photo saved'); });
    on('pc-clear', () => saveCard({ photo: null, photo_source: null }, 'Photo removed'));
    on('pc-save', () => saveCard({ car_make: $('pc-make').value.trim() || null, car_color: $('pc-color').value.trim() || null, car_plate: $('pc-plate').value.trim().toUpperCase() || null }, 'Car details saved'));
    on('lv-savename', () => { const v = $('lv-name').value.trim(); if (!v) { toast('Enter a name'); return; } run(sb.from('profiles').update({ display_name: v }).eq('id', user.id), 'Name saved'); });
    // routeOnly: just show the new route in Google Maps (from the Update route alert); it does not start the trip or tell the riders you are on your way.
    const startNav = async (routeOnly) => {
      if (!routeOnly && curTrip) { try { localStorage.setItem('rs_trip_on', curTrip.id); } catch (e) { /* storage blocked */ } }
      // The stops come from the Riders tab or the Home plan card; if neither has drawn yet, go straight from the start to the destination.
      let stops = window.__ldStops || [];
      if (stops.length < 2 && curTrip && known(curTrip)) stops = [{ loc: pt(curTrip, 'origin'), type: 'origin' }, { loc: pt(curTrip, 'dest'), type: 'dest' }];
      if (stops.length < 2) { toast('Nothing to navigate yet'); return; }
      const pt = (x) => x.loc.lat + ',' + x.loc.lng, mid = stops.slice(1, -1).map(pt);
      const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' + (routeOnly ? '' : '&dir_action=navigate') + '&destination=' + pt(stops[stops.length - 1]) + (mid.length ? '&waypoints=' + encodeURIComponent(mid.join('|')) : '');
      const accNow = window.__ldAcc || matches.filter((x) => x.driver_id === user.id && (!curTrip || inFam(x.trip_id, curTrip)) && x.ride_date === todayStr() && x.status === 'accepted');
      const todo = routeOnly ? [] : accNow.filter((x) => stageOf(x) === 'accepted' && stepsOpen(x));
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
    const each = (sel, fn) => document.querySelectorAll(['#v-lhome', '#v-ldriver', '#v-lrider', '#v-lupcoming'].map((r) => r + ' ' + sel).join(', ')).forEach((b) => (b.onclick = () => fn(b)));
    each('[data-report]', (b) => { const p = b.dataset.report.split('|'); reportDialog(p[0], p[1]); });
    each('[data-share]', (b) => shareTrip(b.dataset.share));
    each('[data-meet]', (b) => meetDialog(b.dataset.meet));
    each('[data-ptrip]', (b) => tripDetail(b.dataset.ptrip));
    each('[data-pride]', (b) => rideDetail(b.dataset.pride));
    each('[data-msg]', (b) => msgDialog(b.dataset.msg));
    each('[data-rate]', async (b) => { const p = b.dataset.rate.split('|'); const e = (await sb.rpc('rate_ride', { p_match: p[0], p_up: p[1] === '1', p_comment: null })).error; if (e) { toast(e.message); return; } myRatings[p[0]] = p[1] === '1'; toast('Thanks for rating'); formSig = ''; render(); loadAll(); });
    each('[data-rmode]', (b) => { rideMode = b.dataset.rmode; try { localStorage.setItem('rs_ride_mode', rideMode); } catch (e) { /* storage blocked */ } formSig = ''; render(); });
    each('[data-tview]', (b) => { tripsView = b.dataset.tview; try { localStorage.setItem('rs_trips_view', tripsView); } catch (e) { /* storage blocked */ } render(); });
    each('[data-tmode]', (b) => { tripMode = b.dataset.tmode; try { localStorage.setItem('rs_trip_mode', tripMode); } catch (e) { /* storage blocked */ } formSig = ''; render(); });
    const sendTest = (d) => run(sb.rpc('send_test_request', { p_delay: d }), d ? 'A test rider will ask for a seat in ' + d + ' seconds' : 'A test rider just asked for a seat');
    each('[data-testsend]', (b) => sendTest(+b.dataset.testsend));
    on('ts-send', () => sendTest(+$('ts-delay').value));
    on('ts-mode', () => run(sb.rpc('set_test_mode', { p_on: !testMode }), testMode ? 'Test mode is off' : 'Test mode is on. Start trip, then watch your phone.'));
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
    on('ts-leave-test', () => { const nat = nativeLoc(); if (!nat || !nat.testLeave) { toast('This only works in the Android app (update the app first)'); return; } nat.testLeave({ minutes: 2 }).then(() => toast('Test started. You should get "Leave in 2 minutes" now, then "Time to leave now" 2 minutes later.')).catch((e) => toast('Could not start the test: ' + ((e && e.message) || e))); });
    on('ts-fake-off', () => { const nat = nativeLoc(); if (nat && nat.clearFakeLocation) nat.clearFakeLocation().then(() => toast('Using your real GPS again')); });
    each('[data-stopdrive]', () => { stopShare(true); toast('Driving mode is off'); render(); });
    // Reset trip: start over at any time (after a trip, or when something went wrong).
    const resetTrip = async (end, tid) => {
      const liveT = myLiveTrip && (!tid || tid === myLiveTrip.id) ? myLiveTrip : null, shown = tid ? (myTrips.find((x) => x.id === tid) || null) : myTrip;
      const live = !!liveT, repeating = !!(shown && shown.repeat_days && shown.repeat_days.length);
      const cancelShown = !!shown && (end ? (!liveT && !repeating) : true);   // the Reset trip button cancels the trip shown; ending a drive cancels only the trip that was driven (a live one, or a one-time posted one), never another scheduled trip
      if (!end && !window.confirm((repeating && cancelShown ? 'Stop this repeating trip?' : 'Cancel this trip?') + '\n\nRiders who are not picked up yet are cancelled (their points go back to them). ' + (live ? 'Your Offer a ride now trip is cancelled. ' : '') + (cancelShown ? (repeating ? 'Your repeating trip is cancelled for good, all its days. ' : 'Your posted trip is cancelled. ') : '') + 'Driving mode turns off.\n\nTo cancel all your upcoming trips and rides at once, use Settings > Cancel all upcoming.')) return;
      const todo = matches.filter((x) => x.driver_id === user.id && ((liveT && x.trip_id === liveT.id) || (cancelShown && inFam(x.trip_id, shown))) && (x.status === 'accepted' || x.status === 'requested') && !x.picked_up_at);
      for (const x of todo) { try { await (x.status === 'requested' ? sb.rpc('respond_match', { p_match: x.id, p_accept: false }) : sb.rpc('cancel_ride', { p_match: x.id })); } catch (e) { /* already finished */ } }
      if (liveT) { try { const ce = (await cancelTrip(liveT.id)).error; if (ce) toast(ce.message); } catch (e) { /* ignore */ } }
      if (cancelShown) { try { const ce = (await cancelTrip(shown.id)).error; if (ce) toast(ce.message); } catch (e) { /* ignore */ } }
      resetClientState();
      toast(end ? 'Trip ended. Thank you for driving!' : 'Trip cancelled. You can post a new one.'); await loadAll();
    };
    // Start fresh: cancel everything coming up (trips, requests, booked rides) in one step, keep the history, and look like a first open.
    const startFresh = async () => {
      if (freshBusy) return;
      const t0 = todayStr(), nTrips = myTrips.length + (myLiveTrip ? 1 : 0), nReqs = (myReq ? 1 : 0) + (myLiveReq ? 1 : 0);
      if (matches.some((x) => (x.driver_id === user.id || x.rider_id === user.id) && x.status === 'accepted' && x.picked_up_at && !x.dropped_off_at)) { toast('A ride is under way. Finish it first, then cancel.'); return; }
      const up = matches.filter((x) => (x.status === 'accepted' || x.status === 'requested') && !x.picked_up_at && x.ride_date >= t0 && (x.driver_id === user.id || x.rider_id === user.id));
      const booked = up.filter((x) => x.status === 'accepted').length, plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
      if (!nTrips && !nReqs && !up.length) { resetClientState(); toast('You have nothing upcoming to cancel.'); formSig = ''; render(); return; }
      const bits = []; if (nTrips) bits.push(plural(nTrips, 'trip')); if (nReqs) bits.push(plural(nReqs, 'ride request')); if (booked) bits.push(plural(booked, 'booked ride'));
      if (!window.confirm('Cancel all your upcoming trips and rides?\n\nThis cancels ' + (bits.join(', ') || 'your waiting requests') + '. People booked with you are told, and everyone gets their points back. If you booked a ride as a rider and it is less than 2 hours to pickup, the usual late-cancel rule applies.\n\nYour history, points and settings stay. The app goes back to how it looks when you first open it. This cannot be undone.')) return;
      freshBusy = true; const btn = $('sf-go'); if (btn) btn.disabled = true;
      try {
        let r = await sb.rpc('reset_my_upcoming');
        if (r.error && /reset_my_upcoming/i.test(r.error.message) && /does not exist|schema cache|could not find/i.test(r.error.message)) {   // the database step is not run yet: cancel one by one
          let failed = 0, firstErr = null;
          for (const t of [myLiveTrip, ...myTrips, ...myChildren].filter(Boolean)) { const e = (await cancelTrip(t.id)).error; if (e) { failed++; firstErr = firstErr || e.message; } }
          for (const q of [myLiveReq, myReq].filter(Boolean)) { const e = (await cancelRequest(q.id)).error; if (e) { failed++; firstErr = firstErr || e.message; } }
          r = { data: { failed, first_error: firstErr }, error: null };
        }
        if (r.error) { toast(r.error.message); return; }
        const dd = r.data || {};
        if (dd.failed) { toast('Most things are cancelled, but ' + dd.failed + ' could not be: ' + (dd.first_error || 'see Upcoming')); formSig = ''; await loadAll(); return; }   // something is still on: leave the screens as they are
        resetClientState();
        toast('All your upcoming trips and rides are cancelled.');
        await loadAll();
      } finally { freshBusy = false; }
    };
    on('sf-go', startFresh);
    each('[data-cancelall]', () => startFresh());
    each('[data-reset]', (b) => resetTrip(b.dataset.reset === 'end', b.dataset.tid || null));
    each('[data-startnav]', () => startNav());
    on('ov-hide', async () => { const n = nativeLoc(); try { await n.setBubbleHidden({ hidden: !bubbleHidden }); bubbleHidden = !bubbleHidden; formSig = ''; render(); toast(bubbleHidden ? 'The floating button is hidden.' : 'The floating button will show during rides.'); } catch (e) { toast('Update the app to use this'); } });
    on('ov-go', async () => { const n = nativeLoc(); toast('Opening the setting...'); try { await n.openOverlaySettings(); } catch (e) { toast('Could not open the setting. Open Settings > Apps > RideShare App > Display over other apps.'); } });
    on('dnd-go', async () => { const n = nativeLoc(); toast('Opening the alert settings...'); try { await n.openAlertSettings(); } catch (e) { toast('Could not open the settings. Open Settings > Apps > RideShare App > Notifications > Seat requests.'); } });
    each('[data-edit]', (b) => { editing[b.dataset.edit] = true; formSig = ''; render(); const f = $(b.dataset.edit === 'trip' ? 'ld-form' : 'lr-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    each('[data-editday]', (b) => {
      const [id, d] = b.dataset.editday.split('|'), t0 = myTrips.find((x) => x.id === id) || myTrips.find((x) => myChildren.some((c) => c.id === id && c.series_parent === x.id));
      if (!t0) return;
      selTripId = t0.id; myTrip = t0; detailTripId = null; detailFrom = (window.rsView && window.rsView() === 'trips') ? 'trips' : 'home'; editing.trip = true; editing.newTrip = false; editing.dayOnly = { id: t0.id, d }; pending = null; viewD = d; goHome('post');
    });
    each('[data-restoreday]', (b) => { if (!window.confirm('Put this date back to the repeating trip?\n\nThe changes for this date are dropped.')) return; run(sb.rpc('restore_trip_day', { p_child: b.dataset.restoreday }), 'Put back to the repeating trip'); });
    each('[data-offeropen]', () => { offerOpen = true; detailFrom = 'home'; goHome('now'); });
    each('[data-offerclose]', () => leaveDetails());
    each('[data-homeback]', () => leaveDetails());
    each('[data-gotrips]', () => { if (window.rsGo) window.rsGo('trips'); });
    each('[data-opentrip]', (b) => { const [id, d] = b.dataset.opentrip.split('|'); const mine = myTrips.find((x) => x.id === id); if (mine) { selTripId = id; myTrip = mine; } detailTripId = id; detailFrom = (window.rsView && window.rsView() === 'trips') ? 'trips' : 'home'; viewD = d || null; goHome('trip'); });
    each('[data-openride]', (b) => { viewR = b.dataset.openride || null; detailFrom = (window.rsView && window.rsView() === 'trips') ? 'trips' : 'home'; goHome('ride'); });
    each('[data-starttrip]', (b) => { const [id, d] = b.dataset.starttrip.split('|'); const mine = myTrips.find((x) => x.id === id); if (mine) { selTripId = id; myTrip = mine; } detailTripId = id; detailFrom = 'home'; viewD = d || null; goHome('trip'); setTimeout(() => startNav(), 900); });
    each('[data-tpane]', (b) => { tripsPane = b.dataset.tpane; keep('rs_trips_pane', tripsPane); render(); });
    each('[data-tfw]', (b) => { tf.when = b.dataset.tfw; tf.st = new Set(); saveTf(); render(); });
    each('[data-tfr]', (b) => { tf.role = b.dataset.tfr; tf.st = new Set(); saveTf(); render(); });
    each('[data-tfs]', (b) => { const k = b.dataset.tfs; if (tf.st.has(k)) tf.st.delete(k); else tf.st.add(k); saveTf(); render(); });
    each('[data-tfv]', (b) => { tf.view = b.dataset.tfv; tf.trip = null; saveTf(); render(); });
    each('[data-tft]', (b) => { tf.trip = tf.trip === b.dataset.tft ? null : b.dataset.tft; render(); });
    each('[data-notice-read]', async (b) => { const id = b.dataset.noticeRead; await sb.rpc('mark_notices_read', { p_ids: id === 'all' ? null : [id] }); notices = id === 'all' ? [] : notices.filter((n) => n.id !== id); formSig = ''; render(); loadAll(); });
    each('[data-tfclear]', () => { tf = { when: 'upcoming', role: 'all', st: new Set(), view: 'trip', trip: null }; saveTf(); render(); });
    each('[data-askride]', () => { const rd = $('rs-riding'); if (rd) rd.click(); });   // the Riding side of Home has the Ask for a ride form open
    each('[data-seltrip]', (b) => { selTripId = b.dataset.seltrip; myTrip = myTrips.find((x) => x.id === selTripId) || myTrip; curTrip = myLiveTrip || myTrip; editing.trip = false; editing.newTrip = false; pending = null; viewD = null; mapSig = {}; formSig = ''; render(); });
    each('[data-newtrip]', () => { if (myTrips.length >= 5) { toast('You can keep up to 5 trips. Cancel one first.'); return; } detailFrom = (window.rsView && window.rsView() === 'trips') ? 'trips' : 'home'; editing.trip = true; editing.newTrip = true; pending = null; goHome('post'); });
    each('[data-edit-off]', (b) => { editing[b.dataset.editOff] = false; if (b.dataset.editOff === 'trip') { editing.newTrip = false; editing.dayOnly = null; } pending = null; formSig = ''; plReset('lt-o', 'lt-d', 'lr-p', 'lr-d'); render(); });
    each('[data-scroll]', (b) => { const e = $(b.dataset.scroll); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.querySelectorAll('#ln-o, #ln-d, #rn-p, #rn-d, #rn-pay').forEach((e) => { e.onchange = () => { nowSel[e.id] = e.value; }; });
    wirePlaces();
    on('ln-loc', () => useMyLocation('ln-o', 'ln-msg'));
    // Leave now without offering seats: straight to turn-by-turn directions from where you are.
    on('ln-nav', async () => {
      const d = PL['ln-d'] || LOC[$('ln-d').value];
      if (!d || d.lat == null) { formMsg('ln-msg', 'Choose where you are going from the suggestions first'); return; }
      formMsg('ln-msg', '');
      const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + d.lat + ',' + d.lng, nat = nativeLoc();
      if (!(await goLive())) return;   // starts the offer, the phone helper and the floating button
      if (myLiveTrip) { try { localStorage.setItem('rs_trip_on', myLiveTrip.id); } catch (e) { /* storage blocked */ } formSig = ''; render(); }   // Leave now is the start: no separate Start trip
      if (nat) { try { await nat.openUrl({ url }); return; } catch (e) { /* fall through */ } }
      window.open(url, '_blank', 'noopener');
    });
    on('rn-loc', () => useMyLocation('rn-p', 'rn-msg'));
    const goLive = async () => {
      if (needProfile('drive')) return false;
      const o = $('ln-o').value, d = $('ln-d').value, need = plNeed('ln-o', 'where you start') || plNeed('ln-d', 'where you are going'); if (need) { formMsg('ln-msg', need); return false; }
      if (samePlace(o, d, 'ln-o', 'ln-d')) { formMsg('ln-msg', 'Pick two different places'); return false; }
      formMsg('ln-msg', '');
      const f = myTrip || {}, cols = [plCols('ln-o', 'origin'), plCols('ln-d', 'dest')]; const ok = await run(sb.rpc('go_live_trip', { p_origin: o, p_dest: d, p_max_detour: f.max_detour == null ? S_().d_detour : f.max_detour, p_max_wait: f.max_wait == null ? S_().d_wait : f.max_wait, p_accepts: f.accepts || S_().d_accepts, p_cost_per_km: 0.2, p_minutes: 720, p_max_pickups: Math.min(4, S_().d_seats), p_max_total_detour: Math.min(4, S_().d_seats) > 1 ? Math.max(S_().d_total_detour, f.max_detour == null ? S_().d_detour : f.max_detour) : null }).then(async (r) => { if (!r.error) await setCols('trips', r.data, ...cols); if (!r.error && DKOK) { try { await sb.from('trips').update(kmCols(S_())).eq('id', r.data); } catch (e) { /* ignore */ } } return r; }), 'You are live. Switch it off when you stop driving.');
      if (ok) { viewD = null; mapSig = {}; const nat = nativeLoc(); if (nat) { await dndAsk(nat); if (await startAlerts(nat)) toast('Alerts are on. You will get a phone alert when a rider asks for a seat.'); } }
      return !!ok;
    };
    on('ln-go', goLive);
    const swOn = $('ln-sw'); if (swOn) swOn.onchange = async () => { if (swOn.checked) { const ok = await goLive(); if (!ok) swOn.checked = false; } };
    const swOff = $('ln-sw-off'); if (swOff) swOff.onchange = () => { if (!swOff.checked && myLiveTrip) { if (driveSession && !shouldShare()) stopShare(true); run(cancelTrip(myLiveTrip.id), 'Stopped offering seats'); } };
    on('rn-go', async () => {
      const p = $('rn-p').value, d = $('rn-d').value, need = plNeed('rn-p', 'where to pick you up') || plNeed('rn-d', 'where to drop you off'); if (need) { formMsg('rn-msg', need); return; }
      if (samePlace(p, d, 'rn-p', 'rn-d')) { formMsg('rn-msg', 'Pick two different places'); return; }
      const cols = [plCols('rn-p', 'pickup'), plCols('rn-d', 'dropoff')], exN = plExact('rn-p', 'rn-d');
      const ok = await run(sb.rpc('go_live_request', { p_pickup: p, p_dropoff: d, p_pays: $('rn-pay').value }).then(async (r) => { if (!r.error) { await setCols('ride_requests', r.data, ...cols); await saveExact(r.data, exN); } return r; }), 'Drivers can see you for 20 minutes');
      if (ok) { viewR = null; mapSig = {}; }
    });
    each('[data-stoplive]', (b) => { const isTrip = b.dataset.stoplive === 'trip', row = isTrip ? myLiveTrip : myLiveReq; if (isTrip && driveSession && !shouldShare()) stopShare(true); if (row) run(sb.from(isTrip ? 'trips' : 'ride_requests').update({ active: false }).eq('id', row.id), 'Stopped'); });
    each('#ld-dates button', (b) => { viewD = b.dataset.date; mapSig = {}; render(); });
    each('#lr-dates button', (b) => { viewR = b.dataset.date; mapSig = {}; render(); });
    each('[data-req]', (b) => { if (needProfile('ride')) return; const base = { p_trip: b.dataset.req, p_request: b.dataset.rq, p_pay_with: b.dataset.pay, p_date: b.dataset.date };
      run((async () => { const r = await sb.rpc('request_seat', base); return noFn(r) ? sb.rpc('request_seat', { ...base, p_points: +b.dataset.pts, ...(DKOK ? { p_detour_min: +b.dataset.dmin, p_detour_km: +b.dataset.dkm } : {}) }) : r; })(), 'Seat requested'); });
    each('[data-can]', (b) => run(sb.rpc('cancel_ride', { p_match: b.dataset.can }), 'Cancelled'));
    each('[data-cancelask]', (b) => { askCancel = b.dataset.cancelask; render(); });
    each('[data-cancelno]', () => { askCancel = null; render(); });
    each('[data-cancelgo]', (b) => { askCancel = null; run(sb.rpc('cancel_ride', { p_match: b.dataset.cancelgo }), 'Ride cancelled. See your points history for any refund.'); });
    // Picked up / Dropped off in the app: record it, say what the next stop is, and refresh Google Maps (the same one tap as the notification button)
    each('[data-step]', async (b) => {
      const [id, st] = b.dataset.step.split('|');
      const ok = await run(sb.rpc('ride_step', { p_match: id, p_step: st }), st === 'dropped_off' ? 'Dropped off. That rider\'s ride is complete and the points are paid.' : 'Picked up');
      const nat = nativeLoc();
      if (!ok || !nat || !nat.routeNow || (st !== 'picked_up' && st !== 'dropped_off')) return;
      try {
        const r = await nat.routeNow();
        toast((st === 'picked_up' ? 'Rider is in the car.' : 'Dropped off.') + ' Next stop: ' + (r.text || 'your destination') + (r.url ? '. Updating Google Maps.' : '.'));
        if (r.url) setTimeout(() => { nat.openUrl({ url: r.url }); }, 1500);
      } catch (e) { /* the helper is not running: the stops-changed alert covers it */ }
    });
    each('[data-incar]', (b) => run(sb.rpc('rider_in_car', { p_match: b.dataset.incar }), 'Thanks, confirmed'));
    each('[data-noshow]', (b) => !window.confirm('Is the rider not at the pickup spot?\n\nThe ride closes as a missed pickup and you keep the points. This goes on the rider\'s record.') ? null : run(sb.rpc('mark_no_show', { p_match: b.dataset.noshow }), 'Closed as a missed pickup. You keep the points.'));
    each('[data-acc]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.acc, p_accept: true }), 'Accepted'));
    each('[data-dec]', (b) => run(sb.rpc('respond_match', { p_match: b.dataset.dec, p_accept: false }), 'Declined'));
    each('[data-offtrip]', (b) => !window.confirm((b.dataset.rep ? 'Stop this repeating trip?\n\nAll its remaining dates are cancelled. ' : 'Cancel this trip?\n\n') + 'Riders who are booked are told and get their points back.') ? null : run(cancelTrip(b.dataset.offtrip), b.dataset.rep ? 'Repeating trip stopped' : 'Trip cancelled'));
    each('[data-offreq]', (b) => !window.confirm('Cancel this request?\n\nIf a driver has accepted, the cancellation rules apply.') ? null : run(cancelRequest(b.dataset.offreq), 'Request cancelled'));
    each('[data-go]', (b) => $(b.dataset.go).click());
    ['ln', 'lt', 'lr'].forEach((p) => {
      const e = $(p + '-rep'); if (!e) return;
      e.onchange = () => repUi(p); if ($(p + '-end')) $(p + '-end').onchange = () => repUi(p); repUi(p);
      updatePreview(p);
      ['rep', 'nth', 'dow', 'end', 'until', 'count', 'date'].forEach((k) => { const el = $(p + '-' + k); if (el) el.addEventListener('change', () => updatePreview(p)); });
      const dc = $(p + '-days'); if (dc) dc.addEventListener('click', () => updatePreview(p));
      if (p === 'ln') ['rep', 'nth', 'dow', 'end', 'until', 'count'].forEach((k) => { const el = $(p + '-' + k); if (!el) return; const prev = el.onchange; el.onchange = () => { LV[p + '-' + k] = el.value; if (prev) prev(); }; });
    });
    { const au = $('ln-auto'); if (au) au.onchange = () => { LV['ln-auto'] = au.checked ? '1' : '0'; }; }
    each('[data-skipday]', (b) => { if (!window.confirm('Skip this date?\n\nRiders booked on it are cancelled and get their points back. The trip carries on the other dates.')) return; const [tp, ds] = b.dataset.skipday.split('|'); run(sb.rpc('skip_trip_day', { p_trip: tp, p_date: ds }), 'Day skipped'); });
    each('[data-unskipday]', (b) => { const [tp, ds] = b.dataset.unskipday.split('|'); run(sb.rpc('unskip_trip_day', { p_trip: tp, p_date: ds }), 'The day is back on'); });
    each('[data-edittrip]', (b) => {
      const tt = [...myTrips, myLiveTrip].find((x) => x && x.id === b.dataset.edittrip), nc = tt ? confirmedDates(tt) : 0;
      if (nc) { window.alert('Riders are confirmed on ' + nc + (nc === 1 ? ' date' : ' dates') + ' of this trip, so it can no longer be changed.\n\nYou can still change one date that has no confirmed rider: open that date and tap Change this date. To change all of it: cancel the trip (the riders are told and get their points back), then create a new one.'); return; }
      selTripId = b.dataset.edittrip; myTrip = myTrips.find((x) => x.id === selTripId) || myTrip; detailTripId = null; detailFrom = (window.rsView && window.rsView() === 'trips') ? 'trips' : 'home'; editing.trip = true; editing.newTrip = false; pending = null; viewD = null; goHome('post');
    });
    each('[data-calday]', (b) => { calDay = calDay === b.dataset.calday ? null : b.dataset.calday; render(); });
    each('[data-calmove]', (b) => { const [yy, mm] = calMonth.split('-').map(Number), nd = new Date(yy, mm - 1 + (+b.dataset.calmove), 1); calMonth = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0'); calDay = null; render(); });
    each('[data-lostgo]', (b) => { viewR = b.dataset.lostgo; detailFrom = 'home'; goHome('ride'); });
    each('[data-stopseries]', (b) => { if (!window.confirm('End this regular booking?\n\nThe coming days with this person are cancelled (any points go back) and no new days are booked by themselves. Days already finished stay as they are.')) return; const [tp, rq] = b.dataset.stopseries.split('|'); run(sb.rpc('stop_series', { p_trip: tp, p_request: rq }), 'Regular booking ended'); });
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
  window.addEventListener('rs-google-ready', () => { mapSig = {}; if (!PLOK && user) { loadAll(); } render(); if (lastPos) applyMe(false); });
  ['t-driver', 't-rider', 't-upcoming', 't-wallet'].forEach((id) => $(id).addEventListener('click', () => { mapSig = {}; render(); loadAll(); }));
})();
