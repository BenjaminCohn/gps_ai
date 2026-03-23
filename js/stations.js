// ═══════════════════════════════════════
//  ARIA GPS — Stations Essence
//  Version corrigée + optimisée mobile
// ═══════════════════════════════════════

let stationMarkers = [];
let stationsData = [];
let activeStationPopup = null;
let upcomingAlertShown = new Set();

let stationsVisible = true;
let selectedStationId = null;
let suppressStationReloadUntil = 0;
let stationRenderTimer = null;

// Dépendances globales attendues :
// - map
// - userLocation
// - navActive
// - showToast()
// - calculateRoutes()
// - ariaAlertStation() (optionnel)

const BRANDS = {
  total:         { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  totalenergies: { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  bp:            { color: '#007A33', bg: '#E8F5EE', abbr: 'BP', full: 'BP' },
  shell:         { color: '#D4A800', bg: '#FFFBEA', abbr: 'SH', full: 'Shell' },
  esso:          { color: '#003087', bg: '#E8EDF8', abbr: 'ES', full: 'Esso' },
  auchan:        { color: '#E63B2E', bg: '#FFF0EF', abbr: 'AU', full: 'Auchan' },
  carrefour:     { color: '#0066CC', bg: '#E6F0FA', abbr: 'CF', full: 'Carrefour' },
  leclerc:       { color: '#0066CC', bg: '#E6F0FA', abbr: 'LC', full: 'E.Leclerc' },
  intermarché:   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'IT', full: 'Intermarché' },
  intermarche:   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'IT', full: 'Intermarché' },
  casino:        { color: '#2E7D32', bg: '#E8F5E9', abbr: 'CA', full: 'Casino' },
  'systeme u':   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Système U' },
  'super u':     { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Super U' },
  nf:            { color: '#555',    bg: '#F5F5F5', abbr: 'NF', full: 'NF' },
  dyneff:        { color: '#FF6B00', bg: '#FFF3E8', abbr: 'DY', full: 'Dyneff' },
  default:       { color: '#374151', bg: '#F3F4F6', abbr: '⛽', full: 'Station' },
};

const FUEL_LABELS = {
  Gazole: { label: 'Diesel', icon: '🟡', color: '#F59E0B' },
  SP95:   { label: 'SP95',   icon: '🟢', color: '#10B981' },
  SP98:   { label: 'SP98',   icon: '🔵', color: '#3B82F6' },
  E10:    { label: 'E10',    icon: '🟢', color: '#34D399' },
  E85:    { label: 'E85',    icon: '🌿', color: '#6EE7B7' },
  GPLc:   { label: 'GPL',    icon: '🟣', color: '#8B5CF6' },
  HVO100: { label: 'HVO100', icon: '🌱', color: '#059669' },
};

function getBrand(name) {
  if (!name) return BRANDS.default;

  const key = String(name).toLowerCase().trim();

  for (const [k, v] of Object.entries(BRANDS)) {
    if (k !== 'default' && key.includes(k)) return v;
  }

  return {
    ...BRANDS.default,
    abbr: String(name).slice(0, 2).toUpperCase(),
    full: String(name),
  };
}

function getStationId(station) {
  return station?.govId || station?.id || `${station?.lat}-${station?.lng}-${station?.name || ''}`;
}

function isMobileDevice() {
  return window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
}

function getReferencePoint() {
  if (userLocation?.lat && userLocation?.lng) {
    return { lat: userLocation.lat, lng: userLocation.lng };
  }

  if (typeof map?.getCenter === 'function') {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  return null;
}

function getStationRenderLimit() {
  const zoom = typeof map?.getZoom === 'function' ? map.getZoom() : 12;
  const mobile = isMobileDevice();

  if (mobile) {
    if (zoom < 10.5) return 0;
    if (zoom < 12) return 12;
    if (zoom < 13.5) return 20;
    return 30;
  }

  if (zoom < 8.5) return 0;
  if (zoom < 10) return 25;
  if (zoom < 12) return 50;
  if (zoom < 13.5) return 80;
  return 120;
}

function scheduleStationRerender(delay = 160) {
  clearTimeout(stationRenderTimer);

  stationRenderTimer = setTimeout(() => {
    if (Date.now() < suppressStationReloadUntil) return;
    if (!stationsVisible) return;
    renderStationMarkers(stationsData);
  }, delay);
}

function bindStationMapEvents() {
  if (!map || map.__ariaStationsBound) return;

  map.__ariaStationsBound = true;

  map.on('moveend', () => {
    if (Date.now() < suppressStationReloadUntil) return;
    scheduleStationRerender(180);
  });

  map.on('zoomend', () => {
    if (Date.now() < suppressStationReloadUntil) return;
    scheduleStationRerender(100);
  });
}

function initStationsModule() {
  bindStationMapEvents();
}

// ── CHARGEMENT PRINCIPAL ──────────────────────

async function loadStationsAlongRoute(routeCoords) {
  if (!routeCoords || !routeCoords.length) return;

  const lngs = routeCoords.map(c => c[0]);
  const lats = routeCoords.map(c => c[1]);

  await loadStationsInBbox(
    Math.min(...lats) - 0.12,
    Math.max(...lats) + 0.12,
    Math.min(...lngs) - 0.12,
    Math.max(...lngs) + 0.12
  );
}

async function loadStationsNearUser(lat, lng, radiusKm = 15) {
  const deg = radiusKm / 111;
  await loadStationsInBbox(lat - deg, lat + deg, lng - deg, lng + deg);
}

async function loadStationsInBbox(minLat, maxLat, minLng, maxLng) {
  try {
    bindStationMapEvents();

    if (typeof showToast === 'function') {
      showToast('Recherche des stations carburant...');
    }

    const [osmStations, govPrices] = await Promise.all([
      fetchStationsFromOSM(minLat, maxLat, minLng, maxLng),
      fetchPricesGouvernement(minLat, maxLat, minLng, maxLng),
    ]);

    let merged = mergeStationsAndPrices(osmStations, govPrices);
    merged = dedupeStations(merged);

    stationsData = merged;

    if (!stationsVisible) return;
    if (Date.now() < suppressStationReloadUntil) return;

    renderStationMarkers(merged);

    if (merged.length > 0 && typeof showToast === 'function') {
      const rendered = getStationsForDisplay(merged).length;
      const mobile = isMobileDevice();
      const msg = mobile && merged.length > rendered
        ? `${rendered} stations affichées sur ${merged.length}`
        : `${merged.length} stations trouvées`;
      showToast(msg);
    }
  } catch (err) {
    console.error('Stations error:', err);
  }
}

// ── OSM : LOCALISATION ────────────────────────

async function fetchStationsFromOSM(minLat, maxLat, minLng, maxLng) {
  const query = `[out:json][timeout:20];
    (
      node["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out body center;`;

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
      address: [
        el.tags?.['addr:housenumber'],
        el.tags?.['addr:street'],
        el.tags?.['addr:city'],
      ].filter(Boolean).join(' '),
      services: parseOSMServices(el.tags || {}),
      openingHours: el.tags?.opening_hours || '',
      prices: {},
      govId: null,
    })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  } catch (err) {
    console.warn('OSM error:', err);
    return [];
  }
}

function parseOSMServices(tags) {
  const s = [];
  if (tags.toilets === 'yes' || tags['amenity:toilets'] === 'yes') s.push('Toilettes');
  if (tags.shop === 'convenience') s.push('Boutique');
  if (tags.restaurant === 'yes') s.push('Restaurant');
  if (tags.car_wash === 'yes') s.push('Lavage');
  if (tags.wifi === 'yes') s.push('Wifi');
  return s;
}

// ── PRIX GOUVERNEMENT ─────────────────────────

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
    const target = `https://api.prix-carburants.economie.gouv.fr/stations/around/${centerLat}/${centerLng}/25000`;
    const url = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
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

    let best = null;
    let bestDist = 0.5; // 500m max

    osmStations.forEach(s => {
      const d = haversineKm(s.lat, s.lng, gLat, gLng);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    });

    if (best) {
      best.prices = parsePricesFromGov(gov);
      best.govId = gov.id;
      if (!best.brand && (gov.Enseignes || gov.enseignes)) {
        best.brand = gov.Enseignes || gov.enseignes;
      }
    } else {
      osmStations.push({
        id: 'gov-' + (gov.id || Math.random()),
        lat: gLat,
        lng: gLng,
        name: gov.Enseignes || gov.enseignes || gov.brand || 'Station',
        brand: gov.Enseignes || gov.enseignes || gov.brand || '',
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

      if (name && val !== undefined && val !== null) {
        const price = parseFloat(val);
        if (!Number.isNaN(price) && price > 0) {
          prices[name] = price > 10 ? price / 1000 : price;
        }
      }
    });
  }

  ['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc', 'HVO100'].forEach(fuel => {
    if (station[fuel] !== undefined) {
      const v = parseFloat(station[fuel]);
      if (!Number.isNaN(v) && v > 0) {
        prices[fuel] = v > 10 ? v / 1000 : v;
      }
    }
  });

  return prices;
}

function dedupeStations(stations) {
  const seen = new Set();

  return stations.filter(s => {
    const key = s.govId
      ? `gov:${s.govId}`
      : `${(s.lat || 0).toFixed(4)}:${(s.lng || 0).toFixed(4)}:${String(s.name || '').toLowerCase()}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── RENDU ─────────────────────────────────────

function getStationsForDisplay(stations) {
  const limit = getStationRenderLimit();
  if (!limit) return [];

  const ref = getReferencePoint();

  return [...stations]
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map(s => ({
      ...s,
      __distance: ref ? haversineKm(ref.lat, ref.lng, s.lat, s.lng) : 0,
    }))
    .sort((a, b) => a.__distance - b.__distance)
    .slice(0, limit);
}

function markerTransform(isSelected, isHover) {
  if (isHover && isSelected) return 'scale(1.14) translateY(-4px)';
  if (isHover) return 'scale(1.08) translateY(-3px)';
  if (isSelected) return 'scale(1.08) translateY(-2px)';
  return 'none';
}

function paintMarkerElement(el, station, isSelected = false) {
  const brand = getBrand(station.brand || station.name);
  const diesel = station.prices?.Gazole;
  const hasPrices = Object.keys(station.prices || {}).length > 0;

  el.dataset.selected = isSelected ? '1' : '0';
  el.dataset.hover = el.dataset.hover || '0';

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
    font-family:'Syne',sans-serif;
    filter:${isSelected ? 'drop-shadow(0 0 10px rgba(0,212,255,0.9))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))'};
    transform:${markerTransform(isSelected, el.dataset.hover === '1')};
    transition:transform 0.15s ease, filter 0.15s ease, border 0.15s ease;
    will-change:transform;
    z-index:${isSelected ? '20' : '1'};
  `;

  el.innerHTML = `
    <div style="font-size:11px;font-weight:800;color:${brand.color};line-height:1">${brand.abbr}</div>
    ${
      diesel
        ? `<div style="font-size:9px;font-weight:500;color:${brand.color};font-family:'DM Mono',monospace">€${diesel.toFixed(3)}</div>`
        : `<div style="font-size:9px;color:${hasPrices ? brand.color : '#999'}">⛽</div>`
    }
    <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${brand.color};margin-top:2px"></div>
  `;
}

function updateStationMarkerSelection() {
  stationMarkers.forEach(({ station, el }) => {
    paintMarkerElement(el, station, getStationId(station) === selectedStationId);
  });
}

function renderStationMarkers(stations) {
  clearStationMarkers(false);

  if (!stationsVisible || !map) return;

  const displayStations = getStationsForDisplay(stations);

  displayStations.forEach(s => {
    const el = document.createElement('div');
    paintMarkerElement(el, s, getStationId(s) === selectedStationId);

    el.addEventListener('mouseenter', () => {
      el.dataset.hover = '1';
      el.style.transform = markerTransform(el.dataset.selected === '1', true);
    });

    el.addEventListener('mouseleave', () => {
      el.dataset.hover = '0';
      el.style.transform = markerTransform(el.dataset.selected === '1', false);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openStationPopup(s);
    });

    const marker = new mapboxgl.Marker({
      element: el,
      anchor: 'bottom',
    })
      .setLngLat([s.lng, s.lat])
      .addTo(map);

    stationMarkers.push({ marker, station: s, el });
  });
}

// ── POPUP ─────────────────────────────────────

function openStationPopup(station) {
  selectedStationId = getStationId(station);
  suppressStationReloadUntil = Date.now() + 1000;

  closeStationPopup(false);
  updateStationMarkerSelection();

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
    Toilettes: '🚻',
    Boutique: '🛍',
    Restaurant: '🍔',
    Lavage: '🚗💧',
    Wifi: '📶',
  };

  const servicesHTML = (station.services || [])
    .map(s => serviceIcons[s] || null)
    .filter(Boolean)
    .join(' ');

  const fuelsHTML = hasPrices
    ? Object.entries(prices).map(([fuel, price]) => {
        const info = FUEL_LABELS[fuel] || { label: fuel, icon: '⛽', color: '#6B7280' };
        const priceColor = price < 1.75 ? '#10B981' : price < 1.95 ? '#00d4ff' : '#F59E0B';

        return `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.05)">
            <span style="font-size:14px;width:18px">${info.icon}</span>
            <span style="flex:1;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500">${info.label}</span>
            <span style="font-family:'DM Mono',monospace;font-size:15px;font-weight:600;color:${priceColor}">€ ${Number(price).toFixed(3)}</span>
          </div>
        `;
      }).join('')
    : `
      <div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:10px 0">
        Prix non disponibles<br><small>Source gouvernementale non trouvée</small>
      </div>
    `;

  const safeName = String(station.name || 'Station')
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

      ${servicesHTML ? `
        <div style="padding:10px 16px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">Services</div>
          <div style="font-size:16px;letter-spacing:3px">${servicesHTML}</div>
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;padding:12px 16px">
        <button onclick="navigateToStation(${station.lat},${station.lng},'${safeName}')" style="flex:1;background:linear-gradient(135deg,#0050cc,#003db5);border:none;border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:white;cursor:pointer">→ Y aller</button>
        <button onclick="closeStationPopup(true)" style="flex:1;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer">Fermer</button>
      </div>
    </div>
  `;

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

  activeStationPopup = popup;
  window._activePopup = popup;

  // On ne recentre plus la carte ici.
}

function closeStationPopup(clearSelection = false) {
  if (activeStationPopup) {
    activeStationPopup.remove();
    activeStationPopup = null;
  }

  if (window._activePopup) {
    window._activePopup.remove();
    window._activePopup = null;
  }

  if (clearSelection) {
    selectedStationId = null;
    updateStationMarkerSelection();
  }
}

function navigateToStation(lat, lng, name) {
  closeStationPopup(false);

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
    const diesel = s.prices?.Gazole;
    const sp95 = s.prices?.SP95 || s.prices?.E10;
    const distStr = dist < 1 ? Math.round(dist * 1000) + 'm' : dist.toFixed(1) + 'km';

    if (typeof ariaAlertStation === 'function') {
      ariaAlertStation(
        brand.full,
        distStr,
        diesel?.toFixed(3),
        sp95?.toFixed(3)
      );
    }
  });
}

function isAhead(uLat, uLng, bearing, sLat, sLng) {
  if (bearing === null || bearing === undefined) return true;

  const angle = (Math.atan2(sLng - uLng, sLat - uLat) * 180 / Math.PI + 360) % 360;
  const diff = Math.abs(angle - bearing);

  return diff < 80 || diff > 280;
}

// ── TOGGLE / CLEAR ────────────────────────────

function toggleStations() {
  stationsVisible = !stationsVisible;

  if (!stationsVisible) {
    clearStationMarkers(true);
  } else {
    renderStationMarkers(stationsData);
  }

  const btn = document.getElementById('stations-toggle');
  if (btn) btn.style.opacity = stationsVisible ? '1' : '0.4';

  if (typeof showToast === 'function') {
    showToast(stationsVisible ? 'Stations affichées' : 'Stations masquées');
  }
}

function clearStationMarkers(closePopup = true) {
  stationMarkers.forEach(({ marker }) => marker.remove());
  stationMarkers = [];

  if (closePopup) {
    closeStationPopup(false);
  }
}

// ── UTILITAIRES ───────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AUTO-INIT DU MODULE STATIONS ─────────────

function autoInitStationsModule() {
  let tries = 0;

  const start = () => {
    if (typeof map !== 'undefined' && map) {
      initStationsModule();
      return true;
    }
    return false;
  };

  if (start()) return;

  const timer = setInterval(() => {
    tries++;

    if (start()) {
      clearInterval(timer);
      return;
    }

    if (tries > 40) {
      clearInterval(timer);
      console.warn('Stations: carte non trouvée pour initStationsModule()');
    }
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInitStationsModule);
} else {
  autoInitStationsModule();
}