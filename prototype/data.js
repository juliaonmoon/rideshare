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
  };
  const h = (hh, mm) => hh * 60 + (mm || 0);
  // readyFrom/readyTo = window in which the rider can be picked up.
  const riders = [
    { id: 'r1', name: 'Alex',   pickup: L['Guildford (Surrey)'],     dropoff: L['Production Way (Burnaby)'],   readyFrom: h(7,15), readyTo: h(7,50), pays: 'points' },
    { id: 'r2', name: 'Priya',  pickup: L['Fleetwood (Surrey)'],     dropoff: L['BCIT / Willingdon (Burnaby)'], readyFrom: h(7,20), readyTo: h(7,45), pays: 'cash' },
    { id: 'r3', name: 'Sam',    pickup: L['Newton (Surrey)'],        dropoff: L['Metrotown (Burnaby)'],        readyFrom: h(7,10), readyTo: h(7,40), pays: 'points' },
    { id: 'r4', name: 'Jordan', pickup: L['Cloverdale (Surrey)'],    dropoff: L['Lougheed (Burnaby)'],         readyFrom: h(7,0),  readyTo: h(7,20), pays: 'cash' },
    { id: 'r5', name: 'Mei',    pickup: L['Port Coquitlam'],         dropoff: L['SFU Burnaby'],                readyFrom: h(7,30), readyTo: h(8,0),  pays: 'either' },
    { id: 'r6', name: 'Chris',  pickup: L['South Surrey'],           dropoff: L['Brentwood (Burnaby)'],        readyFrom: h(6,30), readyTo: h(7,0),  pays: 'points' },
    { id: 'r7', name: 'Dana',   pickup: L['Surrey Central'],         dropoff: L['Brentwood (Burnaby)'],        readyFrom: h(7,25), readyTo: h(8,5),  pays: 'cash' },
  ];
  // Seeded drivers for the Rider tab.
  const drivers = [
    { id: 'd1', name: 'Taylor', origin: L['Surrey Central'],   dest: L['BCIT / Willingdon (Burnaby)'], departMin: h(7,30), maxDetour: 8,  maxWait: 5,  accepts: 'either' },
    { id: 'd2', name: 'Robin',  origin: L['Fleetwood (Surrey)'], dest: L['Brentwood (Burnaby)'],       departMin: h(7,20), maxDetour: 10, maxWait: 8,  accepts: 'points' },
    { id: 'd3', name: 'Kim',    origin: L['Newton (Surrey)'],  dest: L['Metrotown (Burnaby)'],        departMin: h(7,15), maxDetour: 6,  maxWait: 5,  accepts: 'cash' },
    { id: 'd4', name: 'Lee',    origin: L['Guildford (Surrey)'], dest: L['SFU Burnaby'],              departMin: h(8,0),  maxDetour: 12, maxWait: 10, accepts: 'either' },
  ];
  return { locations: L, riders, drivers };
})();
