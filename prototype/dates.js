// Date helpers for trips and requests: one-off dates and weekly repeats. Dates are 'YYYY-MM-DD' strings in the user's local time.
// Days use ISO numbers: 1 = Mon ... 7 = Sun. Runs in the browser (window.RSD) and in Node (module.exports) for tests.
(function (root) {
  'use strict';
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MIN_LEAD_MIN = 30;   // like Uber: at least 30 minutes ahead
  const MAX_AHEAD_DAYS = 30; // like Uber: up to 30 days ahead

  const pad = (n) => String(n).padStart(2, '0');
  const toStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDow = (s) => { const g = parse(s).getDay(); return g === 0 ? 7 : g; };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
  const today = (now) => toStr(now || new Date());

  // Does an item (base date + optional weekly repeat days) happen on this date?
  function occursOn(baseDate, repeatDays, date) {
    if (!baseDate || !date) return false;
    if (date === baseDate) return true;
    return Array.isArray(repeatDays) && repeatDays.length > 0 && date > baseDate && repeatDays.includes(isoDow(date));
  }
  // The next dates (from today, up to `max` of them, within the booking window) on which an item happens.
  function nextOccurrences(baseDate, repeatDays, now, max) {
    const t = today(now), out = [];
    for (let i = 0; i <= MAX_AHEAD_DAYS && out.length < (max || 7); i++) {
      const d = addDays(t, i);
      if (occursOn(baseDate, repeatDays, d)) out.push(d);
    }
    return out;
  }
  // 'Today', 'Tomorrow', or 'Mon Oct 20'
  function label(date, now) {
    const t = today(now);
    if (date === t) return 'Today';
    if (date === addDays(t, 1)) return 'Tomorrow';
    return DAY_NAMES[isoDow(date) - 1] + ' ' + parse(date).toLocaleString('en-CA', { month: 'short' }) + ' ' + parse(date).getDate();
  }
  // 'Mon Tue Wed' for a repeat list, '' if none
  const repeatText = (days) => (days || []).slice().sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1]).join(' ');
  // Is this date/time allowed? Returns '' if fine, else a plain-language reason.
  function check(date, minutes, now) {
    const n = now || new Date(), t = today(n);
    if (!date) return 'Pick a date';
    if (date < t) return 'That date has passed';
    if (date > addDays(t, MAX_AHEAD_DAYS)) return 'You can book up to ' + MAX_AHEAD_DAYS + ' days ahead';
    if (date === t && minutes < n.getHours() * 60 + n.getMinutes() + MIN_LEAD_MIN) return 'Pick a time at least ' + MIN_LEAD_MIN + ' minutes from now';
    return '';
  }
  // The exact moment (epoch ms) of a date + minutes-since-midnight in Vancouver time (same rule the database uses).
  function vanEpoch(date, minutes) {
    const [y, m, d] = date.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d, 0, minutes);
    let guess = target;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (let i = 0; i < 2; i++) {
      const parts = fmt.formatToParts(new Date(guess)); const g = (k) => +parts.find((p) => p.type === k).value;
      guess -= Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - target;
    }
    return guess;
  }
  // Same calendar month in Vancouver time?
  const vanMonth = (epoch) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit' }).format(new Date(epoch));
  const RSD = { DAY_NAMES, MIN_LEAD_MIN, MAX_AHEAD_DAYS, toStr, parse, isoDow, addDays, today, occursOn, nextOccurrences, label, repeatText, check, vanEpoch, vanMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = RSD; else root.RSD = RSD;
})(typeof window !== 'undefined' ? window : globalThis);
