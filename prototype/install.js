// Install-as-app prompt (PWA) + service worker registration.
// Android/desktop Chrome: shows an Install banner using the browser's install prompt.
// iPhone/iPad: Apple allows no automatic prompt, so show a short "Share > Add to Home Screen" tip.
(function () {
  'use strict';
  const bar = document.getElementById('install-bar');
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!bar || standalone) return;
  const KEY = 'rs-install-dismissed';
  const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 864e5; } catch (e) { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} };
  const hide = () => { bar.classList.add('hide'); bar.innerHTML = ''; };
  const card = (msg, buttons) => `<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between;margin-bottom:0"><span><b>Get the app.</b> ${msg}</span><span>${buttons}</span></div>`;
  let deferred = null;
  function showInstall() {
    if (dismissedRecently()) return;
    bar.innerHTML = card('Add RideShare to your home screen for one-tap access.', '<button class="btn" id="inst-go">Install app</button> <button class="btn ghost" id="inst-no">Not now</button>');
    bar.classList.remove('hide');
    document.getElementById('inst-go').onclick = async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (e) {} deferred = null; hide(); };
    document.getElementById('inst-no').onclick = () => { remember(); hide(); };
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; showInstall(); });
  window.addEventListener('appinstalled', hide);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !dismissedRecently()) {
    bar.innerHTML = card('On iPhone: tap the <b>Share</b> button, then <b>Add to Home Screen</b>.', '<button class="btn ghost" id="inst-no">Got it</button>');
    bar.classList.remove('hide');
    document.getElementById('inst-no').onclick = () => { remember(); hide(); };
  }
})();
