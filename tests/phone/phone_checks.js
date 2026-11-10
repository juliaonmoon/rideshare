(async () => {
  const out = {};
  const cfg = window.RS_CONFIG;
  out.version = cfg.version;
  const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
  let tok = null; try { tok = JSON.parse(localStorage.getItem(key)).access_token; } catch (e) { /* not signed in */ }
  out.signedIn = !!tok;
  const H = { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + (tok || cfg.supabaseKey), 'Content-Type': 'application/json' };
  const u = cfg.supabaseUrl + '/rest/v1/';
  const call = async (name, body) => { const r = await fetch(u + 'rpc/' + name, { method: 'POST', headers: H, body: JSON.stringify(body) }); let t = ''; try { t = (await r.text()).slice(0, 120); } catch (e) { /* none */ } return r.status + ' ' + t; };
  const zero = '00000000-0000-0000-0000-000000000000';
  out.pickup_eta_installed_060 = await call('pickup_eta', { p_match: zero });
  out.cancel_ride_exists = await call('cancel_ride', { p_match: zero });
  const r = await fetch(u + 'reliability?select=user_id,rides_as_rider,rides_as_driver,driver_late_cancels&limit=1', { headers: H });
  out.reliability_058 = r.status + ' ' + (await r.text()).slice(0, 80);
  const src = await (await fetch('live.js?x=' + Date.now())).text();
  out.strings = ['Driver did not arrive', 'Cancel free until', 'Update route in Google Maps', 'data-etakeep', 'RideShare is not a taxi', 'New member', 'ride_cancelled_by_rider'].map((s) => s + ': ' + src.includes(s));
  return JSON.stringify(out, null, 1);
})()
