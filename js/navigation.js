// ═══════════════════════════════════════
//  ARIA GPS — Contrôleur Principal (SAFE)
//  - évite les doubles déclarations
//  - protège userLocation
// ═══════════════════════════════════════

if (!window.__ARIA_NAV_LOADED__) {
  window.__ARIA_NAV_LOADED__ = true;

  // États globaux (utilisés ailleurs)
  window.navActive = false;
  window.isFollowing = false;

  (function () {
    var gpsWatchId = null;
    var weatherInterval = null;
    var stationsInitialLoadDone = false;

    async function loadEnv() {
      try {
        const res = await fetch('/api/env');
        const env = await res.json();
        window.__ENV = env;

        if (env.MAPBOX_TOKEN)       ARIA_CONFIG.MAPBOX_TOKEN       = env.MAPBOX_TOKEN;
        if (env.OPENWEATHER_KEY)    ARIA_CONFIG.OPENWEATHER_KEY    = env.OPENWEATHER_KEY;
        if (env.SUPABASE_URL)       ARIA_CONFIG.SUPABASE_URL       = env.SUPABASE_URL;
        if (env.SUPABASE_ANON_KEY)  ARIA_CONFIG.SUPABASE_ANON_KEY  = env.SUPABASE_ANON_KEY;
        if (env.N8N_WEBHOOK_URL)    ARIA_CONFIG.N8N_WEBHOOK_URL    = env.N8N_WEBHOOK_URL;
        if (env.N8N_REPORT_WEBHOOK) ARIA_CONFIG.N8N_REPORT_WEBHOOK = env.N8N_REPORT_WEBHOOK;
        if (env.ELEVENLABS_KEY)     ARIA_CONFIG.ELEVENLABS_KEY     = env.ELEVENLABS_KEY;

        console.log('✅ Variables chargées depuis Vercel');
      } catch (err) {
        console.warn('⚠ /api/env non disponible — utilisation config locale', err);
      }
    }

    window.addEventListener('load', async () => {
      await loadEnv();
      startApp();
    });

    async function startApp() {
      updateClock();
      setInterval(updateClock, 30000);

      if (
        ARIA_CONFIG.MAPBOX_TOKEN &&
        !ARIA_CONFIG.MAPBOX_TOKEN.includes('VOTRE') &&
        ARIA_CONFIG.MAPBOX_TOKEN !== ''
      ) {
        if (typeof initMap === 'function') initMap();
      } else {
        showDemoMode();
        return;
      }

      if (typeof initARIA === 'function') initARIA();

      setTimeout(() => {
        document.getElementById('splash')?.classList.add('hidden');

        setTimeout(() => {
          if (typeof initSearch === 'function') initSearch();
          if (typeof speakARIA === 'function') {
            speakARIA('Bonjour ! ARIA GPS est prêt. Où souhaitez-vous aller ?');
          }
        }, 300);
      }, 2000);

      if (typeof initSupabase === 'function') initSupabase();

      startGeolocationTracking();
    }

    // ──────────────────────────────────────
    // GÉOLOCALISATION
    // ──────────────────────────────────────
    function ensureUserLocationObject() {
      if (!window.userLocation || typeof window.userLocation !== 'object') {
        window.userLocation = {};
      }
      return window.userLocation;
    }

    function startGeolocationTracking() {
      if (!navigator.geolocation) {
        console.warn('⚠ Géolocalisation non disponible');
        useDefaultLocationFallback();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => handleLocationUpdate(pos, true),
        (err) => {
          console.warn('⚠ getCurrentPosition error:', err);
          useDefaultLocationFallback();
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );

      gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => handleLocationUpdate(pos, false),
        (err) => console.warn('⚠ watchPosition error:', err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    }

    function handleLocationUpdate(pos, isInitial) {
      const lat = pos?.coords?.latitude;
      const lng = pos?.coords?.longitude;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('⚠ Coordonnées GPS invalides');
        return;
      }

      const heading = Number.isFinite(pos?.coords?.heading) ? pos.coords.heading : null;
      const speed = Number.isFinite(pos?.coords?.speed) ? pos.coords.speed : 0;
      const accuracy = Number.isFinite(pos?.coords?.accuracy) ? pos.coords.accuracy : null;

      const loc = ensureUserLocationObject();
      loc.lat = lat;
      loc.lng = lng;
      loc.heading = heading;
      loc.speed = speed;
      loc.accuracy = accuracy;
      loc.timestamp = Date.now();

      if (typeof updateUserMarker === 'function') {
        try { updateUserMarker(lat, lng, heading); } catch (e) { console.warn('updateUserMarker error:', e); }
      }

      if (typeof updateNavigationProgress === 'function') {
        try { updateNavigationProgress(lat, lng, heading); } catch (e) { console.warn('updateNavigationProgress error:', e); }
      }

      if (typeof updateSpeedUI === 'function') {
        try { updateSpeedUI(speed); } catch (e) { console.warn('updateSpeedUI error:', e); updateDefaultSpeedUI(speed); }
      } else {
        updateDefaultSpeedUI(speed);
      }

      if (isInitial) {
        fetchWeatherSafe(lat, lng);

        if (weatherInterval) clearInterval(weatherInterval);
        weatherInterval = setInterval(() => {
          const cur = ensureUserLocationObject();
          if (Number.isFinite(cur.lat) && Number.isFinite(cur.lng)) fetchWeatherSafe(cur.lat, cur.lng);
        }, 600000);

        if (!stationsInitialLoadDone && typeof loadStationsNearUser === 'function') {
          stationsInitialLoadDone = true;
          setTimeout(() => {
            const cur = ensureUserLocationObject();
            loadStationsNearUser(cur.lat, cur.lng, 15);
          }, 1500);
        }
      }

      // Suivi carte en navigation
      if (window.navActive && window.isFollowing && window.map && typeof window.map.easeTo === 'function') {
        try {
          window.map.easeTo({
            center: [lng, lat],
            zoom: Math.max(typeof window.map.getZoom === 'function' ? window.map.getZoom() : 16, 16),
            pitch: 58,
            bearing: heading ?? (typeof window.map.getBearing === 'function' ? window.map.getBearing() : 0),
            duration: 350,
            essential: true,
            padding: { top: 130, bottom: 220, left: 20, right: 20 },
          });
        } catch (err) {
          console.warn('map follow error:', err);
        }
      }
    }

    function useDefaultLocationFallback() {
      const center = ARIA_CONFIG.DEFAULT_CENTER || [2.3522, 48.8566];
      const lng = center[0];
      const lat = center[1];

      const loc = ensureUserLocationObject();
      loc.lat = lat;
      loc.lng = lng;
      loc.heading = 0;
      loc.speed = 0;
      loc.accuracy = null;
      loc.timestamp = Date.now();

      fetchWeatherSafe(lat, lng);

      if (weatherInterval) clearInterval(weatherInterval);
      weatherInterval = setInterval(() => fetchWeatherSafe(lat, lng), 600000);

      if (typeof loadStationsNearUser === 'function') {
        setTimeout(() => loadStationsNearUser(lat, lng, 15), 2000);
      }
    }

    function stopGeolocationTracking() {
      if (gpsWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
      }
      if (weatherInterval) {
        clearInterval(weatherInterval);
        weatherInterval = null;
      }
    }

    // ──────────────────────────────────────
    // MÉTÉO / UI
    // ──────────────────────────────────────
    function fetchWeatherSafe(lat, lng) {
      if (typeof fetchWeather !== 'function') return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      try { fetchWeather(lat, lng); } catch (err) { console.warn('weather error:', err); }
    }

    function updateDefaultSpeedUI(speedMps) {
      const kmh = Math.max(0, Math.round((speedMps || 0) * 3.6));
      const speedNum = document.getElementById('speed-num');
      if (speedNum) speedNum.textContent = kmh;
      const speedPill = document.getElementById('speed-pill');
      if (speedPill) speedPill.textContent = `${kmh} km/h`;
    }

    function showDemoMode() {
      document.getElementById('splash')?.classList.add('hidden');
      if (typeof initSearch === 'function') initSearch();
      if (typeof addAlert === 'function') {
        addAlert('info', 'Clés API manquantes — configurez Vercel Environment Variables', 'Config', 'badge-blue');
      }
      setState('idle');
    }

    function updateClock() {
      const el = document.getElementById('clock');
      if (el) {
        el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      }
    }

    function setState(state) {
      ['idle', 'routes', 'nav'].forEach((s) => {
        const el = document.getElementById('state-' + s);
        if (el) el.classList.toggle('hidden', s !== state);
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#top-hud') && !e.target.closest('#search-results')) {
        if (typeof hideSearchResults === 'function') hideSearchResults();
      }
      if (e.target === document.getElementById('report-modal')) {
        if (typeof closeReportModal === 'function') closeReportModal();
      }
    });

    window.addEventListener('beforeunload', () => {
      stopGeolocationTracking();
    });

    // Exposition minimale
    window.setState = setState;
    window.updateClock = updateClock;
    window.startApp = startApp;
  })();
}
// --- SHIM: startSearch() pour le bouton + ARIA ---
if (typeof window.startSearch !== 'function') {
  window.startSearch = async function startSearch() {
    const q = document.getElementById('search-input')?.value?.trim();
    if (!q) {
      if (typeof window.showToast === 'function') window.showToast('Entrez une destination');
      return;
    }

    // Priorité : la fonction que tu utilises déjà dans aria.js
    if (typeof window.searchPlaces === 'function') {
      return await window.searchPlaces(q);
    }

    console.warn('startSearch: searchPlaces() introuvable');
    if (typeof window.showToast === 'function') window.showToast('Recherche indisponible');
  };
}