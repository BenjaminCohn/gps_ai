// ═══════════════════════════════════════
//  ARIA GPS — Stations Essence
//  Source prix : OSM + API carburants
// ═══════════════════════════════════════

let stationMarkers = [];
let stationsData = [];
let activeStationPopup = null;
let upcomingAlertShown = new Set();

let selectedStationId = null;
let stationClickLockUntil = 0;
let stationsVisible = true;

const GOV_DATASET_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

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

const FUEL_ORDER = ['Gazole', 'SP95', 'E10', 'SP98', 'E85', 'GPLc', 'HVO100'];

// ── HELPERS ───────────────────────────

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const str = String(value).replace(',', '.').replace(/\s/g, '');
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : null;
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

function escapeJsString(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .finally(() => clearTimeout(timeout));
}

function buildGovAddress(gov) {
  return [
    gov.adresse || gov.address || '',
    gov.cp || gov.postal_code || '',
    gov.ville || gov.city || '',
  ].filter(Boolean).join(' ').trim();
}

function parseGovServices(gov) {
  const raw =
    gov.services ||
    gov.service ||
    gov.services_service ||
    gov.service_service ||
    gov.services_list ||
    [];

  let items = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    items = raw.split(/[;,|]/).map(s => s.trim());
  }

  const out = [];

  items.forEach((item) => {
    const v = String(item).toLowerCase();

    if (v.includes('toilet')) out.push('Toilettes');
    if (v.includes('boutique') || v.includes('shop') || v.includes('aliment')) out.push('Boutique');
    if (v.includes('restaurant') || v.includes('restauration') || v.includes('sandwich')) out.push('Restaurant');
    if (v.includes('lavage') || v.includes('car wash') || v.includes('wash')) out.push('Lavage');
    if (v.includes('wifi') || v.includes('wi-fi')) out.push('Wifi');
  });

  return uniq(out);
}

function extractGovLatLng(gov) {
  let lat =
    normalizeNumber(gov.latitude) ??
    normalizeNumber(gov.Latitude) ??
    normalizeNumber(gov.lat) ??
    normalizeNumber(gov.geom?.lat) ??
    normalizeNumber(gov.geo_point_2d?.lat);

  let lng =
    normalizeNumber(gov.longitude) ??
    normalizeNumber(gov.Longitude) ??
    normalizeNumber(gov.lng) ??
    normalizeNumber(gov.lon) ??
    normalizeNumber(gov.geom?.lon) ??
    normalizeNumber(gov.geom?.lng) ??
    normalizeNumber(gov.geo_point_2d?.lon);

  if ((lat === null || lng === null) && Array.isArray(gov.geom?.coordinates)) {
    lng = normalizeNumber(gov.geom.coordinates[0]);
    lat = normalizeNumber(gov.geom.coordinates[1]);
  }

  if (lat !== null && Math.abs(lat) > 90) lat /= 100000;
  if (lng !== null && Math.abs(lng) > 180) lng /= 100000;

  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

function getBrand(name) {
  if (!name) return BRANDS.default;

  const key = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(BRANDS)) {
    if (k !== 'default' && key.includes(k)) return v;
  }

  return {
    ...BRANDS.default,
    abbr: name.slice(0, 2).toUpperCase(),
    full: name,
  };
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

// ── CHARGEMENT PRINCIPAL ──────────────────────

async function loadStationsAlongRoute(routeCoords) {
  if (!routeCoords || !routeCoords.length) return;

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
    showToast('Recherche des stations carburant...');

    const [osmRes, govRes] = await Promise.allSettled([
      fetchStationsFromOSM(minLat, maxLat, minLng, maxLng),
      fetchPricesGouvernement(minLat, maxLat, minLng, maxLng),
    ]);

    const osmStations = osmRes.status === 'fulfilled' ? osmRes.value : [];
    const govPrices = govRes.status === 'fulfilled' ? govRes.value : [];

    if (osmRes.status === 'rejected') {
      console.warn('OSM error:', osmRes.reason);
    }
    if (govRes.status === 'rejected') {
      console.warn('API carburants error:', govRes.reason);
    }

    const merged = mergeStationsAndPrices(osmStations, govPrices);
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
    } else {
      showToast('Aucune station trouvée');
    }
  } catch (err) {
    console.error('Stations error:', err);
    showToast('Erreur lors du chargement des stations');
  }
}

// ── OSM : LOCALISATION ────────────────────────

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

    const data = await res.json();

    return (data.elements || [])
      .map(el => ({
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
      }))
      .filter(s => s.lat && s.lng);
  } catch (err) {
    console.warn('OSM error:', err);
    return [];
  }
}

function parseOSMServices(tags) {
  const s = [];
  if (tags.toilets === 'yes' || tags['amenity:toilets'] === 'yes') s.push('Toilettes');
  if (tags.shop === 'convenience') s.push('Boutique');
  if (tags.restaurant === 'yes' || tags.fast_food === 'yes') s.push('Restaurant');
  if (tags.car_wash === 'yes') s.push('Lavage');
  if (tags.wifi === 'yes' || tags.internet_access === 'wlan') s.push('Wifi');
  return uniq(s);
}

// ── PRIX CARBURANTS : API ─────────────────────

async function fetchPricesGouvernement(minLat, maxLat, minLng, maxLng) {
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const diagonalKm = haversineKm(minLat, minLng, maxLat, maxLng);
  const radiusKm = Math.max(10, Math.min(45, Math.ceil(diagonalKm / 2) + 5));

  const fields = [
    'id',
    'enseigne',
    'enseignes',
    'adresse',
    'cp',
    'ville',
    'latitude',
    'longitude',
    'geom',
    'services',
    'gazole_prix',
    'sp95_prix',
    'sp98_prix',
    'e10_prix',
    'e85_prix',
    'gplc_prix',
    'hvo100_prix',
  ].join(',');

  try {
    const url = new URL(GOV_DATASET_URL);
    url.searchParams.set('select', fields);
    url.searchParams.set('limit', '200');
    url.searchParams.set(
      'where',
      `within_distance(geom, geom'POINT(${centerLng} ${centerLat})', ${radiusKm}km)`
    );

    const data = await fetchJsonWithTimeout(url.toString(), {
      headers: { Accept: 'application/json' },
    }, 8000);

    return Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    console.warn('Primary fuel API query failed, fallback bbox:', err);

    try {
      const url = new URL(GOV_DATASET_URL);
      url.searchParams.set('select', fields);
      url.searchParams.set('limit', '200');
      url.searchParams.set(
        'where',
        `latitude >= ${minLat} AND latitude <= ${maxLat} AND longitude >= ${minLng} AND longitude <= ${maxLng}`
      );

      const data = await fetchJsonWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' },
      }, 8000);

      return Array.isArray(data?.results) ? data.results : [];
    } catch (fallbackErr) {
      console.warn('Fallback fuel API failed:', fallbackErr);
      return [];
    }
  }
}

function parsePricesFromGov(station) {
  const prices = {};

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
      if (v > 10) v /= 1000;

      prices[fuelName] = v;
      break;
    }
  }

  // compat ancien format
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

function mergeStationsAndPrices(osmStations, govData) {
  const merged = [...osmStations];

  if (!Array.isArray(govData) || !govData.length) return merged;

  govData.forEach((gov) => {
    const coords = extractGovLatLng(gov);
    if (!coords) return;

    const parsedPrices = parsePricesFromGov(gov);
    const govName =
      gov.enseigne ||
      gov.enseignes ||
      gov.Enseignes ||
      gov.brand ||
      gov.nom ||
      'Station';

    const govAddress = buildGovAddress(gov) || gov.adresse || gov.Adresse || '';
    const govServices = parseGovServices(gov);

    let best = null;
    let bestDist = 0.35; // km

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

// ── RENDU MARQUEURS ───────────────────────────

function renderStationMarkers(stations) {
  if (!stationsVisible) return;

  const visibleStations = getVisibleStations(stations);

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

    const marker = new mapboxgl.Marker({
      element: el,
      anchor: 'bottom',
    })
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

  refreshStationSelection();

  const brand = getBrand(station.brand || station.name);
  const prices = station.prices || {};
  const hasPrices = Object.keys(prices).length > 0;

  const distStr = userLocation
    ? (() => {
        const d = haversineKm(userLocation.lat, userLocation.lng, station.lat, station.lng);
        return d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
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

  const sortedPriceEntries = Object.entries(prices).sort((a, b) => {
    const ia = FUEL_ORDER.includes(a[0]) ? FUEL_ORDER.indexOf(a[0]) : 999;
    const ib = FUEL_ORDER.includes(b[0]) ? FUEL_ORDER.indexOf(b[0]) : 999;
    return ia - ib;
  });

  const fuelsHTML = hasPrices
    ? sortedPriceEntries.map(([fuel, price]) => {
        const info = FUEL_LABELS[fuel] || { label: fuel, icon: '⛽', color: '#6B7280' };
        const priceColor = price < 1.75 ? '#10B981' : price < 1.95 ? '#00d4ff' : '#F59E0B';

        return `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.05)">
            <span style="font-size:14px;width:18px">${info.icon}</span>
            <span style="flex:1;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500">${escapeHtml(info.label)}</span>
            <span style="font-family:'DM Mono',monospace;font-size:15px;font-weight:600;color:${priceColor}">€ ${price.toFixed(3)}</span>
          </div>
        `;
      }).join('')
    : `
      <div style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;padding:10px 0">
        Prix non disponibles
      </div>
    `;

  const safeName = escapeJsString(station.name || brand.full || 'Station');
  const safeTitle = escapeHtml(brand.full || station.name || 'Station');
  const safeAddress = escapeHtml(station.address || '');
  const safeOpeningHours = escapeHtml(station.openingHours || '');

  const html = `
    <div style="font-family:'Syne',sans-serif;background:#0a0f1e;border-radius:18px;overflow:hidden;width:270px;border:0.5px solid rgba(255,255,255,0.1)">
      <div style="background:${brand.color};padding:14px 16px">
        <div style="font-size:17px;font-weight:800;color:white">${safeTitle}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:3px">⛽ Station carburant${distStr ? ' · ' + distStr : ''}</div>
        ${safeAddress ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">📍 ${safeAddress}</div>` : ''}
        ${safeOpeningHours ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">🕐 ${safeOpeningHours}</div>` : ''}
      </div>

      <div style="padding:12px 16px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
        <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:700">
          Carburants & Prix
        </div>
        ${fuelsHTML}
      </div>

      ${servicesHTML ? `
        <div style="padding:10px 16px;border-bottom:0.5px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">
            Services
          </div>
          <div style="font-size:16px;letter-spacing:3px">${servicesHTML}</div>
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;padding:12px 16px">
        <button onclick="navigateToStation(${station.lat}, ${station.lng}, '${safeName}')" style="flex:1;background:linear-gradient(135deg,#0050cc,#003db5);border:none;border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:white;cursor:pointer">
          → Y aller
        </button>
        <button onclick="closeStationPopup()" style="flex:1;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;font-family:'Syne',sans-serif;font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer">
          Fermer
        </button>
      </div>
    </div>
  `;

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: '290px',
    anchor: 'bottom',
    offset: [0, -52],
  });

  // empêche Mapbox de décaler la carte automatiquement vers la gauche
  popup._adjustPan = () => {};

  popup
    .setLngLat([station.lng, station.lat])
    .setHTML(html)
    .addTo(map);

  window._activePopup = popup;
  activeStationPopup = popup;
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
  refreshStationSelection();
}

function navigateToStation(lat, lng, name) {
  if (activeStationPopup) {
    activeStationPopup.remove();
    activeStationPopup = null;
  }
  if (window._activePopup) {
    window._activePopup.remove();
    window._activePopup = null;
  }

  const input = document.getElementById('search-input');
  if (input) input.value = name;

  calculateRoutes(lat, lng, `${name} (Station essence)`);
}

// ── ALERTES ROUTE ─────────────────────────────

function checkUpcomingStations(userLat, userLng, bearing) {
  if (!navActive || !stationsData.length) return;

  stationsData.forEach((s) => {
    const sid = getStationId(s);

    if (upcomingAlertShown.has(sid)) return;

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
    refreshStationSelection();
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
    if (activeStationPopup) {
      activeStationPopup.remove();
      activeStationPopup = null;
    }
    if (window._activePopup) {
      window._activePopup.remove();
      window._activePopup = null;
    }
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

// ── EXPOSITION GLOBALE ────────────────────────
// utile si ton script tourne en module ou si les boutons popup utilisent onclick

window.loadStationsAlongRoute = loadStationsAlongRoute;
window.loadStationsNearUser = loadStationsNearUser;
window.loadStationsInBbox = loadStationsInBbox;
window.closeStationPopup = closeStationPopup;
window.navigateToStation = navigateToStation;
window.toggleStations = toggleStations;
window.checkUpcomingStations = checkUpcomingStations;
window.clearStationMarkers = clearStationMarkers;