// ═══════════════════════════════════════
//  ARIA GPS — Stations Essence
//  Source prix : Prix-Carburants API + OSM
// ═══════════════════════════════════════

let stationMarkers = [];
let stationsData = [];
let activeStationPopup = null;
let upcomingAlertShown = new Set();

let selectedStationId = null;
let stationClickLockUntil = 0;
let stationsVisible = true;

const BRANDS = {
  'total':         { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  'totalenergies': { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  'bp':            { color: '#007A33', bg: '#E8F5EE', abbr: 'BP', full: 'BP' },
  'shell':         { color: '#D4A800', bg: '#FFFBEA', abbr: 'SH', full: 'Shell' },
  'esso':          { color: '#003087', bg: '#E8EDF8', abbr: 'ES', full: 'Esso' },
  'auchan':        { color: '#E63B2E', bg: '#FFF0EF', abbr: 'AU', full: 'Auchan' },
  'carrefour':     { color: '#0066CC', bg: '#E6F0FA', abbr: 'CF', full: 'Carrefour' },
  'leclerc':       { color: '#0066CC', bg: '#E6F0FA', abbr: 'LC', full: 'E.Leclerc' },
  'intermarche':   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'IT', full: 'Intermarche' },
  'casino':        { color: '#2E7D32', bg: '#E8F5E9', abbr: 'CA', full: 'Casino' },
  'systeme u':     { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Systeme U' },
  'super u':       { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Super U' },
  'nf':            { color: '#555',    bg: '#F5F5F5', abbr: 'NF', full: 'NF' },
  'dyneff':        { color: '#FF6B00', bg: '#FFF3E8', abbr: 'DY', full: 'Dyneff' },
  'default':       { color: '#374151', bg: '#F3F4F6', abbr: '⛽', full: 'Station' },
};

const FUEL_LABELS = {
  'Gazole': { label: 'Diesel',  icon: '🟡', color: '#F59E0B' },
  'SP95':   { label: 'SP95',    icon: '🟢', color: '#10B981' },
  'SP98':   { label: 'SP98',    icon: '🔵', color: '#3B82F6' },
  'E10':    { label: 'E10',     icon: '🟢', color: '#34D399' },
  'E85':    { label: 'E85',     icon: '🌿', color: '#6EE7B7' },
  'GPLc':   { label: 'GPL',     icon: '🔵', color: '#8B5CF6' },
  'HVO100': { label: 'HVO100',  icon: '🌱', color: '#059669' },
};

function getBrand(name) {
  if (!name) return BRANDS['default'];
  const key = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(BRANDS)) {
    if (k !== 'default' && key.includes(k)) return v;
  }
  return { ...BRANDS['default'], abbr: name.slice(0, 2).toUpperCase(), full: name };
}

function getStationId(station) {
  return station?.govId || station?.id || `${station?.lat}-${station?.lng}-${station?.name || ''}`;
}

function getVisibleStations(stations) {
  const isMobile = window.innerWidth <= 768;
  const maxStations = isMobile ? 20 : 60;

  let visibleStations = [...stations].filter(s => s.lat && s.lng);

  if (userLocation && userLocation.lat && userLocation.lng) {
    visibleStations.sort((a, b) => {
      const da = haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng);
      const db = haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
      return da - db;
    });
  }

  return visibleStations.slice(0, maxStations);
}

// ── CHARGEMENT PRINCIPAL ──────────────────────

async function loadStationsAlongRoute(routeCoords) {
  if (!routeCoords || !routeCoords.length) return;
  const lngs = routeCoords.map(c => c[0]);
  const lats = routeCoords.map(c => c[1]);
  await loadStationsInBbox(
    Math.min(...lats) - 0.15, Math.max(...lats) + 0.15,
    Math.min(...lngs) - 0.15, Math.max(...lngs) + 0.15
  );
}

async function loadStationsNearUser(lat, lng, radiusKm = 15) {
  const deg = radiusKm / 111;
  await loadStationsInBbox(lat - deg, lat + deg, lng - deg, lng + deg);
}

async function loadStationsInBbox(minLat, maxLat, minLng, maxLng) {
  try {
    showToast('Recherche des stations carburant...');

    const stations = await fetchStationsFromOSM(minLat, maxLat, minLng, maxLng);
    const prices = await fetchPricesGouvernement(minLat, maxLat, minLng, maxLng);

    const merged = mergeStationsAndPrices(stations, prices);
    stationsData = merged;

    // évite un rerender parasite juste après un clic station
    if (Date.now() < stationClickLockUntil) return;
    if (!stationsVisible) return;

    clearStationMarkers(false);
    renderStationMarkers(merged);

    if (merged.length > 0) {
      const shown = getVisibleStations(merged).length;
      const isMobile = window.innerWidth <= 768;
      showToast(
        isMobile && merged.length > shown
          ? `${shown} stations affichées sur ${merged.length}`
          : `${merged.length} stations trouvées`
      );
    }
  } catch (err) {
    console.error('Stations error:', err);
  }
}

// ── OSM : LOCALISATION ────────────────────────

async function fetchStationsFromOSM(minLat, maxLat, minLng, maxLng) {
  const query = `[out:json][timeout:20];(node["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});way["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng}););out body center;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
    });
    const data = await res.json();
    return (data.elements || []).map(el => ({
      id: 'osm-' + el.id,
      lat: el.lat || el.center?.lat,
      lng: el.lon || el.center?.lon,
      name: el.tags?.brand || el.tags?.name || el.tags?.operator || 'Station',
      brand: el.tags?.brand || el.tags?.name || '',
      address: [el.tags?.['addr:housenumber'], el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(' '),
      services: parseOSMServices(el.tags || {}),
      openingHours: el.tags?.['opening_hours'] || '',
      prices: {},
      govId: null,
    })).filter(s => s.lat && s.lng);
  } catch (err) {
    console.warn('OSM error:', err);
    return [];
  }
}

function parseOSMServices(tags) {
  const s = [];
  if (tags['toilets'] === 'yes' || tags['amenity:toilets'] === 'yes') s.push('Toilettes');
  if (tags['shop'] === 'convenience') s.push('Boutique');
  if (tags['restaurant'] === 'yes') s.push('Restaurant');
  if (tags['car_wash'] === 'yes') s.push('Lavage');
  if (tags['wifi'] === 'yes') s.push('Wifi');
  return s;
}

// ── PRIX CARBURANTS : API GOUVERNEMENTALE ─────

async function fetchPricesGouvernement(minLat, maxLat, minLng, maxLng) {
  const centerLat = ((minLat + maxLat) / 2).toFixed(4);
  const centerLng = ((minLng + maxLng) / 2).toFixed(4);

  try {
    const url = `https://api.prix-carburants.economie.gouv.fr/stations/around/${centerLat}/${centerLng}/25000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch {}

  try {
    const url = `https://data.prix-carburants.gouv.fr/api/v1/stations?lat=${centerLat}&lon=${centerLng}&rayon=25000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.stations || data.results || []);
      if (list.length) return list;
    }
  } catch {}

  try {
    const url = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://api.prix-carburants.economie.gouv.fr/stations/around/${centerLat}/${centerLng}/25000`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const wrapper = await res.json();
      const data = JSON.parse(wrapper.contents || '[]');
      if (Array.isArray(data) && data.length) return data;
    }
  } catch {}

  return [];
}

function mergeStationsAndPrices(osmStations, govData) {
  if (!govData || !govData.length) return osmStations;

  govData.forEach(gov => {
    let gLat = parseFloat(gov.latitude || gov.Latitude || gov.lat || 0);
    let gLng = parseFloat(gov.longitude || gov.Longitude || gov.lng || 0);
    if (Math.abs(gLat) > 90) gLat /= 100000;
    if (Math.abs(gLng) > 180) gLng /= 100000;
    if (!gLat || !gLng) return;

    let best = null, bestDist = 0.5;
    osmStations.forEach(s => {
      const d = haversineKm(s.lat, s.lng, gLat, gLng);
      if (d < bestDist) { bestDist = d; best = s; }
    });

    if (best) {
      best.prices = parsePricesFromGov(gov);
      best.govId = gov.id;
    } else {
      osmStations.push({
        id: 'gov-' + (gov.id || Math.random()),
        lat: gLat, lng: gLng,
        name: gov.Enseignes || gov.enseignes || gov.brand || 'Station',
        brand: gov.Enseignes || gov.enseignes || '',
        address: gov.adresse || gov.Adresse || '',
        services: [],
        openingHours: '',
        prices: parsePricesFromGov(gov),
        govId: gov.id,
      });
    }
  });

  return osmStations;
}

function parsePricesFromGov(station) {
  const prices = {};
  const fuels = station.Prix || station.prix || station.carburants || station.prices || [];
  if (Array.isArray(fuels)) {
    fuels.forEach(f => {
      const name = f['@nom'] || f.nom || f.name || f.type;
      const val = f['@valeur'] || f.valeur || f.value || f.prix || f.price;
      if (name && val) {
        const price = parseFloat(val);
        prices[name] = price > 10 ? price / 1000 : price;
      }
    });
  }
  ['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'].forEach(fuel => {
    if (station[fuel] !== undefined) {
      const v = parseFloat(station[fuel]);
      if (v > 0) prices[fuel] = v > 10 ? v / 1000 : v;
    }
  });
  return prices;
}

// ── RENDU MARQUEURS ───────────────────────────

function renderStationMarkers(stations) {
  if (!stationsVisible) return;

  const visibleStations = getVisibleStations(stations);

  visibleStations.forEach(s => {
    if (!s.lat || !s.lng) return;

    const brand = getBrand(s.brand || s.name);
    const diesel = s.prices['Gazole'];
    const stationId = getStationId(s);
    const isSelected = selectedStationId && selectedStationId === stationId;

    const el = document.createElement('div');
    el.style.cssText = `
      background:${brand.bg};
      border:${isSelected ? '3px' : '2px'} solid ${brand.color};
      border-radius:10px;
      padding:4px 6px 2px;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:1px;
      cursor:pointer;
      min-width:36px;
      text-align:center;
      filter:${isSelected ? 'drop-shadow(0 0 10px rgba(0,212,255,0.9))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))'};
      transition:transform 0.15s;
      font-family:'Syne',sans-serif;
      z-index:${isSelected ? '20' : '1'};
    `;

    el.innerHTML = `
      <div style="font-size:11px;font-weight:800;color:${brand.color};line-height:1">${brand.abbr}</div>
      ${diesel ? `<div style="font-size:9px;font-weight:500;color:${brand.color};font-family:'DM Mono',monospace">€${diesel.toFixed(3)}</div>` : '<div style="font-size:9px;color:#999">⛽</div>'}
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${brand.color};margin-top:2px"></div>
    `;

    el.addEventListener('mouseenter', () => {
      el.style.transform = isSelected ? 'scale(1.14) translateY(-4px)' : 'scale(1.1) translateY(-3px)';
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = isSelected ? 'scale(1.08) translateY(-2px)' : '';
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openStationPopup(s);
    });

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([s.lng, s.lat])
      .addTo(map);

    stationMarkers.push({ marker, station: s, el });
  });
}

// ── POPUP DÉTAIL ──────────────────────────────

function openStationPopup(station) {
  stationClickLockUntil = Date.now() + 1200;
  selectedStationId = getStationId(station);

  if (activeStationPopup) {
    activeStationPopup.remove();
    activeStationPopup = null;
  }
  if (window._activePopup) {
    window._activePopup.remove();
    window._activePopup = null;
  }

  clearStationMarkers(false);
  renderStationMarkers(stationsData);

  const brand = getBrand(station.brand || station.name);
  const prices = station.prices || {};
  const hasPrices = Object.keys(prices).length > 0;

  const distStr = userLocation
    ? (() => {
        const d = haversineKm(userLocation.lat, userLocation.lng, station.lat, station.lng);
        return d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km';
      })()
    : '';

  const serviceIcons = {
    'Toilettes': '🚻',
    'Boutique': '🛍',
    'Restaurant': '🍔',
    'Lavage': '🚗💧',
    'Wifi': '📶'
  };

  const servicesHTML = (station.services || [])
    .map(s => serviceIcons[s] || null)
    .filter(Boolean)
    .join(' ');

  const fuelsHTML = hasPrices
    ? Object.entries(prices).map(([fuel, price]) => {
        const info = FUEL_LABELS[fuel] || { label: fuel, icon: '⛽', color: '#6B7280' };
        const priceColor = price < 1.75 ? '#10B981' : price < 1.95 ? '#00d4ff' : '#F59E0B';
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.05)">
          <span style="font-size:14px;width:18px">${info.icon}</span>
          <span style="flex:1;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500">${info.label}</span>
          <span style="font-family:'DM Mono',monospace;font-size:15px;font-weight:600;color:${priceColor}">€ ${price.toFixed(3)}</span>
        </div>`;
      }).join('')
    : `<div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:10px 0">
        Prix non disponibles<br><small>Source gouvernementale non trouvée</small>
       </div>`;

  const safeName = String(station.name || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  const html = `
    <div style="font-family:'Syne',sans-serif;background:#0a0f1e;border-radius:18px;overflow:hidden;width:270px;border:0.5px solid rgba(255,255,255,0.1)">
      <div style="background:${brand.color};padding:14px 16px">
        <div style="font-size:17px;font-weight:800;color:white">${brand.full || station.name}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:3px">⛽ Station carburant${distStr ? ' · ' + distStr : ''}</div>
        ${station.address ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">📍 ${station.address}</div>` : ''}
        ${station.openingHours ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">🕐 ${station.openingHours}</div>` : ''}
      </div>
      <div style="padding:12px 16px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
        <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:700">Carburants & Prix</div>
        ${fuelsHTML}
      </div>
      ${servicesHTML ? `<div style="padding:10px 16px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
        <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">Services</div>
        <div style="font-size:16px;letter-spacing:3px">${servicesHTML}</div>
      </div>` : ''}
      <div style="display:flex;gap:8px;padding:12px 16px">
        <button onclick="navigateToStation(${station.lat},${station.lng},'${safeName}')" style="flex:1;background:linear-gradient(135deg,#0050cc,#003db5);border:none;border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:white;cursor:pointer">→ Y aller</button>
        <button onclick="closeStationPopup()" style="flex:1;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer">Fermer</button>
      </div>
    </div>`;

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: '290px',
    anchor: 'bottom',
    offset: [0, -52],
  })
    .setLngLat([station.lng, station.lat])
    .setHTML(html)
    .addTo(map);

  window._activePopup = popup;
  activeStationPopup = popup;

  // IMPORTANT : on ne recentre plus la carte ici
}

function closeStationPopup() {
  if (activeStationPopup) {
    activeStationPopup.remove();
    activeStationPopup = null;
  }
  if (window._activePopup) {
    window._activePopup.remove();
    window._activePopup = null;
  }

  selectedStationId = null;
  clearStationMarkers(false);
  renderStationMarkers(stationsData);
}

function navigateToStation(lat, lng, name) {
  if (activeStationPopup) { activeStationPopup.remove(); activeStationPopup = null; }
  if (window._activePopup) { window._activePopup.remove(); window._activePopup = null; }
  const input = document.getElementById('search-input');
  if (input) input.value = name;
  calculateRoutes(lat, lng, name + ' (Station essence)');
}

// ── ALERTES ROUTE ─────────────────────────────

function checkUpcomingStations(userLat, userLng, bearing) {
  if (!navActive || !stationsData.length) return;
  stationsData.forEach(s => {
    if (upcomingAlertShown.has(s.id)) return;
    const dist = haversineKm(userLat, userLng, s.lat, s.lng);
    if (dist > 5 || dist < 0.3) return;
    if (bearing !== null && !isAhead(userLat, userLng, bearing, s.lat, s.lng)) return;
    upcomingAlertShown.add(s.id);
    const brand = getBrand(s.brand || s.name);
    const diesel = s.prices?.['Gazole'];
    const sp95 = s.prices?.['SP95'] || s.prices?.['E10'];
    const distStr = dist < 1 ? Math.round(dist * 1000) + 'm' : dist.toFixed(1) + 'km';
    if (typeof ariaAlertStation === 'function') {
      ariaAlertStation(brand.full, distStr, diesel?.toFixed(3), sp95?.toFixed(3));
    }
  });
}

function isAhead(uLat, uLng, bearing, sLat, sLng) {
  if (bearing === null || bearing === undefined) return true;
  const angle = (Math.atan2(sLng - uLng, sLat - uLat) * 180 / Math.PI + 360) % 360;
  const diff = Math.abs(angle - bearing);
  return diff < 80 || diff > 280;
}

// ── TOGGLE STATIONS ───────────────────────────

function toggleStations() {
  stationsVisible = !stationsVisible;

  if (stationsVisible) {
    clearStationMarkers(false);
    renderStationMarkers(stationsData);
  } else {
    clearStationMarkers(true);
  }

  const btn = document.getElementById('stations-toggle');
  if (btn) btn.style.opacity = stationsVisible ? '1' : '0.4';
  showToast(stationsVisible ? 'Stations affichées' : 'Stations masquées');
}

function clearStationMarkers(closePopup = true) {
  stationMarkers.forEach(({ marker }) => marker.remove());
  stationMarkers = [];

  if (closePopup) {
    if (activeStationPopup) { activeStationPopup.remove(); activeStationPopup = null; }
    if (window._activePopup) { window._activePopup.remove(); window._activePopup = null; }
  }
}

// ── UTILITAIRES ───────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}