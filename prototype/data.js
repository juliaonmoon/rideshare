// DEMO DATA ONLY. Coordinates are approximate area centres, not exact addresses. Riders and drivers are made up.
window.DEMO = (function () {
  const L = {
    'Surrey Central': { lat: 49.1890, lng: -122.8490 },
    'Guildford (Surrey)': { lat: 49.1910, lng: -122.8010 },
    'Fleetwood (Surrey)': { lat: 49.1530, lng: -122.7950 },
    'Newton (Surrey)': { lat: 49.1330, lng: -122.8450 },
    'Cloverdale (Surrey)': { lat: 49.1050, lng: -122.7350 },
    'South Surrey': { lat: 49.0500, lng: -122.8000 },
    'Port Coquitlam': { lat: 49.2630, lng: -122.7810 },
    'Lougheed (Burnaby)': { lat: 49.2484, lng: -122.8970 },
    'Production Way (Burnaby)': { lat: 49.2539, lng: -122.9181 },
    'SFU Burnaby': { lat: 49.2781, lng: -122.9199 },
    'Brentwood (Burnaby)': { lat: 49.2665, lng: -123.0007 },
    'BCIT / Willingdon (Burnaby)': { lat: 49.2490, lng: -123.0000 },
    'Metrotown (Burnaby)': { lat: 49.2276, lng: -123.0076 },
    'Whalley (Surrey)': { lat: 49.1950, lng: -122.8650 },
    'Pattullo Bridge (New West)': { lat: 49.2060, lng: -122.9000 },
    'Edmonds (Burnaby)': { lat: 49.2124, lng: -122.9591 },
    'Royal Oak (Burnaby)': { lat: 49.2200, lng: -122.9880 },
    'Braid (New West)': { lat: 49.2330, lng: -122.8820 },
    'Sperling (Burnaby)': { lat: 49.2590, lng: -122.9640 },
  };
  const h = (hh, mm) => hh * 60 + (mm || 0);
  // readyFrom/readyTo = window in which the rider can be picked up.
  const riders = [
    // Along or near a Surrey Central -> BCIT commute (good matches for the default driver)
    { id: 'r1',  name: 'Alex',   pickup: L['Whalley (Surrey)'],          dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,25), readyTo: h(7,50), pays: 'points' },
    { id: 'r2',  name: 'Priya',  pickup: L['Surrey Central'],            dropoff: L['Edmonds (Burnaby)'],           readyFrom: h(7,20), readyTo: h(7,45), pays: 'cash' },
    { id: 'r3',  name: 'Sam',    pickup: L['Pattullo Bridge (New West)'],dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,35), readyTo: h(8,5),  pays: 'points' },
    { id: 'r4',  name: 'Jordan', pickup: L['Whalley (Surrey)'],          dropoff: L['Royal Oak (Burnaby)'],         readyFrom: h(7,30), readyTo: h(7,55), pays: 'either' },
    { id: 'r5',  name: 'Dana',   pickup: L['Surrey Central'],            dropoff: L['Brentwood (Burnaby)'],         readyFrom: h(7,25), readyTo: h(8,5),  pays: 'cash' },
    { id: 'r6',  name: 'Mei',    pickup: L['Edmonds (Burnaby)'],         dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,45), readyTo: h(8,15), pays: 'points' },
    // Other corridors (show up for other drivers, or get filtered out by detour / time / payment)
    { id: 'r7',  name: 'Chris',  pickup: L['South Surrey'],              dropoff: L['Brentwood (Burnaby)'],         readyFrom: h(6,30), readyTo: h(7,0),  pays: 'points' },
    { id: 'r8',  name: 'Noor',   pickup: L['Guildford (Surrey)'],        dropoff: L['Production Way (Burnaby)'],    readyFrom: h(7,15), readyTo: h(7,50), pays: 'points' },
    { id: 'r9',  name: 'Pat',    pickup: L['Fleetwood (Surrey)'],        dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,20), readyTo: h(7,45), pays: 'cash' },
    { id: 'r10', name: 'Sam T.', pickup: L['Newton (Surrey)'],           dropoff: L['Metrotown (Burnaby)'],         readyFrom: h(7,10), readyTo: h(7,40), pays: 'points' },
    { id: 'r11', name: 'Jo',     pickup: L['Cloverdale (Surrey)'],       dropoff: L['Lougheed (Burnaby)'],          readyFrom: h(7,0),  readyTo: h(7,20), pays: 'cash' },
    { id: 'r12', name: 'Leah',   pickup: L['Port Coquitlam'],            dropoff: L['SFU Burnaby'],                 readyFrom: h(7,30), readyTo: h(8,0),  pays: 'either' },
    // Extra test riders for the default driver (Surrey Central -> BCIT, leaves 07:30, detour 10, wait 5, accepts either)
    { id: 'r13', name: 'Riley',  pickup: L['Surrey Central'],           dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,30), readyTo: h(7,45), pays: 'points' },
    { id: 'r14', name: 'Casey',  pickup: L['Whalley (Surrey)'],          dropoff: L['Metrotown (Burnaby)'],         readyFrom: h(7,25), readyTo: h(7,55), pays: 'cash' },
    { id: 'r15', name: 'Avery',  pickup: L['Pattullo Bridge (New West)'],dropoff: L['Royal Oak (Burnaby)'],         readyFrom: h(7,40), readyTo: h(8,10), pays: 'either' },
    { id: 'r16', name: 'Blake',  pickup: L['Braid (New West)'],          dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,45), readyTo: h(8,15), pays: 'points' },
    { id: 'r17', name: 'Ellis',  pickup: L['Surrey Central'],            dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(6,0),  readyTo: h(6,30), pays: 'points' },
    { id: 'r18', name: 'Frankie',pickup: L['Port Coquitlam'],            dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,30), readyTo: h(8,0),  pays: 'cash' },
  ];
  // Seeded drivers for the Rider tab.
  const drivers = [
    { id: 'd1', name: 'Taylor', origin: L['Surrey Central'],     dest: L['BCIT / Willingdon (Burnaby)'], departMin: h(7,30), maxDetour: 8,  maxWait: 5,  accepts: 'either' },
    { id: 'd2', name: 'Robin',  origin: L['Fleetwood (Surrey)'], dest: L['Brentwood (Burnaby)'],         departMin: h(7,20), maxDetour: 10, maxWait: 8,  accepts: 'points' },
    { id: 'd3', name: 'Kim',    origin: L['Newton (Surrey)'],    dest: L['Metrotown (Burnaby)'],         departMin: h(7,15), maxDetour: 6,  maxWait: 5,  accepts: 'cash' },
    { id: 'd4', name: 'Lee',    origin: L['Guildford (Surrey)'], dest: L['SFU Burnaby'],                 departMin: h(8,0),  maxDetour: 12, maxWait: 10, accepts: 'either' },
    { id: 'd5', name: 'Ana',    origin: L['Whalley (Surrey)'],   dest: L['Brentwood (Burnaby)'],         departMin: h(7,25), maxDetour: 9,  maxWait: 6,  accepts: 'either' },
    { id: 'd6', name: 'Omar',   origin: L['Guildford (Surrey)'], dest: L['Production Way (Burnaby)'],    departMin: h(7,20), maxDetour: 8,  maxWait: 6,  accepts: 'points' },
  ];
  return { locations: L, riders, drivers };
})();
