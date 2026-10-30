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
    const r = await fetch(BASE + 'places/' + encodeURIComponent(id) + '?sessionToken=' + token, { headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'location' } });
    token = newToken();
    if (!r.ok) throw new Error('Could not load that place');
    const j = await r.json();
    return { lat: j.location.latitude, lng: j.location.longitude, name: '' };
  }

  // The street address at a point (for Use my location). First choice: Google's address lookup (Geocoding), the same one Google Maps uses when you drop a pin.
  // If that is not switched on for the key yet, fall back to the closest place Google knows within 150 m.
  let geoDown = false;
  function geocode(lat, lng) {
    return new Promise((resolve) => {
      try {
        if (geoDown || !(window.google && google.maps && google.maps.Geocoder)) return resolve('');
        new google.maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
          if (status === 'REQUEST_DENIED') { geoDown = true; return resolve(''); }
          if (status !== 'OK' || !results || !results.length) return resolve('');
          const best = results.find((r) => r.types.includes('street_address') || r.types.includes('premise')) || results[0];
          resolve(best.formatted_address.split(',').slice(0, 2).join(',').trim());
        });
      } catch (e) { resolve(''); }
    });
  }
  async function where(lat, lng) {
    const g = await geocode(lat, lng); if (g) return g;
    if (down || !KEY()) return '';
    try {
      const r = await fetch(BASE + 'places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'places.formattedAddress' },
        body: JSON.stringify({ maxResultCount: 1, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 150 } } }),
      });
      if (r.status === 403) { down = true; return ''; }
      if (!r.ok) return '';
      const j = await r.json(), a = j.places && j.places[0] && j.places[0].formattedAddress;
      return a ? a.split(',').slice(0, 2).join(',').trim() : '';
    } catch (e) { return ''; }
  }

  window.RS_PLACES = { suggest, details, where, available: () => !down && !!KEY(), markDown: () => { down = true; }, exactAddress: () => !geoDown };
})();
