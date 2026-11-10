import http from 'http';
// Fake RideShare database for the driver's route alert. GET /rides?set=id:stage:Name,id:stage:Name  sets who is on the trip.
const st = { rides: [], polls: 0 };
http.createServer((q, r) => {
  let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => {
    const u = new URL(q.url, 'http://x');
    const j = (code, o) => { r.writeHead(code, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (u.pathname === '/rides') {
      st.rides = (u.searchParams.get('set') || '').split(',').filter(Boolean).map((s, i) => { const [id, stage, name] = s.split(':'); return { id, stage, name, pickup_name: 'Pickup ' + name, dropoff_name: 'Dropoff ' + name, lat: 49.2 + i * 0.02, lng: -122.9 - i * 0.02 }; });
      return j(200, st);
    }
    if (u.pathname.endsWith('/driver_alerts_token')) { st.polls++; return j(200, { ride: false, active: true, pending: [], rides: st.rides.map(({ id, stage, name, pickup_name, dropoff_name }) => ({ id, stage, name, pickup_name, dropoff_name })), dest_lat: 49.2665, dest_lng: -123.0007 }); }
    if (u.pathname.endsWith('/driver_route_token')) {
      const stops = [];
      for (const x of st.rides) {
        if (x.stage !== 'picked_up') stops.push({ match_id: x.id, name: x.name, type: 'pick', lat: x.lat, lng: x.lng });
        stops.push({ match_id: x.id, name: x.name, type: 'drop', lat: x.lat + 0.05, lng: x.lng + 0.05 });
      }
      return j(200, { stops, dest_lat: 49.2665, dest_lng: -123.0007 });
    }
    if (u.pathname.endsWith('/rider_alerts_token')) return j(200, { active: false, rides: [] });
    if (u.pathname.endsWith('/share_position_token')) return j(400, { message: 'No ride in progress' });
    j(404, { message: 'nope' });
  });
}).listen(8780, () => console.log('fake server 4 on 8780'));
