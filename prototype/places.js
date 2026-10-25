// Address search (Google Places API, new version). Used by the trip and ride forms.
// If Google refuses (the feature is not switched on for the key yet), available() turns false and the forms fall back to the neighbourhood list.
(function () {
  const KEY = () => (window.RS_CONFIG && window.RS_CONFIG.googleMapsKey) || '';
  const BASE = 'https://places.googleapis.com/v1/';
  // Search is biased to Metro Vancouver and the Fraser Valley, but BC-wide results still appear.
  const BIAS = { circle: { center: { latitude: 49.17, longitude: -122.85 }, radius: 50000 } };
  let down = false, token = newToken();
  function newToken() { return (self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-zA-Z0-9-]/g, ''); }

  async function suggest(q) {
    if (down || !KEY()) return [];
    let r;
    try {
      r = await fetch(BASE + 'places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY() },
        body: JSON.stringify({ input: q, sessionToken: token, includedRegionCodes: ['ca'], locationBias: BIAS }),
      });
    } catch (e) { return []; }                       // offline: try again on the next keystroke
    if (r.status === 403) { down = true; return []; }   // the key is not allowed to use address search yet
    if (!r.ok) return [];
    const j = await r.json();
    return (j.suggestions || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => {
      const p = s.placePrediction, f = p.structuredFormat || {};
      return { id: p.placeId, main: (f.mainText && f.mainText.text) || (p.text && p.text.text) || '', sub: (f.secondaryText && f.secondaryText.text) || '' };
    });
  }

  // The map point of a suggestion. Ending the search session here keeps Google's billing to one search.
  async function details(id) {
    const r = await fetch(BASE + 'places/' + encodeURIComponent(id) + '?sessionToken=' + token, { headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'location,displayName' } });
    token = newToken();
    if (!r.ok) throw new Error('Could not load that place');
    const j = await r.json();
    return { lat: j.location.latitude, lng: j.location.longitude, name: (j.displayName && j.displayName.text) || '' };
  }

  window.RS_PLACES = { suggest, details, available: () => !down && !!KEY(), markDown: () => { down = true; } };
})();
