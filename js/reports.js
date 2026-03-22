// ═══════════════════════════════════════
//  ARIA GPS — Phase 3 : Communauté Temps Réel
//  Base de données : Supabase
//  Temps réel     : Supabase Realtime (WebSocket)
// ═══════════════════════════════════════

let supabaseClient = null;
let realtimeChannel = null;
let communityMarkers = {};

const REPORT_LABELS = {
  accident: { emoji: '💥', text: 'Accident signalé',     badge: '⚠ Danger', type: 'warn', color: '#ef4444' },
  police:   { emoji: '👮', text: 'Contrôle de police',   badge: 'Prudence',  type: 'info', color: '#3b82f6' },
  danger:   { emoji: '⚠️', text: 'Danger sur la route',  badge: '⚠',         type: 'warn', color: '#f97316' },
  bouchon:  { emoji: '🚗', text: 'Bouchon signalé',      badge: '+10 min',   type: 'warn', color: '#eab308' },
  radar:    { emoji: '📷', text: 'Radar signalé',        badge: 'Vitesse',   type: 'info', color: '#8b5cf6' },
  travaux:  { emoji: '🚧', text: 'Travaux sur la route', badge: '⚠',         type: 'warn', color: '#f97316' },
};

// ── INITIALISATION SUPABASE ───────────────────

function initSupabase() {
  if (!ARIA_CONFIG.SUPABASE_URL || ARIA_CONFIG.SUPABASE_URL.includes('VOTRE')) {
    console.warn('Supabase non configuré — mode local uniquement');
    return false;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  script.onload = () => {
    supabaseClient = window.supabase.createClient(ARIA_CONFIG.SUPABASE_URL, ARIA_CONFIG.SUPABASE_ANON_KEY);
    console.log('Supabase connecté');
    subscribeToReports();
    loadRecentReports();
  };
  document.head.appendChild(script);
  return true;
}

// ── TEMPS RÉEL ────────────────────────────────

function subscribeToReports() {
  if (!supabaseClient) return;
  realtimeChannel = supabaseClient
    .channel('community-reports')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, (payload) => {
      handleIncomingReport(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') showToast('📡 Connecté à la communauté ARIA');
    });
}

function handleIncomingReport(report) {
  const r = REPORT_LABELS[report.type];
  if (!r) return;
  const dist = userLocation ? haversineKm(userLocation.lat, userLocation.lng, report.lat, report.lng) : null;
  if (dist && dist > 50) return;
  const distStr = dist ? (dist < 1 ? Math.round(dist*1000)+'m' : dist.toFixed(1)+'km') : '';
  addAlert(r.type, r.emoji+' '+r.text+(distStr ? ' · À '+distStr : '')+' · Communauté', r.badge, r.type==='warn'?'badge-red':'badge-blue');
  addCommunityMarker(report);
  if (dist && dist < 10) {
    const msg = 'Attention ! '+r.text+' signalé par un conducteur à '+distStr+' de vous.';
    speakARIA(msg);
    ariaAlertIncident(msg);
  }
}

async function loadRecentReports() {
  if (!supabaseClient) return;
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data, error } = await supabaseClient.from('reports').select('*').gte('created_at', oneHourAgo).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const nearby = data.filter(r => !userLocation || haversineKm(userLocation.lat, userLocation.lng, r.lat, r.lng) < 50);
    nearby.forEach(r => addCommunityMarker(r));
    if (nearby.length > 0) showToast('📡 '+nearby.length+' signalement(s) dans votre zone');
  } catch(err) { console.warn('Erreur chargement:', err); }
}

// ── ENVOI SIGNALEMENT ─────────────────────────

function openReportModal() { document.getElementById('report-modal').classList.remove('hidden'); }
function closeReportModal() { document.getElementById('report-modal').classList.add('hidden'); }

async function sendReport(type) {
  closeReportModal();
  const r = REPORT_LABELS[type];
  if (!r) return;
  addAlert(r.type, r.emoji+' '+r.text, r.badge, r.type==='warn'?'badge-red':'badge-blue');
  showToast('✓ Signalement envoyé à la communauté !');
  speakARIA(r.text+' envoyé. Merci pour la communauté !');
  setAriaMsg('nav', 'Merci ! '+r.text+' transmis aux conducteurs dans votre zone.');
  if (!userLocation) return;
  const report = {
    type, lat: userLocation.lat, lng: userLocation.lng,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now()+3600000).toISOString(),
  };
  addCommunityMarker({ ...report, id: 'local-'+Date.now() });
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('reports').insert([report]).select();
      if (error) throw error;
      if (ARIA_CONFIG.N8N_REPORT_WEBHOOK && !ARIA_CONFIG.N8N_REPORT_WEBHOOK.includes('VOTRE')) {
        fetch(ARIA_CONFIG.N8N_REPORT_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...report, text:r.text, emoji:r.emoji}) });
      }
    } catch(err) { console.warn('Supabase insert error:', err); }
  }
}

// ── MARQUEURS CARTE ───────────────────────────

function addCommunityMarker(report) {
  if (!map || !report.lat || !report.lng) return;
  if (communityMarkers[report.id]) communityMarkers[report.id].remove();
  const r = REPORT_LABELS[report.type] || REPORT_LABELS['danger'];
  const el = document.createElement('div');
  el.style.cssText = 'width:36px;height:36px;background:'+r.color+';border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
  el.textContent = r.emoji;
  const age = Math.round((Date.now()-new Date(report.created_at).getTime())/60000);
  const ageStr = age < 1 ? "A l'instant" : 'Il y a '+age+' min';
  el.addEventListener('click', () => {
    new mapboxgl.Popup({ closeButton:true, anchor:'bottom', offset:25 })
      .setLngLat([report.lng, report.lat])
      .setHTML('<div style="font-family:Syne,sans-serif;background:#0a0f1e;border-radius:12px;padding:12px 14px;min-width:180px"><div style="font-size:22px;text-align:center;margin-bottom:6px">'+r.emoji+'</div><div style="font-size:14px;font-weight:700;color:white;text-align:center">'+r.text+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-align:center;margin-top:4px">'+ageStr+'</div><div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:center;margin-top:2px">Signale par la communaute</div></div>')
      .addTo(map);
  });
  const marker = new mapboxgl.Marker({ element:el, anchor:'center' }).setLngLat([report.lng, report.lat]).addTo(map);
  communityMarkers[report.id] = marker;
  const expiresIn = report.expires_at ? new Date(report.expires_at).getTime()-Date.now() : 3600000;
  if (expiresIn > 0) setTimeout(() => { if(communityMarkers[report.id]){communityMarkers[report.id].remove();delete communityMarkers[report.id];} }, expiresIn);
}

// ── ALERTES UI ────────────────────────────────

function addAlert(type, text, badge, badgeClass) {
  const strip = document.getElementById('alerts-strip');
  const item = document.createElement('div');
  item.className = 'alert-item alert-'+type;
  const dotClass = type==='warn'?'dot-warn':type==='success'?'dot-success':'dot-info';
  item.innerHTML = '<div class="alert-dot '+dotClass+'"></div><div class="alert-text">'+text+'</div>'+(badge?'<div class="alert-badge '+(badgeClass||'badge-blue')+'">'+badge+'</div>':'');
  strip.appendChild(item);
  setTimeout(() => { item.style.transition='opacity 0.4s';item.style.opacity='0';setTimeout(()=>item.remove(),400); }, 12000);
}

function clearAlerts() { document.getElementById('alerts-strip').innerHTML=''; }

function haversineKm(lat1,lng1,lat2,lng2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
