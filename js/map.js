// ═══════════════════════════════════════
//  ARIA GPS — Carte Mapbox 3D + Search
//  - initMap() : initialise la carte et les bâtiments 3D
//  - updateUserMarker() : marker voiture
//  - updateSpeedUI() : UI vitesse
//  - recenterMap() : recentrage + follow
//  - searchPlaces()/selectDestination()/startSearch()/quickDest() : recherche
// ═══════════════════════════════════════

/* global mapboxgl, ARIA_CONFIG */

(function () {
  // ──────────────────────────────────────
  // STATE
  // ──────────────────────────────────────
  let map = null;
  let userMarker = null;
  let markerStyleInjected = false;

  // Expose map globalement (navigation.js l'utilise)
  Object.defineProperty(window, 'map', {
    get: () => map,
    set: (v) => { map = v; },
    configurable: true
  });

  // follow state est global (navigation.js aussi)
  if (typeof window.isFollowing !== 'boolean') window.isFollowing = true;

  // ──────────────────────────────────────
  // TOAST fallback (au cas où)
  // ──────────────────────────────────────
  if (typeof window.showToast !== 'function') {
    window.showToast = function showToast(msg, duration = 2800) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), duration);
    };
  }

  // ──────────────────────────────────────
  // INIT MAP
  // ──────────────────────────────────────
  window.initMap = function initMap() {
    if (!window.ARIA_CONFIG?.MAPBOX_TOKEN) {
      window.showToast('MAPBOX_TOKEN manquant');
      return;
    }

    mapboxgl.accessToken = ARIA_CONFIG.MAPBOX_TOKEN;

    map = new mapboxgl.Map({
      container: 'map',
      style: ARIA_CONFIG.MAP_STYLE,
      center: ARIA_CONFIG.DEFAULT_CENTER,
      zoom: ARIA_CONFIG.DEFAULT_ZOOM,
      pitch: 58,
      bearing: 0,
      antialias: true,
    });

    // si l’utilisateur bouge la carte → on arrête le follow
    map.on('dragstart', () => { window.isFollowing = false; });
    map.on('rotatestart', () => { window.isFollowing = false; });
    map.on('pitchstart', () => { window.isFollowing = false; });

    map.on('load', () => {
      add3DBuildingsLayer(map);
    });
  };

  function add3DBuildingsLayer(mapInstance) {
    try {
      const layers = mapInstance.getStyle().layers || [];
      let labelLayerId = null;

      for (let i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']) {
          labelLayerId = layers[i].id;
          break;
        }
      }

      if (!mapInstance.getLayer('3d-buildings')) {
        mapInstance.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': [
              'interpolate', ['linear'], ['get', 'height'],
              0, '#0a1020',
              50, '#0d1830',
              100, '#111f3a',
              200, '#152540',
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.88,
          },
        }, labelLayerId || undefined);
      }
    } catch (e) {
      console.warn('3D buildings layer error:', e);
    }
  }

  // ──────────────────────────────────────
  // USER MARKER
  // ──────────────────────────────────────
  function ensureMarkerStyles() {
    if (markerStyleInjected) return;
    markerStyleInjected = true;

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .user-dot-outer {
        width: 24px; height: 24px; border-radius: 50%;
        background: rgba(0,212,255,0.2);
        border: 2px solid #00d4ff;
        display: flex; align-items: center; justify-content: center;
        position: relative;
        animation: userPulse 2s ease-in-out infinite;
      }
      .user-dot-inner {
        width: 10px; height: 10px; border-radius: 50%;
        background: #00d4ff;
      }
      .user-heading-cone {
        position: absolute;
        top: -14px; left: 50%;
        transform: translateX(-50%);
        width: 0; height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-bottom: 14px solid rgba(0,212,255,0.6);
      }
      @keyframes userPulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(0,212,255,0.3); }
        50% { box-shadow: 0 0 0 8px rgba(0,212,255,0); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  window.updateUserMarker = function updateUserMarker(lat, lng, heading) {
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!userMarker) {
      ensureMarkerStyles();

      const el = document.createElement('div');
      el.className = 'user-marker';
      el.style.cssText = 'width:24px;height:24px;position:relative;';

      el.innerHTML = `
        <div class="user-dot-outer">
          <div class="user-dot-inner"></div>
          <div class="user-heading-cone" id="heading-cone"></div>
        </div>
      `;

      userMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      userMarker.setLngLat([lng, lat]);
    }

    // orientation du cône
    if (heading !== null && heading !== undefined && Number.isFinite(heading)) {
      const cone = document.getElementById('heading-cone');
      if (cone) cone.style.transform = `translateX(-50%) rotate(${heading}deg)`;
    }
  };

  // ──────────────────────────────────────
  // SPEED UI (navigation.js l’appelle si dispo)
  // ──────────────────────────────────────
  window.updateSpeedUI = function updateSpeedUI(speedMs) {
    const kmh = Math.max(0, Math.round((speedMs || 0) * 3.6));

    const numEl = document.getElementById('speed-num');
    const panel = document.getElementById('speed-panel');
    const pillEl = document.getElementById('speed-pill');

    if (numEl) numEl.textContent = kmh;
    if (pillEl) pillEl.textContent = `${kmh} km/h`;

    if (panel) panel.classList.toggle('overspeed', kmh > 130);
  };

  // ──────────────────────────────────────
  // RECENTER
  // ──────────────────────────────────────
  window.recenterMap = function recenterMap() {
    const loc = window.userLocation;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
      window.showToast('Position GPS non disponible');
      return;
    }

    window.isFollowing = true;

    try {
      map.flyTo({
        center: [loc.lng, loc.lat],
        pitch: 58,
        bearing: (Number.isFinite(loc.heading) ? loc.heading : 0),
        zoom: Math.max(typeof map.getZoom === 'function' ? map.getZoom() : 16, 16),
        duration: 800,
        essential: true,
        padding: { top: 130, bottom: 220, left: 20, right: 20 },
      });
    } catch (e) {
      console.warn('recenterMap error:', e);
    }
  };

  // ──────────────────────────────────────
  // SEARCH (Mapbox Geocoding)
  // ──────────────────────────────────────
  let lastResults = [];

  function inputEl() { return document.getElementById('search-input'); }
  function resultsEl() { return document.getElementById('search-results'); }

  window.hideSearchResults = window.hideSearchResults || function hideSearchResults() {
    const el = resultsEl();
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
  };

  function renderResults(features) {
    const el = resultsEl();
    if (!el) return;

    if (!features.length) {
      el.innerHTML = `<div style="padding:10px;color:rgba(255,255,255,.7)">Aucun résultat</div>`;
      el.classList.remove('hidden');
      return;
    }

    el.innerHTML = features.map((f, i) => `
      <div data-idx="${i}" style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer">
        <div style="font-weight:700;color:#fff">${(f.text || 'Destination')}</div>
        <div style="font-size:12px;opacity:.65;color:#fff">${(f.place_name || '')}</div>
      </div>
    `).join('');

    el.classList.remove('hidden');

    el.querySelectorAll('[data-idx]').forEach((row) => {
      row.addEventListener('click', async () => {
        const idx = Number(row.getAttribute('data-idx'));
        await window.selectDestination(idx);
      });
    });
  }

  window.searchPlaces = async function searchPlaces(query) {
    const q = String(query || '').trim();
    if (!q) return [];

    if (!window.ARIA_CONFIG?.MAPBOX_TOKEN) {
      window.showToast('MAPBOX_TOKEN manquant');
      return [];
    }

    const prox =
      (window.userLocation?.lng && window.userLocation?.lat)
        ? `&proximity=${encodeURIComponent(`${window.userLocation.lng},${window.userLocation.lat}`)}`
        : '';

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?access_token=${encodeURIComponent(window.ARIA_CONFIG.MAPBOX_TOKEN)}` +
      `&autocomplete=true&language=fr&country=fr&limit=6${prox}`;

    const data = await fetch(url).then(r => r.json()).catch(() => null);
    const features = Array.isArray(data?.features) ? data.features : [];

    lastResults = features;
    renderResults(features);

    return features;
  };

  window.selectDestination = async function selectDestination(index) {
    const f = lastResults[index];
    if (!f?.center?.length) return;

    const [lng, lat] = f.center;
    const name = f.place_name || f.text || 'Destination';

    const input = inputEl();
    if (input) input.value = name;

    window.hideSearchResults();

    if (typeof window.calculateRoutes === 'function') {
      await window.calculateRoutes(lat, lng, name);
    } else {
      window.showToast('calculateRoutes() introuvable');
    }
  };

  // bouton loupe (index.html onclick="startSearch()")
  window.startSearch = window.startSearch || async function startSearch() {
    const q = inputEl()?.value?.trim();
    if (!q) {
      window.showToast('Entrez une destination');
      return;
    }
    return await window.searchPlaces(q);
  };

  // boutons rapides (Maison/Travail/etc.)
  window.quickDest = window.quickDest || function quickDest(value) {
    const input = inputEl();
    if (input) input.value = value;
    return window.searchPlaces(value);
  };
})();