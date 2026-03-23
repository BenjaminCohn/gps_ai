// ═══════════════════════════════════════
//  ARIA GPS — Contrôleur Principal
// ═══════════════════════════════════════

async function loadEnv() {
  try {
    const res = await fetch('/api/env');
    const env = await res.json();
    window.__ENV = env;
    // Injecter toutes les variables dans ARIA_CONFIG
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
  await loadEnv(); // Charger les clés AVANT de démarrer
  startApp();
});

async function startApp() {
  updateClock();
  setInterval(updateClock, 30000);

  if (ARIA_CONFIG.MAPBOX_TOKEN && !ARIA_CONFIG.MAPBOX_TOKEN.includes('VOTRE') && ARIA_CONFIG.MAPBOX_TOKEN !== '') {
    initMap();
  } else {
    showDemoMode();
    return;
  }

  // Initialiser ARIA vocal
  initARIA();

  // Masquer splash + initialiser recherche
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
    setTimeout(() => {
      initSearch();
      speakARIA('Bonjour ! ARIA GPS est prêt. Où souhaitez-vous aller ?');
    }, 300);
  }, 2000);

  // Supabase communauté temps réel
  if (typeof initSupabase === 'function') initSupabase();

  // Service Worker PWA — désactivé temporairement (cause des bugs de popup)
  // if ('serviceWorker' in navigator) {
  //   navigator.serviceWorker.register('sw.js').catch(() => {});
  // }

  // Géolocalisation + météo + stations
  navigator.geolocation?.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      fetchWeather(latitude, longitude);
      setInterval(() => fetchWeather(latitude, longitude), 600000);
      setTimeout(() => loadStationsNearUser(latitude, longitude, 15), 2000);
    },
    () => {
      // Pas de géoloc — utiliser centre par défaut
      const [lng, lat] = ARIA_CONFIG.DEFAULT_CENTER;
      setTimeout(() => loadStationsNearUser(lat, lng, 15), 2000);
    }
  );
}

function showDemoMode() {
  const splash = document.getElementById('splash');
  if (splash) splash.classList.add('hidden');
  initSearch();
  addAlert('info', 'Clés API manquantes — configurez Vercel Environment Variables', 'Config', 'badge-blue');
  setState('idle');
}

function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function setState(state) {
  ['idle', 'routes', 'nav'].forEach(s => {
    const el = document.getElementById('state-' + s);
    if (el) el.classList.toggle('hidden', s !== state);
  });
}

// Fermer résultats si clic ailleurs
document.addEventListener('click', (e) => {
  if (!e.target.closest('#top-hud') && !e.target.closest('#search-results')) {
    if (typeof hideSearchResults === 'function') hideSearchResults();
  }
  if (e.target === document.getElementById('report-modal')) {
    if (typeof closeReportModal === 'function') closeReportModal();
  }
});
