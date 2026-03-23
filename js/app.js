// ═══════════════════════════════════════
//  ARIA GPS — Contrôleur Principal
// ═══════════════════════════════════════

let gpsWatchId = null;
let weatherInterval = null;
let stationsInitialLoadDone = false;

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
  } catch {
    console.warn('⚠ /api/env non disponible — utilisation config locale');
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
    initMap();
  } else {
    showDemoMode();
    return;
  }

  initARIA();

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

function startGeolocationTracking() {
  if (!navigator.geolocation) {
    console.warn('⚠ Géolocalisation non disponible');
    useDefaultLocationFallback();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      handleLocationUpdate(pos, true);
    },
    (err) => {
      console.warn('⚠ getCurrentPosition error:', err);
      useDefaultLocationFallback();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    }
  );

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      handleLocationUpdate(pos, false);
    },
    (err) => {
      console.warn('⚠ watchPosition error:', err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );
}

function handleLocationUpdate(pos, isInitial = false) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const heading = Number.isFinite(pos.coords.heading) ? pos.coords.heading : null;
  const speed = Number.isFinite(pos.coords.speed) ? pos.coords.speed : 0;
  const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;

  if (!window.userLocation) {
    window.userLocation = {};
  }

  userLocation.lat = lat;
  userLocation.lng = lng;
  userLocation.heading = heading;
  userLocation.speed = speed;
  userLocation.accuracy = accuracy;
  userLocation.timestamp = Date.now();

  if (typeof updateUserMarker === 'function') {
    updateUserMarker(lat, lng, heading);
  }

  if (typeof updateNavigationProgress === 'function') {
    updateNavigationProgress(lat, lng, heading);
  }

  if (typeof updateSpeedUI === 'function') {
    updateSpeedUI(speed);
  } else {
    updateDefaultSpeedUI(speed);
  }

  if (isInitial) {
    fetchWeatherSafe(lat, lng);

    if (weatherInterval) clearInterval(weatherInterval);
    weatherInterval = setInterval(() => {
      fetchWeatherSafe(userLocation.lat, userLocation.lng);
    }, 600000);

    if (!stationsInitialLoadDone && typeof loadStationsNearUser === 'function') {
      stationsInitialLoadDone = true;
      setTimeout(() => loadStationsNearUser(lat, lng, 15), 1500);
    }
  }

  if (navActive && window.isFollowing && map && typeof map.easeTo === 'function') {
    try {
      map.easeTo({
        center: [lng, lat],
        bearing: heading ?? map.getBearing?.() ?? 0,
        duration: 500,
        essential: true,
      });
    } catch (err) {
      console.warn('map follow error:', err);
    }
  }
}

function fetchWeatherSafe(lat, lng) {
  if (typeof fetchWeather !== 'function') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    fetchWeather(lat, lng);
  } catch (err) {
    console.warn('weather error:', err);
  }
}

function updateDefaultSpeedUI(speedMps) {
  const kmh = Math.max(0, Math.round((speedMps || 0) * 3.6));
  const speedEl =
    document.getElementById('speed-value') ||
    document.getElementById('speed') ||
    document.getElementById('speed-kmh');

  if (speedEl) {
    speedEl.textContent = `${kmh}`;
  }
}

function useDefaultLocationFallback() {
  const [lng, lat] = ARIA_CONFIG.DEFAULT_CENTER;

  if (!window.userLocation) {
    window.userLocation = {};
  }

  userLocation.lat = lat;
  userLocation.lng = lng;
  userLocation.heading = 0;
  userLocation.speed = 0;
  userLocation.accuracy = null;
  userLocation.timestamp = Date.now();

  fetchWeatherSafe(lat, lng);

  if (weatherInterval) clearInterval(weatherInterval);
  weatherInterval = setInterval(() => {
    fetchWeatherSafe(lat, lng);
  }, 600000);

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

function showDemoMode() {
  const splash = document.getElementById('splash');
  if (splash) splash.classList.add('hidden');

  if (typeof initSearch === 'function') initSearch();
  if (typeof addAlert === 'function') {
    addAlert(
      'info',
      'Clés API manquantes — configurez Vercel Environment Variables',
      'Config',
      'badge-blue'
    );
  }
  setState('idle');
}

function updateClock() {
  const el = document.getElementById('clock');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
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