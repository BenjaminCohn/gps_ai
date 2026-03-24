// ═══════════════════════════════════════
//  ARIA GPS — Navigation Controller (SAFE + UI MODE)
//  - GPS tracking (unique)
//  - Follow camera in nav
//  - HUD mode (dest-card vs nav-header)
//  - Fix overlap: fuel button vs search loupe
//  - Wrap start/stop/cancel navigation to force UI updates
// ═══════════════════════════════════════

if (!window.__ARIA_NAV_LOADED__) {
  window.__ARIA_NAV_LOADED__ = true;

  // Etats globaux
  window.navActive = window.navActive ?? false;
  window.isFollowing = window.isFollowing ?? false;

  (function () {
    let gpsWatchId = null;
    let weatherInterval = null;
    let stationsInitialLoadDone = false;

    // ──────────────────────────────────────
    // HUD MODE (IMPORTANT)
    // ──────────────────────────────────────
    function setHudMode(isNav) {
      const destCard = document.getElementById('dest-card');
      const navHeader = document.getElementById('nav-header');
      const searchResults = document.getElementById('search-results');

      if (destCard) destCard.classList.toggle('hidden', !!isNav);
      if (navHeader) navHeader.classList.toggle('hidden', !isNav);

      // Ferme la dropdown de résultats quand on passe en nav
      if (isNav && searchResults) {
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
      }
      if (isNav && typeof window.hideSearchResults === 'function') {
        try { window.hideSearchResults(); } catch {}
      }

      // ✅ Fix overlap : bouton essence vs loupe
      const fuelBtn = document.getElementById('stations-toggle');
      if (fuelBtn) {
        if (isNav) {
          // visible en navigation, mais placé en-dessous du header
          fuelBtn.classList.remove('hidden');
          fuelBtn.style.top = '170px';
          fuelBtn.style.right = '14px';
          fuelBtn.style.left = 'auto';
          fuelBtn.style.bottom = 'auto';
        } else {
          // en mode recherche, on le cache (sinon il empiete sur la loupe)
          fuelBtn.classList.add('hidden');
        }
      }
    }

    // helper : état UI des sections du bottom sheet
    function setState(state) {
      ['idle', 'routes', 'nav'].forEach((s) => {
        const el = document.getElementById('state-' + s);
        if (el) el.classList.toggle('hidden', s !== state);
      });
    }

    window.setState = window.setState || setState;

    // ──────────────────────────────────────
    // ENV (Vercel)
    // ──────────────────────────────────────
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

      // Mode par défaut : recherche (nav off)
      setHudMode(false);
      setState('idle');

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
      if (typeof initSupabase === 'function') initSupabase();

      setTimeout(() => {
        document.getElementById('splash')?.classList.add('hidden');

        setTimeout(() => {
          if (typeof initSearch === 'function') initSearch();
          if (typeof speakARIA === 'function') speakARIA('Bonjour ! ARIA GPS est prêt. Où souhaitez-vous aller ?');
        }, 300);
      }, 1600);

      startGeolocationTracking();

      // ✅ Wrap start/stop/cancel pour forcer le bon UI mode
      wrapNavigationFunctions();
    }

    // ──────────────────────────────────────
    // GPS TRACKING (UNIQUE)
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

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

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

      // UI GPS pill
      const gpsPill = document.getElementById('gps-pill');
      if (gpsPill) {
        gpsPill.textContent = 'GPS ✓';
        gpsPill.style.color = '#00e676';
      }

      // Marker + speed
      if (typeof window.updateUserMarker === 'function') {
        try { window.updateUserMarker(lat, lng, heading); } catch {}
      }

      if (typeof window.updateSpeedUI === 'function') {
        try { window.updateSpeedUI(speed); } catch { updateDefaultSpeedUI(speed); }
      } else {
        updateDefaultSpeedUI(speed);
      }

      // Progress nav (si tu l’as)
      if (typeof window.updateNavigationProgress === 'function') {
        try { window.updateNavigationProgress(lat, lng, heading); } catch {}
      }

      // Stations alert
      if (typeof window.checkUpcomingStations === 'function') {
        try { window.checkUpcomingStations(lat, lng, heading); } catch {}
      }

      // initial fetch weather + stations
      if (isInitial) {
        fetchWeatherSafe(lat, lng);

        if (weatherInterval) clearInterval(weatherInterval);
        weatherInterval = setInterval(() => {
          const cur = ensureUserLocationObject();
          if (Number.isFinite(cur.lat) && Number.isFinite(cur.lng)) fetchWeatherSafe(cur.lat, cur.lng);
        }, 600000);

        if (!stationsInitialLoadDone && typeof window.loadStationsNearUser === 'function') {
          stationsInitialLoadDone = true;
          setTimeout(() => {
            const cur = ensureUserLocationObject();
            window.loadStationsNearUser(cur.lat, cur.lng, 15);
          }, 1500);
        }
      }

      // Follow cam (en navigation + follow)
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

      if (typeof window.loadStationsNearUser === 'function') {
        setTimeout(() => window.loadStationsNearUser(lat, lng, 15), 2000);
      }
    }

    function fetchWeatherSafe(lat, lng) {
      if (typeof window.fetchWeather !== 'function') return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      try { window.fetchWeather(lat, lng); } catch {}
    }

    function updateDefaultSpeedUI(speedMps) {
      const kmh = Math.max(0, Math.round((speedMps || 0) * 3.6));
      const speedNum = document.getElementById('speed-num');
      if (speedNum) speedNum.textContent = kmh;
      const speedPill = document.getElementById('speed-pill');
      if (speedPill) speedPill.textContent = `${kmh} km/h`;
    }

    // ──────────────────────────────────────
    // UI: Clock / Demo
    // ──────────────────────────────────────
    function updateClock() {
      const el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function showDemoMode() {
      document.getElementById('splash')?.classList.add('hidden');
      if (typeof window.initSearch === 'function') window.initSearch();
      if (typeof window.addAlert === 'function') {
        window.addAlert('info', 'Clés API manquantes — configurez Vercel Environment Variables', 'Config', 'badge-blue');
      }
      setHudMode(false);
      setState('idle');
    }

    // ──────────────────────────────────────
    // WRAP NAV FUNCTIONS (force UI mode)
    // ──────────────────────────────────────
    function wrapNavigationFunctions() {
      if (window.__ARIA_NAV_WRAPPED__) return;
      window.__ARIA_NAV_WRAPPED__ = true;

      // start
      const originalStart = window.startNavigation;
      window.startNavigation = async function (...args) {
        // Force UI nav mode
        setHudMode(true);
        setState('nav');
        window.navActive = true;
        window.isFollowing = true;

        // call original if exists
        if (typeof originalStart === 'function') {
          return await originalStart.apply(this, args);
        }
      };

      // stop
      const originalStop = window.stopNavigation;
      window.stopNavigation = function (...args) {
        window.navActive = false;
        setHudMode(false);
        setState('idle');

        if (typeof originalStop === 'function') return originalStop.apply(this, args);
      };

      // cancel
      const originalCancel = window.cancelRoute;
      window.cancelRoute = function (...args) {
        window.navActive = false;
        setHudMode(false);
        setState('idle');

        if (typeof originalCancel === 'function') return originalCancel.apply(this, args);
      };
    }

    // ──────────────────────────────────────
    // GLOBAL CLICK HANDLERS
    // ──────────────────────────────────────
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#top-hud') && !e.target.closest('#search-results')) {
        if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
      }
      if (e.target === document.getElementById('report-modal')) {
        if (typeof window.closeReportModal === 'function') window.closeReportModal();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (gpsWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
      }
      if (weatherInterval) clearInterval(weatherInterval);
    });

    // expose helpers
    window.setHudMode = setHudMode;
    window.startApp = startApp;
    window.updateClock = updateClock;
  })();
}