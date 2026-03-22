// ═══════════════════════════════════════
//  ARIA GPS — Carte Mapbox 3D
// ═══════════════════════════════════════

let map;
let userMarker;
let userLocation = null;
let watchId = null;
let isFollowing = true;

function initMap() {
  mapboxgl.accessToken = ARIA_CONFIG.MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: 'map',
    style: ARIA_CONFIG.MAP_STYLE,
    center: ARIA_CONFIG.DEFAULT_CENTER,
    zoom: ARIA_CONFIG.DEFAULT_ZOOM,
    pitch: 55,        // Inclinaison 3D
    bearing: 0,
    antialias: true,
  });

  map.on('load', () => {
    // Activer les bâtiments 3D
    const layers = map.getStyle().layers;
    let labelLayerId;
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].type === 'symbol' && layers[i].layout['text-field']) {
        labelLayerId = layers[i].id;
        break;
      }
    }

    // Couche bâtiments 3D
    if (!map.getLayer('3d-buildings')) {
      map.addLayer({
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
      }, labelLayerId);
    }

    startGPS();
  });

  // Détecter si l'utilisateur bouge la carte manuellement
  map.on('dragstart', () => { isFollowing = false; });
}

function startGPS() {
  if (!navigator.geolocation) {
    showToast('GPS non disponible sur cet appareil');
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, heading, speed } = pos.coords;
      userLocation = { lat: latitude, lng: longitude, heading, speed };

      updateUserMarker(latitude, longitude, heading);
      updateSpeedDisplay(speed);

      if (isFollowing) {
        map.easeTo({
          center: [longitude, latitude],
          bearing: heading || 0,
          pitch: 55,
          zoom: 16,
          duration: 1000,
        });
      }

      document.getElementById('gps-pill').textContent = 'GPS ✓';
      document.getElementById('gps-pill').style.color = '#00e676';

      // Vérifier les stations à venir sur la route
      if (typeof checkUpcomingStations === 'function') {
        checkUpcomingStations(latitude, longitude, heading);
      }
    },
    (err) => {
      console.warn('GPS error:', err);
      document.getElementById('gps-pill').textContent = 'GPS —';
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000,
    }
  );
}

function updateUserMarker(lat, lng, heading) {
  if (!userMarker) {
    // Créer marqueur personnalisé
    const el = document.createElement('div');
    el.className = 'user-marker';
    el.innerHTML = `
      <div class="user-dot-outer">
        <div class="user-dot-inner"></div>
        <div class="user-heading-cone" id="heading-cone"></div>
      </div>
    `;

    // Style inline du marqueur
    el.style.cssText = `
      width: 24px; height: 24px; position: relative;
    `;

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
        top: -14px; left: 50%; transform: translateX(-50%);
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

    userMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    userMarker.setLngLat([lng, lat]);
  }

  // Orienter le cône de direction
  if (heading !== null) {
    const cone = document.getElementById('heading-cone');
    if (cone) cone.style.transform = `translateX(-50%) rotate(${heading}deg)`;
  }
}

function updateSpeedDisplay(speedMs) {
  const kmh = speedMs ? Math.round(speedMs * 3.6) : 0;
  const numEl   = document.getElementById('speed-num');
  const panel   = document.getElementById('speed-panel');
  const pillEl  = document.getElementById('speed-pill');

  if (numEl)  numEl.textContent  = kmh;
  if (pillEl) pillEl.textContent = kmh + ' km/h';

  // Panneau rouge si vitesse excessive
  if (panel) {
    panel.classList.toggle('overspeed', kmh > 130);
  }
}

function recenterMap() {
  if (!userLocation) { showToast('Position GPS non disponible'); return; }
  isFollowing = true;
  map.flyTo({
    center: [userLocation.lng, userLocation.lat],
    pitch: 55,
    bearing: userLocation.heading || 0,
    zoom: 16,
    duration: 800,
  });
}

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}
