// ═══════════════════════════════════════
//  ARIA GPS — Moteur de Navigation
// ═══════════════════════════════════════

const ARIA_NAV_SHARED = window.ARIA_NAV_SHARED || (window.ARIA_NAV_SHARED = {
  currentRouteGeoJSON: null,
  currentRouteSteps: [],
  currentStepIndex: 0,
});

let currentRoutes = [];
let activeRouteIndex = 0;
let navActive = false;
let navInterval = null;
let routeLayerIds = [];
let destinationMarker = null;
let searchTimeout = null;
let wellbeingInterval = null;

// ── RECHERCHE ─────────────────────────────────

function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      hideSearchResults();
      return;
    }
    searchTimeout = setTimeout(() => searchPlaces(q), 350);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (q) searchPlaces(q);
    }
  });
}

async function startSearch() {
  const q = document.getElementById('search-input')?.value.trim();
  if (!q) return;
  await searchPlaces(q);
}

async function searchPlaces(query) {
  if (!ARIA_CONFIG.MAPBOX_TOKEN || ARIA_CONFIG.MAPBOX_TOKEN.includes('VOTRE')) {
    showToast('Clé Mapbox manquante dans config.js');
    return [];
  }

  const center = userLocation
    ? `${userLocation.lng},${userLocation.lat}`
    : `${ARIA_CONFIG.DEFAULT_CENTER[0]},${ARIA_CONFIG.DEFAULT_CENTER[1]}`;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${ARIA_CONFIG.MAPBOX_TOKEN}` +
    `&proximity=${center}&language=fr&limit=6&country=fr,be,ch,lu`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Geocoding error ' + res.status);

    const data = await res.json();
    window._searchResults = data.features || [];
    displaySearchResults(window._searchResults);
    return window._searchResults;
  } catch (err) {
    console.error('Recherche:', err);
    showToast('Erreur de recherche — vérifiez votre clé Mapbox');
    return [];
  }
}

function displaySearchResults(features) {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!features.length) {
    container.innerHTML = `
      <div class="search-item">
        <div class="search-item-icon">🔍</div>
        <div><div class="search-item-name">Aucun résultat</div></div>
      </div>
    `;
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = features.map((f, i) => {
    const icon = getPlaceIcon(f.place_type);
    const name = f.text || f.place_name;
    const addr = f.place_name.length > 50
      ? f.place_name.substring(0, 50) + '…'
      : f.place_name;

    return `
      <div class="search-item" onclick="selectDestination(${i})">
        <div class="search-item-icon">${icon}</div>
        <div style="min-width:0;flex:1">
          <div class="search-item-name">${name}</div>
          <div class="search-item-addr">${addr}</div>
        </div>
      </div>
    `;
  }).join('');

  container.classList.remove('hidden');
}

function hideSearchResults() {
  const c = document.getElementById('search-results');
  if (c) c.classList.add('hidden');
}

function getPlaceIcon(types) {
  if (!types || !types[0]) return '📍';
  const t = types[0];
  if (t === 'address') return '🏠';
  if (t === 'poi') return '📍';
  if (t === 'place' || t === 'locality' || t === 'municipality') return '🏙';
  if (t === 'region') return '🗺';
  if (t === 'postcode') return '📮';
  return '📍';
}

async function selectDestination(index) {
  const feat = window._searchResults && window._searchResults[index];
  if (!feat) {
    showToast('Erreur — réessayez');
    return;
  }

  hideSearchResults();

  const input = document.getElementById('search-input');
  if (input) input.value = feat.place_name;

  const [lng, lat] = feat.center;
  await calculateRoutes(lat, lng, feat.place_name);
}

function quickDest(label) {
  const input = document.getElementById('search-input');
  if (input) input.value = label;
  searchPlaces(label);
}

// ── SYNCHRO ROUTE <-> STATIONS ─────────────────

function findFirstUsefulStepIndex(steps) {
  if (!Array.isArray(steps) || !steps.length) return 0;

  for (let i = 0; i < steps.length; i++) {
    const type = String(steps[i]?.maneuver?.type || '').toLowerCase();
    if (type !== 'depart') return i;
  }

  return 0;
}

async function syncRouteWithStations(route) {
  if (!route?.geometry?.coordinates?.length) return;

  ARIA_NAV_SHARED.currentRouteGeoJSON = {
    type: 'Feature',
    geometry: route.geometry,
    properties: {},
  };

  ARIA_NAV_SHARED.currentRouteSteps = route.legs?.[0]?.steps || [];
  ARIA_NAV_SHARED.currentStepIndex = findFirstUsefulStepIndex(ARIA_NAV_SHARED.currentRouteSteps);

  if (typeof upcomingAlertShown !== 'undefined') {
    upcomingAlertShown.clear();
  }

  const firstStep = ARIA_NAV_SHARED.currentRouteSteps[ARIA_NAV_SHARED.currentStepIndex];
  if (firstStep) {
    updateTurnInstruction(firstStep, firstStep.distance || 0);
  }

  if (typeof loadStationsAlongRoute === 'function') {
    await loadStationsAlongRoute(route.geometry.coordinates);
  }

  if (
    typeof clearStationMarkers === 'function' &&
    typeof renderStationMarkers === 'function' &&
    typeof stationsData !== 'undefined'
  ) {
    clearStationMarkers(false);
    renderStationMarkers(stationsData);
  }
}

function getDistanceToStepManeuverMeters(userLat, userLng, step) {
  const loc = step?.maneuver?.location;
  if (!Array.isArray(loc) || loc.length < 2) return Infinity;

  const [lng, lat] = loc;
  return haversineKm(userLat, userLng, lat, lng) * 1000;
}

function updateNavigationProgress(userLat, userLng, bearing = null) {
  if (!navActive) return;

  const steps = ARIA_NAV_SHARED.currentRouteSteps;
  if (!Array.isArray(steps) || !steps.length) return;

  let bestIndex = ARIA_NAV_SHARED.currentStepIndex;
  let bestDist = Infinity;

  const searchFrom = Math.max(0, ARIA_NAV_SHARED.currentStepIndex - 1);
  const searchTo = Math.min(steps.length - 1, ARIA_NAV_SHARED.currentStepIndex + 4);

  for (let i = searchFrom; i <= searchTo; i++) {
    const step = steps[i];
    const d = getDistanceToStepManeuverMeters(userLat, userLng, step);

    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  if (bestDist < 25 && bestIndex < steps.length - 1) {
    bestIndex += 1;
    bestDist = getDistanceToStepManeuverMeters(userLat, userLng, steps[bestIndex]);
  }

  ARIA_NAV_SHARED.currentStepIndex = bestIndex;

  const currentStep = steps[ARIA_NAV_SHARED.currentStepIndex];
  if (currentStep) {
    updateTurnInstruction(currentStep, bestDist);
  }

  if (typeof checkUpcomingStations === 'function') {
    checkUpcomingStations(userLat, userLng, bearing);
  }
}

// ── CALCUL DES ITINÉRAIRES ────────────────────

async function calculateRoutes(destLat, destLng, destName) {
  if (!ARIA_CONFIG.MAPBOX_TOKEN || ARIA_CONFIG.MAPBOX_TOKEN.includes('VOTRE')) {
    showToast('Clé Mapbox manquante');
    return;
  }

  const origin = userLocation
    ? [userLocation.lng, userLocation.lat]
    : ARIA_CONFIG.DEFAULT_CENTER;

  showToast('Calcul des itinéraires…');
  setState('idle');

  const profiles = [
    { id: 'eco',    label: 'Éco optimal', profile: 'driving-traffic', excludes: '' },
    { id: 'fast',   label: 'Rapide', profile: 'driving-traffic', excludes: '' },
    { id: 'notoll', label: 'Sans péage', profile: 'driving-traffic', excludes: 'toll' },
  ];

  try {
    const promises = profiles.map(p =>
      fetchRoute(origin, [destLng, destLat], p.profile, p.excludes)
        .then(route => route ? { ...p, route } : null)
        .catch(() => null)
    );

    const results = (await Promise.all(promises)).filter(Boolean);

    if (!results.length) {
      showToast('Impossible de calculer un itinéraire — vérifiez votre connexion');
      return;
    }

    currentRoutes = results;
    activeRouteIndex = 0;

    await syncRouteWithStations(results[0].route);

    if (destinationMarker) {
      destinationMarker.remove();
      destinationMarker = null;
    }

    const el = document.createElement('div');
    el.style.cssText =
      'width:16px;height:16px;border-radius:50%;background:#00d4ff;border:3px solid white;box-shadow:0 0 14px rgba(0,212,255,0.8);position:relative;z-index:5';

    destinationMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([destLng, destLat])
      .addTo(map);

    drawRoutes(results);
    showRouteOptions(results, destName);

    const coords = results[0].route.geometry.coordinates;
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new mapboxgl.LngLatBounds(coords[0], coords[0])
    );

    map.fitBounds(bounds, {
      padding: { top: 160, bottom: 420, left: 40, right: 40 },
      duration: 1000,
      maxZoom: 14,
    });
  } catch (err) {
    console.error('calculateRoutes:', err);
    showToast('Erreur calcul itinéraire');
  }
}

async function fetchRoute(from, to, profile, excludes) {
  let url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?access_token=${ARIA_CONFIG.MAPBOX_TOKEN}` +
    `&geometries=geojson&steps=true&language=fr&overview=full`;

  if (excludes) url += `&exclude=${excludes}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Directions API ' + res.status);

  const data = await res.json();
  return data.routes?.[0] || null;
}

function drawRoutes(routes) {
  for (let i = 0; i < 10; i++) {
    ['route-' + i, 'route-' + i + '-bg'].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
      try { if (map.getSource(id)) map.removeSource(id); } catch {}
    });
  }

  routeLayerIds.forEach(id => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    try { if (map.getSource(id)) map.removeSource(id); } catch {}
  });

  routeLayerIds = [];

  [...routes].reverse().forEach((r, ri) => {
    const i = routes.length - 1 - ri;
    const isActive = i === activeRouteIndex;
    const id = `route-${i}`;

    try {
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'Feature', geometry: r.route.geometry },
      });

      map.addLayer({
        id: id + '-bg',
        type: 'line',
        source: id,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': isActive ? '#00d4ff' : 'rgba(255,255,255,0.2)',
          'line-width': isActive ? 7 : 3,
          'line-opacity': isActive ? 0.95 : 0.5,
        },
      });

      routeLayerIds.push(id, id + '-bg');
    } catch (err) {
      console.warn('drawRoutes layer error:', err);
    }
  });
}

function showRouteOptions(routes, destName) {
  const list = document.getElementById('routes-list');
  if (!list) return;

  list.innerHTML = routes.map((r, i) => {
    const mins = Math.round(r.route.duration / 60);
    const km = (r.route.distance / 1000).toFixed(1);
    const vehicle = ARIA_CONFIG.VEHICLE || {
      consumption_per_100km: 7.5,
      fuel_price_per_liter: 1.82,
    };
    const liters = ((r.route.distance / 1000) * vehicle.consumption_per_100km / 100).toFixed(1);
    const cost = (parseFloat(liters) * vehicle.fuel_price_per_liter).toFixed(2);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const timeStr = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    const isActive = i === activeRouteIndex;

    return `
      <div class="route-pill ${isActive ? 'route-active' : 'route-idle'}" onclick="selectRoute(${i})" style="cursor:pointer">
        <div class="rp-label">${r.label}</div>
        <div class="rp-time ${isActive ? 'rp-time-a' : 'rp-time-i'}">${timeStr}</div>
        <div class="rp-price ${isActive ? 'rp-price-a' : 'rp-price-i'}">${km} km · €${cost}</div>
      </div>
    `;
  }).join('');

  const navDest = document.getElementById('nav-dest-name');
  if (navDest) navDest.textContent = destName.split(',')[0];

  setState('routes');
}

async function selectRoute(i) {
  if (i < 0 || i >= currentRoutes.length) return;

  activeRouteIndex = i;
  drawRoutes(currentRoutes);

  document.querySelectorAll('#routes-list .route-pill').forEach((el, j) => {
    const isActive = j === i;
    el.className = `route-pill ${isActive ? 'route-active' : 'route-idle'}`;
    const time = el.querySelector('.rp-time');
    const price = el.querySelector('.rp-price');
    if (time) time.className = `rp-time ${isActive ? 'rp-time-a' : 'rp-time-i'}`;
    if (price) price.className = `rp-price ${isActive ? 'rp-price-a' : 'rp-price-i'}`;
  });

  await syncRouteWithStations(currentRoutes[i].route);
}

// ── NAVIGATION ACTIVE ─────────────────────────

async function startNavigation() {
  const route = currentRoutes[activeRouteIndex];
  if (!route) {
    showToast('Sélectionnez un itinéraire d\'abord');
    return;
  }

  navActive = true;
  isFollowing = true;

  await syncRouteWithStations(route.route);

  const destName = document.getElementById('nav-dest-name')?.textContent || 'destination';
  const mins = Math.round(route.route.duration / 60);
  const km = (route.route.distance / 1000).toFixed(1);
  const vehicle = ARIA_CONFIG.VEHICLE || {
    consumption_per_100km: 7.5,
    fuel_price_per_liter: 1.82,
    co2_per_liter: 2.31,
  };
  const liters = ((route.route.distance / 1000) * vehicle.consumption_per_100km / 100).toFixed(1);
  const cost = (parseFloat(liters) * vehicle.fuel_price_per_liter).toFixed(2);
  const co2 = (parseFloat(liters) * vehicle.co2_per_liter).toFixed(1);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const timeStr = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
  const arrival = new Date(Date.now() + route.route.duration * 1000);
  const arrStr = arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('eta-time', timeStr);
  set('nav-remaining-time', timeStr);
  set('nav-remaining-dist', `${km} km restants`);
  set('nav-fuel-cost', `€${cost}`);
  set('nav-fuel-liters', `${liters} L estimés`);
  set('nav-co2', `-${co2} kg`);
  set('stat-dist', `${km} km`);
  set('stat-fuel', `€${cost}`);
  set('stat-arr', arrStr);

  setState('nav');

  document.getElementById('dest-card')?.classList.add('hidden');
  document.getElementById('nav-header')?.classList.remove('hidden');

  isFollowing = true;
  map.easeTo({
    center: userLocation ? [userLocation.lng, userLocation.lat] : ARIA_CONFIG.DEFAULT_CENTER,
    pitch: 60,
    zoom: 16,
    bearing: userLocation?.heading || 0,
    duration: 1200,
  });

  if (typeof ariaOnNavStart === 'function') {
    ariaOnNavStart(destName, arrStr);
  } else if (typeof speakARIA === 'function') {
    speakARIA(`Navigation démarrée vers ${destName}. Arrivée prévue à ${arrStr}.`);
  }

  if (wellbeingInterval) clearInterval(wellbeingInterval);
  wellbeingInterval = setInterval(() => {
    if (typeof ariaWellbeingCheck === 'function') ariaWellbeingCheck();
  }, 7200000);

  setTimeout(simulateTrafficAlert, 20000);
}

function updateTurnInstruction(step, overrideDistance = null) {
  if (!step) return;

  const dist = overrideDistance ?? step.distance ?? 0;
  const distStr = dist > 1000 ? (dist / 1000).toFixed(1) : Math.round(dist).toString();
  const unit = dist > 1000 ? 'km' : 'm';

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('turn-street', step.name || 'Continuer');
  set('turn-sub', step.maneuver?.instruction || 'Continuez tout droit');
  set('dist-big', distStr);
  set('dist-unit', unit);

  const svg = document.getElementById('turn-svg');
  if (svg) svg.innerHTML = getTurnSVG(step.maneuver?.type, step.maneuver?.modifier);
}

function getTurnSVG(type, modifier) {
  const t = String(type || '').toLowerCase();
  const m = String(modifier || '').toLowerCase();
  const s = 'stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"';

  if (t === 'depart' || t === 'continue' || t === 'new name') {
    return `<path d="M14 22V6M14 6l-5 5M14 6l5 5" ${s}/>`;
  }

  if (t === 'turn') {
    if (m.includes('right')) {
      if (m.includes('slight')) return `<path d="M8 20V12c0-3 2-5 5-5h5M18 7l-4-3M18 7l-4 3" ${s}/>`;
      if (m.includes('sharp')) return `<path d="M10 22V15c0-5 4-9 9-9h1M20 6l-4-3M20 6l-4 3" ${s}/>`;
      return `<path d="M8 20V10h8M16 10l-5-5M16 10l-5 5" ${s}/>`;
    }

    if (m.includes('left')) {
      if (m.includes('slight')) return `<path d="M20 20V12c0-3-2-5-5-5h-5M10 7l4-3M10 7l4 3" ${s}/>`;
      if (m.includes('sharp')) return `<path d="M18 22V15c0-5-4-9-9-9H8M8 6l4-3M8 6l4 3" ${s}/>`;
      return `<path d="M20 20V10h-8M12 10l5-5M12 10l5 5" ${s}/>`;
    }
  }

  if (t === 'roundabout' || t === 'rotary') {
    return `<circle cx="14" cy="14" r="7" ${s}/><path d="M14 7V4M17 5l-3 3-3-3" ${s}/>`;
  }

  if (t === 'uturn') {
    return `<path d="M18 20V10c0-3-2-5-5-5h-3M10 5l3-3M10 5l3 3" ${s}/>`;
  }

  if (t === 'merge' || t === 'fork' || t === 'on ramp') {
    if (m.includes('left')) {
      return `<path d="M18 22V14c0-3-2-5-5-5h-3M10 9l-4-4M10 9L6 13" ${s}/>`;
    }
    if (m.includes('right')) {
      return `<path d="M10 22V14c0-3 2-5 5-5h3M18 9l4-4M18 9l4 4" ${s}/>`;
    }
  }

  if (t === 'off ramp') {
    if (m.includes('left')) {
      return `<path d="M18 22V10M18 10H9M9 10l4-4M9 10l4 4" ${s}/>`;
    }
    if (m.includes('right')) {
      return `<path d="M10 22V10M10 10h9M19 10l-4-4M19 10l-4 4" ${s}/>`;
    }
  }

  if (t === 'arrive') {
    return `<circle cx="14" cy="14" r="6" ${s}/><circle cx="14" cy="14" r="2" fill="white"/>`;
  }

  return `<path d="M14 22V6M14 6l-5 5M14 6l5 5" ${s}/>`;
}

function stopNavigation() {
  navActive = false;
  isFollowing = false;

  if (navInterval) {
    clearInterval(navInterval);
    navInterval = null;
  }

  if (wellbeingInterval) {
    clearInterval(wellbeingInterval);
    wellbeingInterval = null;
  }

  routeLayerIds.forEach(id => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    try { if (map.getSource(id)) map.removeSource(id); } catch {}
  });
  routeLayerIds = [];

  if (destinationMarker) {
    destinationMarker.remove();
    destinationMarker = null;
  }

  document.getElementById('dest-card')?.classList.remove('hidden');
  document.getElementById('nav-header')?.classList.add('hidden');

  const input = document.getElementById('search-input');
  if (input) input.value = '';

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('eta-time', '—');

  if (typeof clearAlerts === 'function') clearAlerts();

  ARIA_NAV_SHARED.currentRouteGeoJSON = null;
  ARIA_NAV_SHARED.currentRouteSteps = [];
  ARIA_NAV_SHARED.currentStepIndex = 0;

  if (
    typeof clearStationMarkers === 'function' &&
    typeof renderStationMarkers === 'function' &&
    typeof stationsData !== 'undefined'
  ) {
    clearStationMarkers(false);
    renderStationMarkers(stationsData);
  }

  setState('idle');
  showToast('Navigation arrêtée');

  if (typeof setAriaMsg === 'function') {
    setAriaMsg('idle', 'Navigation terminée. Bonne arrivée ! Où souhaitez-vous aller maintenant ?');
  }
}

function cancelRoute() {
  routeLayerIds.forEach(id => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    try { if (map.getSource(id)) map.removeSource(id); } catch {}
  });

  routeLayerIds = [];

  if (destinationMarker) {
    destinationMarker.remove();
    destinationMarker = null;
  }

  const input = document.getElementById('search-input');
  if (input) input.value = '';

  currentRoutes = [];

  ARIA_NAV_SHARED.currentRouteGeoJSON = null;
  ARIA_NAV_SHARED.currentRouteSteps = [];
  ARIA_NAV_SHARED.currentStepIndex = 0;

  setState('idle');
}

function simulateTrafficAlert() {
  if (!navActive) return;

  const alerts = [
    { type: 'warn', text: 'Ralentissement signalé à 2 km', badge: '+5 min', cls: 'badge-red' },
    { type: 'info', text: 'Radar fixe dans 600 m', badge: '80 km/h', cls: 'badge-blue' },
  ];

  alerts.forEach((a, i) => {
    setTimeout(() => {
      if (!navActive) return;
      if (typeof addAlert === 'function') addAlert(a.type, a.text, a.badge, a.cls);
      if (i === 0 && typeof ariaAlertIncident === 'function') ariaAlertIncident(a.text);
    }, i * 5000);
  });
}

// ── EXPOSITION GLOBALE ────────────────────────

window.initSearch = initSearch;
window.startSearch = startSearch;
window.searchPlaces = searchPlaces;
window.selectDestination = selectDestination;
window.quickDest = quickDest;
window.calculateRoutes = calculateRoutes;
window.selectRoute = selectRoute;
window.startNavigation = startNavigation;
window.stopNavigation = stopNavigation;
window.cancelRoute = cancelRoute;
window.updateNavigationProgress = updateNavigationProgress;
window.updateTurnInstruction = updateTurnInstruction;