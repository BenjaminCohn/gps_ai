// ═══════════════════════════════════════
//  ARIA GPS — Stations Essence (CLEAN)
//  - OSM (Overpass) + Prix Carburants via /api/fuel (proxy Vercel)
//  - Filtre route / proche utilisateur
//  - Markers + Drawer + Alertes stations
// ═══════════════════════════════════════

/* global mapboxgl */

// ──────────────────────────────────────
// SHARED NAV (utilisé par la navigation)
// ──────────────────────────────────────
const ARIA_NAV_SHARED = window.ARIA_NAV_SHARED || (window.ARIA_NAV_SHARED = {
  currentRouteGeoJSON: null,
  currentRouteSteps: [],
  currentStepIndex: 0,
});

// ──────────────────────────────────────
// STATE
// ──────────────────────────────────────
let stationMarkers = [];
let stationsData = [];
let upcomingAlertShown = new Set();

let selectedStationId = null;
let stationClickLockUntil = 0;
let stationsVisible = true;

window.stationsData = stationsData;

// ──────────────────────────────────────
// CONFIG
// ──────────────────────────────────────
// ✅ IMPORTANT : on passe par TON proxy Vercel (évite CORS + exports 504)
const GOV_PROXY_URL = '/api/fuel';

// Cache prix gouv (par zone)
let govFuelCache = { ts: 0, key: '', data: [] };

const BRANDS = {
  total:         { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  totalenergies: { color: '#E63B2E', bg: '#FFF0EF', abbr: 'TT', full: 'TotalEnergies' },
  bp:            { color: '#007A33', bg: '#E8F5EE', abbr: 'BP', full: 'BP' },
  shell:         { color: '#D4A800', bg: '#FFFBEA', abbr: 'SH', full: 'Shell' },
  esso:          { color: '#003087', bg: '#E8EDF8', abbr: 'ES', full: 'Esso' },
  auchan:        { color: '#E63B2E', bg: '#FFF0EF', abbr: 'AU', full: 'Auchan' },
  carrefour:     { color: '#0066CC', bg: '#E6F0FA', abbr: 'CF', full: 'Carrefour' },
  leclerc:       { color: '#0066CC', bg: '#E6F0FA', abbr: 'LC', full: 'E.Leclerc' },
  intermarche:   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'IN', full: 'Intermarché' },
  casino:        { color: '#2E7D32', bg: '#E8F5E9', abbr: 'CA', full: 'Casino' },
  'systeme u':   { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Système U' },
  'super u':     { color: '#E63B2E', bg: '#FFF0EF', abbr: 'SU', full: 'Super U' },
  nf:            { color: '#555', bg: '#F5F5F5', abbr: 'NF', full: 'NF' },
  dyneff:        { color: '#FF6B00', bg: '#FFF3E8', abbr: 'DY', full: 'Dyneff' },
  default:       { color: '#374151', bg: '#F3F4F6', abbr: '⛽', full: 'Station' },
};

const FUEL_LABELS = {
  Gazole: { label: 'Diesel', icon: '🟡' },
  SP95:   { label: 'SP95', icon: '🟢' },
  SP98:   { label: 'SP98', icon: '🔵' },
  E10:    { label: 'E10', icon: '🟢' },
  E85:    { label: 'E85', icon: '🌿' },
  GPLc:   { label: 'GPL', icon: '🟣' },
  HVO100: { label: 'HVO100', icon: '🌱' },
};

const FUEL_ORDER = ['Gazole', 'SP95', 'E10', 'SP98', 'E85', 'GPLc', 'HVO100'];

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────
function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(String(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function escapeJsString(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .finally(() => clearTimeout(timer));
}

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

function distancePointToSegmentKm(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = x1; yy = y1;
  } else if (param > 1) {
    xx = x2; yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  return haversineKm(py, px, yy, xx);
}

function isStationNearRoute(station, routeCoords, thresholdKm = 2.5) {
  if (!station?.lat || !station?.lng || !Array.isArray(routeCoords) || routeCoords.length < 2) return false;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [x1, y1] = routeCoords[i];
    const [x2, y2] = routeCoords[i + 1];
    const d = distancePointToSegmentKm(station.lng, station.lat, x1, y1, x2, y2);
    if (d <= thresholdKm) return true;
  }
  return false;
}

function getBrand(name) {
  if (!name) return BRANDS.default;
  const key = name.toLowerCase().trim();

  for (const [k, v] of Object.entries(BRANDS)) {
    if (k !== 'default' && key.includes(k)) return v;
  }

  return { ...BRANDS.default, abbr: name.slice(0, 2).toUpperCase(), full: name };
}

function getStationId(station) {
  return station?.govId || station?.id || `${station?.lat}-${station?.lng}-${station?.name || ''}`;
}

function setStationsData(list) {
  stationsData = Array.isArray(list) ? list : [];
  window.stationsData = stationsData;
}

function getStationsForCurrentContext(stations) {
  let list = [...stations].filter(s => s.lat && s.lng);

  if (window.navActive && ARIA_NAV_SHARED.currentRouteGeoJSON?.geometry?.coordinates?.length) {
    const routeCoords = ARIA_NAV_SHARED.currentRouteGeoJSON.geometry.coordinates;
    list = list.filter(s => isStationNearRoute(s, routeCoords, 2.5));
  }

  if (window.userLocation?.lat && window.userLocation?.lng) {
    list.sort((a, b) => {
      const da = haversineKm(window.userLocation.lat, window.userLocation.lng, a.lat, a.lng);
      const db = haversineKm(window.userLocation.lat, window.userLocation.lng, b.lat, b.lng);
      return da - db;
    });
  }

  const isMobile = window.innerWidth <= 768;
  return list.slice(0, isMobile ? 30 : 80);
}

function refreshStationSelection() {
  stationMarkers.forEach(({ station, el }) => {
    const isSelected = selectedStationId === getStationId(station);

    el.style.outline = isSelected ? '2px solid #00d4ff' : 'none';
    el.style.outlineOffset = isSelected ? '1px' : '0';
    el.style.filter = isSelected
      ? 'drop-shadow(0 0 10px rgba(0,212,255,0.9))'
      : 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))';
    el.style.zIndex = isSelected ? '20' : '1';
    el.style.transform = isSelected ? 'scale(1.08) translateY(-2px)' : '';
  });
}

// ──────────────────────────────────────
// OSM (Overpass) — stations “physiques”
// ──────────────────────────────────────
function parseOSMServices(tags) {
  const s = [];
  if (tags.toilets === 'yes' || tags['amenity:toilets'] === 'yes') s.push('Toilettes');
  if (tags.shop === 'convenience') s.push('Boutique');
  if (tags.restaurant === 'yes' || tags.fast_food === 'yes') s.push('Restaurant');
  if (tags.car_wash === 'yes') s.push('Lavage');
  if (tags.wifi === 'yes' || tags.internet_access === 'wlan') s.push('Wifi');
  return uniq(s);
}

async function fetchStationsFromOSM(minLat, maxLat, minLng, maxLng) {
  const query = `
    [out:json][timeout:20];
    (
      node["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="fuel"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out body center;
  `;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
    });

    if (!res.ok) return [];

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!contentType.includes('application/json')) return [];

    let data;
    try { data = JSON.parse(text); } catch { return []; }

    return (data.elements || [])
      .map(el => ({
        id: 'osm-' + el.id,
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
        name: el.tags?.brand || el.tags?.name || el.tags?.operator || 'Station',
        brand: el.tags?.brand || el.tags?.name || '',
        address: [el.tags?.['addr:housenumber'], el.tags?.['addr:street'], el.tags?.['addr:city']]
          .filter(Boolean).join(' '),
        services: parseOSMServices(el.tags || {}),
        openingHours: el.tags?.opening_hours || '',
        prices: {},
        govId: null,
      }))
      .filter(s => s.lat && s.lng);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────
// GOUV — via /api/fuel (proxy)
// ──────────────────────────────────────
function normalizeGovPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function pickGovCoords(row) {
  // Supporte plusieurs formats Opendatasoft
  // geo_point_2d: [lat, lon] ou {lat, lon}
  // geom: {coordinates:[lng,lat]}
  let lat =
    normalizeNumber(row.latitude) ??
    normalizeNumber(row.lat) ??
    normalizeNumber(row.geom?.lat) ??
    normalizeNumber(row.geo_point_2d?.lat);

  let lng =
    normalizeNumber(row.longitude) ??
    normalizeNumber(row.lng) ??
    normalizeNumber(row.geom?.lon) ??
    normalizeNumber(row.geom?.lng) ??
    normalizeNumber(row.geo_point_2d?.lon) ??
    normalizeNumber(row.geo_point_2d?.lng);

  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && Array.isArray(row.geo_point_2d) && row.geo_point_2d.length === 2) {
    lat = normalizeNumber(row.geo_point_2d[0]);
    lng = normalizeNumber(row.geo_point_2d[1]);
  }

  if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && Array.isArray(row.geom?.coordinates) && row.geom.coordinates.length >= 2) {
    lng = normalizeNumber(row.geom.coordinates[0]);
    lat = normalizeNumber(row.geom.coordinates[1]);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildGovAddress(gov) {
  return [gov.adresse || gov.address || '', gov.cp || gov.postal_code || '', gov.ville || gov.city || '']
    .filter(Boolean).join(' ').trim();
}

function parseGovServices(gov) {
  const raw = gov.services || gov.service || gov.services_list || [];
  let items = [];

  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string') items = raw.split(/[;,|]/).map(s => s.trim());

  const out = [];
  items.forEach((item) => {
    const v = String(item).toLowerCase();
    if (v.includes('toilet')) out.push('Toilettes');
    if (v.includes('boutique') || v.includes('shop') || v.includes('aliment')) out.push('Boutique');
    if (v.includes('restaurant') || v.includes('restauration') || v.includes('sandwich')) out.push('Restaurant');
    if (v.includes('lavage') || v.includes('wash')) out.push('Lavage');
    if (v.includes('wifi') || v.includes('wi-fi')) out.push('Wifi');
  });

  return uniq(out);
}

function parsePricesFromGov(station) {
  const prices = {};

  // Certains dumps exposent des champs directs, d'autres un tableau "prix"
  const fieldMap = {
    Gazole: ['gazole_prix', 'Gazole', 'gazole'],
    SP95:   ['sp95_prix', 'SP95', 'sp95'],
    SP98:   ['sp98_prix', 'SP98', 'sp98'],
    E10:    ['e10_prix', 'E10', 'e10'],
    E85:    ['e85_prix', 'E85', 'e85'],
    GPLc:   ['gplc_prix', 'GPLc', 'gplc'],
    HVO100: ['hvo100_prix', 'HVO100', 'hvo100'],
  };

  for (const [fuelName, keys] of Object.entries(fieldMap)) {
    for (const key of keys) {
      const raw = station[key];
      if (raw === null || raw === undefined || raw === '') continue;

      let v = normalizeNumber(raw);
      if (v === null || v <= 0) continue;

      // parfois en millièmes (ex: 1799 => 1.799)
      if (v > 10) v /= 1000;

      prices[fuelName] = v;
      break;
    }
  }

  if (!Object.keys(prices).length) {
    const fuels = station.Prix || station.prix || station.carburants || station.prices || [];
    if (Array.isArray(fuels)) {
      fuels.forEach((f) => {
        const name = f['@nom'] || f.nom || f.name || f.type;
        const val = f['@valeur'] || f.valeur || f.value || f.prix || f.price;
        if (!name || val === null || val === undefined || val === '') return;

        let price = normalizeNumber(val);
        if (price === null || price <= 0) return;
        if (price > 10) price /= 1000;

        prices[name] = price;
      });
    }
  }

  return prices;
}

async function fetchGovFuelStationsCached(centerLat, centerLng, radiusMeters, limit = 80) {
  const key = `${centerLat.toFixed(4)}|${centerLng.toFixed(4)}|${Math.round(radiusMeters)}|${limit}`;
  const fresh = govFuelCache.data.length && govFuelCache.key === key && (Date.now() - govFuelCache.ts) < 5 * 60 * 1000;
  if (fresh) return govFuelCache.data;

  const url =
    `${GOV_PROXY_URL}?lat=${encodeURIComponent(centerLat)}` +
    `&lng=${encodeURIComponent(centerLng)}` +
    `&radius=${encodeURIComponent(Math.round(radiusMeters))}` +
    `&limit=${encodeURIComponent(limit)}`;

  const payload = await fetchJsonWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
  const rows = normalizeGovPayload(payload);

  govFuelCache = { ts: Date.now(), key, data: rows };
  return rows;
}

async function fetchPricesGouvernement(minLat, maxLat, minLng, maxLng) {
  // centre bbox
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;

  // rayon ≈ centre → coin le plus loin
  const rKm = Math.max(
    haversineKm(cLat, cLng, minLat, minLng),
    haversineKm(cLat, cLng, minLat, maxLng),
    haversineKm(cLat, cLng, maxLat, minLng),
    haversineKm(cLat, cLng, maxLat, maxLng),
  );

  const radiusMeters = Math.max(2000, Math.round((rKm + 1.2) * 1000)); // marge
  const all = await fetchGovFuelStationsCached(cLat, cLng, radiusMeters, 100);

  // filtre strict bbox (comme avant)
  return all.filter((row) => {
    const c = pickGovCoords(row);
    if (!c) return false;
    return c.lat >= minLat && c.lat <= maxLat && c.lng >= minLng && c.lng <= maxLng;
  });
}

// ──────────────────────────────────────
// MERGE OSM + GOV
// ──────────────────────────────────────
function mergeStationsAndPrices(osmStations, govData) {
  const merged = [...(osmStations || [])];
  if (!Array.isArray(govData) || !govData.length) return merged;

  govData.forEach((gov) => {
    const coords = pickGovCoords(gov);
    if (!coords) return;

    const parsedPrices = parsePricesFromGov(gov);
    const govName =
      gov.enseigne || gov.enseignes || gov.Enseignes || gov.brand || gov.nom || 'Station';
    const govAddress = buildGovAddress(gov) || gov.adresse || '';
    const govServices = parseGovServices(gov);

    // Match avec station OSM proche
    let best = null;
    let bestDist = 0.35; // 350m

    merged.forEach((s) => {
      if (!s.lat || !s.lng) return;
      const d = haversineKm(s.lat, s.lng, coords.lat, coords.lng);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    });

    if (best) {
      best.prices = { ...(best.prices || {}), ...parsedPrices };
      best.govId = best.govId || gov.id || gov.identifiant || null;
      best.address = best.address || govAddress;
      best.brand = best.brand || govName;
      best.name = best.name === 'Station' ? govName : best.name;
      best.services = uniq([...(best.services || []), ...govServices]);
    } else {
      merged.push({
        id: 'gov-' + (gov.id || Math.random().toString(36).slice(2)),
        lat: coords.lat,
        lng: coords.lng,
        name: govName,
        brand: govName,
        address: govAddress,
        services: govServices,
        openingHours: '',
        prices: parsedPrices,
        govId: gov.id || gov.identifiant || null,
      });
    }
  });

  return merged;
}

// ──────────────────────────────────────
// CHARGEMENT — bbox / route / user
// ──────────────────────────────────────
async function loadStationsAlongRoute(routeCoords) {
  if (!Array.isArray(routeCoords) || !routeCoords.length) return;

  const lngs = routeCoords.map(c => c[0]);
  const lats = routeCoords.map(c => c[1]);

  await loadStationsInBbox(
    Math.min(...lats) - 0.15,
    Math.max(...lats) + 0.15,
    Math.min(...lngs) - 0.15,
    Math.max(...lngs) + 0.15
  );
}

async function loadStationsNearUser(lat, lng, radiusKm = 15) {
  const deg = radiusKm / 111;
  await loadStationsInBbox(lat - deg, lat + deg, lng - deg, lng + deg);
}

async function loadStationsInBbox(minLat, maxLat, minLng, maxLng) {
  try {
    if (typeof showToast === 'function') showToast('Recherche des stations carburant...');

    const [osmRes, govRes] = await Promise.allSettled([
      fetchStationsFromOSM(minLat, maxLat, minLng, maxLng),
      fetchPricesGouvernement(minLat, maxLat, minLng, maxLng),
    ]);

    const osmStations = osmRes.status === 'fulfilled' ? osmRes.value : [];
    const govPrices = govRes.status === 'fulfilled' ? govRes.value : [];

    if (osmRes.status === 'rejected') console.warn('OSM error:', osmRes.reason);
    if (govRes.status === 'rejected') console.warn('GOV fuel error:', govRes.reason);

    const merged = mergeStationsAndPrices(osmStations, govPrices);
    setStationsData(merged);

    if (Date.now() < stationClickLockUntil) return;
    if (!stationsVisible) return;

    clearStationMarkers(false);
    renderStationMarkers(stationsData);

    if (typeof showToast === 'function') {
      if (stationsData.length > 0) {
        const shown = getStationsForCurrentContext(stationsData).length;
        const isMobile = window.innerWidth <= 768;

        showToast(
          isMobile && stationsData.length > shown
            ? `${shown} stations affichées sur ${stationsData.length}`
            : `${stationsData.length} stations trouvées`
        );
      } else {
        showToast('Aucune station trouvée');
      }
    }
  } catch (err) {
    console.error('Stations error:', err);
    if (typeof showToast === 'function') showToast('Erreur lors du chargement des stations');
  }
}

// ──────────────────────────────────────
// RENDU — markers + drawer
// ──────────────────────────────────────
function clearStationMarkers(closeDrawer = true) {
  stationMarkers.forEach(({ marker }) => marker.remove());
  stationMarkers = [];

  if (closeDrawer) closeStationPopup();
}

function renderStationMarkers(stations) {
  if (!stationsVisible || !window.map || !window.mapboxgl && typeof mapboxgl === 'undefined') return;

  const visibleStations = getStationsForCurrentContext(stations);

  visibleStations.forEach((s) => {
    if (!s.lat || !s.lng) return;

    const brand = getBrand(s.brand || s.name);
    const diesel = s.prices?.Gazole;
    const stationId = getStationId(s);
    const isSelected = selectedStationId === stationId;

    const el = document.createElement('div');
    el.style.cssText = `
      background:${brand.bg};
      border:2px solid ${brand.color};
      outline:${isSelected ? '2px solid #00d4ff' : 'none'};
      outline-offset:1px;
      border-radius:10px;
      padding:4px 6px 2px;
      box-sizing:border-box;
      width:42px;
      min-width:42px;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:1px;
      cursor:pointer;
      text-align:center;
      filter:${isSelected ? 'drop-shadow(0 0 10px rgba(0,212,255,0.9))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))'};
      transition:transform 0.15s ease;
      font-family:'Syne',sans-serif;
      z-index:${isSelected ? '20' : '1'};
      touch-action:manipulation;
      user-select:none;
      -webkit-tap-highlight-color: transparent;
    `;

    el.innerHTML = `
      <div style="font-size:11px;font-weight:800;color:${brand.color};line-height:1">${escapeHtml(brand.abbr)}</div>
      ${
        diesel
          ? `<div style="font-size:9px;font-weight:500;color:${brand.color};font-family:'DM Mono',monospace">€${diesel.toFixed(3)}</div>`
          : '<div style="font-size:9px;color:#999">⛽</div>'
      }
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${brand.color};margin-top:2px"></div>
    `;

    el.addEventListener('mouseenter', () => {
      el.style.transform = isSelected ? 'scale(1.14) translateY(-4px)' : 'scale(1.1) translateY(-3px)';
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = isSelected ? 'scale(1.08) translateY(-2px)' : '';
    });

    el.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openStationPopup(s);
    });

    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([s.lng, s.lat])
      .addTo(window.map);

    stationMarkers.push({ marker, station: s, el });
  });
}

function ensureStationDrawer() {
  let drawer = document.getElementById('station-drawer');
  if (drawer) return drawer;

  // si tu ne l’as pas dans le HTML, on le crée
  drawer = document.createElement('div');
  drawer.id = 'station-drawer';
  drawer.className = 'station-drawer hidden';
  document.body.appendChild(drawer);
  return drawer;
}

function openStationPopup(station) {
  selectedStationId = getStationId(station);
  refreshStationSelection();

  const drawer = ensureStationDrawer();
  const brand = getBrand(station.brand || station.name);
  const prices = station.prices || {};
  const hasPrices = Object.keys(prices).length > 0;

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

  const sortedPriceEntries = Object.entries(prices).sort((a, b) => {
    const ia = FUEL_ORDER.includes(a[0]) ? FUEL_ORDER.indexOf(a[0]) : 999;
    const ib = FUEL_ORDER.includes(b[0]) ? FUEL_ORDER.indexOf(b[0]) : 999;
    return ia - ib;
  });

  const fuelsHTML = hasPrices
    ? sortedPriceEntries.map(([fuel, price]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span>${escapeHtml((FUEL_LABELS[fuel] || { label: fuel }).label)}</span>
        <strong>€ ${Number(price).toFixed(3)}</strong>
      </div>
    `).join('')
    : `<div style="opacity:.6;padding:10px 0">Prix non disponibles</div>`;

  const safeName = escapeJsString(station.name || brand.full || 'Station');

  drawer.innerHTML = `
    <div style="background:${brand.color};padding:14px 16px;font-weight:800;font-size:18px;color:#fff">
      ${escapeHtml(brand.full || station.name || 'Station')}
    </div>
    <div style="padding:14px 16px;color:#fff">
      ${station.address ? `<div style="font-size:12px;opacity:.7;margin-bottom:8px">📍 ${escapeHtml(station.address)}</div>` : ''}
      <div style="font-size:11px;opacity:.45;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px">Carburants & Prix</div>
      ${fuelsHTML}
      ${servicesHTML ? `<div style="margin-top:12px;font-size:18px;letter-spacing:4px">${servicesHTML}</div>` : ''}
      <div style="display:flex;gap:10px;margin-top:14px">
        <button onclick="navigateToStation(${station.lat}, ${station.lng}, '${safeName}')" style="flex:1;background:#0b43ff;color:#fff;border:none;border-radius:14px;padding:12px 14px;font-weight:700">→ Y aller</button>
        <button onclick="closeStationPopup()" style="flex:1;background:rgba(255,255,255,.06);color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 14px">Fermer</button>
      </div>
    </div>
  `;

  drawer.classList.remove('hidden');
}

function closeStationPopup() {
  const drawer = document.getElementById('station-drawer');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.innerHTML = '';
  }

  selectedStationId = null;
  refreshStationSelection();
}

function navigateToStation(lat, lng, name) {
  closeStationPopup();

  const input = document.getElementById('search-input');
  if (input) input.value = name;

  if (typeof calculateRoutes === 'function') {
    calculateRoutes(lat, lng, `${name} (Station essence)`);
  }
}

function toggleStations() {
  stationsVisible = !stationsVisible;

  if (stationsVisible) {
    clearStationMarkers(false);
    renderStationMarkers(stationsData);
    refreshStationSelection();
  } else {
    clearStationMarkers(true);
  }

  const btn = document.getElementById('stations-toggle');
  if (btn) btn.style.opacity = stationsVisible ? '1' : '0.4';

  if (typeof showToast === 'function') {
    showToast(stationsVisible ? 'Stations affichées' : 'Stations masquées');
  }
}

// ──────────────────────────────────────
// ALERTES STATIONS (pendant navigation)
// ──────────────────────────────────────
function isAhead(uLat, uLng, bearing, sLat, sLng) {
  if (bearing === null || bearing === undefined) return true;

  const angle = (Math.atan2(sLng - uLng, sLat - uLat) * 180 / Math.PI + 360) % 360;
  const diff = Math.abs(angle - bearing);
  return diff < 80 || diff > 280;
}

function checkUpcomingStations(userLat, userLng, bearing) {
  if (!window.navActive || !stationsData.length) return;

  stationsData.forEach((s) => {
    const sid = getStationId(s);
    if (upcomingAlertShown.has(sid)) return;

    if (ARIA_NAV_SHARED.currentRouteGeoJSON?.geometry?.coordinates?.length) {
      if (!isStationNearRoute(s, ARIA_NAV_SHARED.currentRouteGeoJSON.geometry.coordinates, 2.5)) return;
    }

    const dist = haversineKm(userLat, userLng, s.lat, s.lng);
    if (dist > 5 || dist < 0.3) return;
    if (bearing !== null && bearing !== undefined && !isAhead(userLat, userLng, bearing, s.lat, s.lng)) return;

    upcomingAlertShown.add(sid);

    const brand = getBrand(s.brand || s.name);
    const diesel = s.prices?.Gazole;
    const sp95 = s.prices?.SP95 || s.prices?.E10;
    const distStr = dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`;

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

// ──────────────────────────────────────
// EXPOSITION GLOBALE
// ──────────────────────────────────────
window.haversineKm = haversineKm;
window.loadStationsAlongRoute = loadStationsAlongRoute;
window.loadStationsNearUser = loadStationsNearUser;
window.loadStationsInBbox = loadStationsInBbox;

window.renderStationMarkers = renderStationMarkers;
window.clearStationMarkers = clearStationMarkers;

window.closeStationPopup = closeStationPopup;
window.navigateToStation = navigateToStation;
window.toggleStations = toggleStations;

window.checkUpcomingStations = checkUpcomingStations;