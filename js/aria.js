// ═══════════════════════════════════════
//  ARIA GPS — IA Vocale Premium
// ═══════════════════════════════════════

let recognition    = null;
let synthesis      = window.speechSynthesis;
let micActive      = false;
let ariaVoice      = null;
let isARIASpeaking = false;
let conversationHistory = [];
let routeContext = {
  destination: null, eta: null, distanceLeft: null,
  currentSpeed: null, weather: null, alerts: [], fuelCost: null,
};

// ── INITIALISATION ────────────────────────────

function initARIA() {
  initVoiceSynthesis();
  initSpeechRecognition();
  conversationHistory = [
    { role: 'user', content: buildSystemContext() },
    { role: 'assistant', content: 'Bonjour ! Je suis ARIA, votre assistante de navigation. Ou souhaitez-vous aller ?' },
  ];
}

function buildSystemContext() {
  return `Tu es ARIA, une assistante GPS française chaleureuse et très compétente intégrée dans ARIA GPS.
Tu parles en français naturel, tu es positive et rassurante, concise à l'oral (max 2 phrases).
Tu préviens les dangers à l'avance. Tu demandes comment va le conducteur toutes les 2 heures.
Tu comprends toute demande liée à : navigation, météo, signalement, stations essence, pauses, heure arrivée.
Réponds TOUJOURS en JSON avec ce format exact sans aucun texte avant ou après :
{"message":"réponse courte pour la voix","action":"navigate|stop_nav|report|find_station|none","action_data":"destination si action=navigate sinon null","display_msg":"message affiché dans la bulle plus détaillé"}`;
}

function buildSystemPromptWithContext() {
  let ctx = buildSystemContext();
  ctx += '\n\nCONTEXTE ROUTE EN COURS:\n';
  ctx += routeContext.destination  ? 'Destination: ' + routeContext.destination + '\n' : 'Pas de navigation active.\n';
  ctx += routeContext.eta          ? 'ETA: ' + routeContext.eta + '\n' : '';
  ctx += routeContext.distanceLeft ? 'Distance restante: ' + routeContext.distanceLeft + '\n' : '';
  ctx += routeContext.currentSpeed ? 'Vitesse: ' + routeContext.currentSpeed + ' km/h\n' : '';
  ctx += routeContext.weather      ? 'Meteo: ' + routeContext.weather + '\n' : '';
  ctx += routeContext.fuelCost     ? 'Cout essence: ' + routeContext.fuelCost + '\n' : '';
  if (routeContext.alerts.length)  ctx += 'Alertes: ' + routeContext.alerts.join(', ') + '\n';
  return ctx;
}

// ── SYNTHESE VOCALE ───────────────────────────

function initVoiceSynthesis() {
  const load = () => {
    const voices = synthesis.getVoices();
    ariaVoice = voices.find(v => v.lang === 'fr-FR' && v.name.includes('Google'))
      || voices.find(v => v.lang === 'fr-FR')
      || voices.find(v => v.lang.startsWith('fr'))
      || voices[0];
  };
  load();
  if (synthesis.onvoiceschanged !== undefined) synthesis.onvoiceschanged = load;
}

async function speakARIA(text) {
  const clean = text.replace(/[\u{1F000}-\u{1FFFF}]|[\u2600-\u27BF]/gu, '').trim();
  const elKey = ARIA_CONFIG.ELEVENLABS_KEY || '';
  if (elKey && !elKey.includes('VOTRE') && elKey.length > 10) {
    const ok = await speakElevenLabs(clean);
    if (ok) return;
  }
  speakWebSpeech(clean);
}

async function speakElevenLabs(text) {
  try {
    isARIASpeaking = true;
    const voiceId = ARIA_CONFIG.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
    const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': ARIA_CONFIG.ELEVENLABS_KEY },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw new Error('ElevenLabs ' + res.status);
    const blob  = await res.blob();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { isARIASpeaking = false; URL.revokeObjectURL(url); };
    await audio.play();
    return true;
  } catch { isARIASpeaking = false; return false; }
}

function speakWebSpeech(text) {
  if (!synthesis) return;
  synthesis.cancel();
  isARIASpeaking = true;
  const utt    = new SpeechSynthesisUtterance(text);
  utt.voice    = ariaVoice;
  utt.lang     = 'fr-FR';
  utt.rate     = 0.92;
  utt.pitch    = 1.05;
  utt.volume   = 1.0;
  utt.onend    = () => { isARIASpeaking = false; };
  synthesis.speak(utt);
}

// ── RECONNAISSANCE VOCALE ─────────────────────

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.lang            = 'fr-FR';
  recognition.continuous      = false;
  recognition.interimResults  = true;

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final   += e.results[i][0].transcript;
      else                       interim += e.results[i][0].transcript;
    }
    if (interim) { setAriaMsg('idle', '🎙 "' + interim + '…"'); setAriaMsg('nav', '🎙 "' + interim + '…"'); }
    if (final)   { handleVoiceCommand(final.trim()); stopMic(); }
  };
  recognition.onerror = (e) => { stopMic(); if (e.error !== 'no-speech') showToast('Micro : ' + e.error); };
  recognition.onend   = () => stopMic();
}

function toggleMic() {
  if (!recognition)  { showToast('Micro non supporté sur ce navigateur'); return; }
  if (isARIASpeaking){ synthesis.cancel(); isARIASpeaking = false; }
  micActive ? stopMic() : startMic();
}

function startMic() {
  micActive = true;
  document.querySelectorAll('.mic-btn').forEach(b => b.classList.add('active'));
  setAriaMsg('idle', '🎙 Je vous écoute…');
  setAriaMsg('nav',  '🎙 Je vous écoute…');
  try { recognition.start(); } catch {}
}

function stopMic() {
  micActive = false;
  document.querySelectorAll('.mic-btn').forEach(b => b.classList.remove('active'));
  try { recognition.stop(); } catch {}
}

// ── CERVEAU CLAUDE ────────────────────────────

async function handleVoiceCommand(userText) {
  updateRouteContext();
  conversationHistory.push({ role: 'user', content: userText });
  setAriaMsg('idle', '✦ ARIA réfléchit…');
  setAriaMsg('nav',  '✦ ARIA réfléchit…');

  try {
    const raw    = await callClaudeAPI();
    const parsed = parseARIAResponse(raw);
    setAriaMsg('idle', parsed.display_msg || parsed.message);
    setAriaMsg('nav',  parsed.display_msg || parsed.message);
    await speakARIA(parsed.message);
    conversationHistory.push({ role: 'assistant', content: parsed.message });
    executeARIAAction(parsed.action, parsed.action_data);
    if (conversationHistory.length > 22)
      conversationHistory = [conversationHistory[0], conversationHistory[1], ...conversationHistory.slice(-18)];
  } catch (err) {
    console.error('ARIA erreur:', err);
    const fb = getFallbackResponse(userText);
    setAriaMsg('idle', fb);
    setAriaMsg('nav',  fb);
    await speakARIA(fb);
  }
}

async function callClaudeAPI() {
  // Priorité 1 : n8n (production sécurisée)
  const n8nUrl = ARIA_CONFIG.N8N_WEBHOOK_URL || '';
  if (n8nUrl && n8nUrl.length > 10 && !n8nUrl.includes('VOTRE')) {
    return await callViaN8N();
  }
  // Priorité 2 : appel direct (test local)
  return await callDirectClaude();
}

async function callDirectClaude() {
  // Supporte ANTHROPIC_API_KEY et ANTHROPIC_KEY
  const key = ARIA_CONFIG.ANTHROPIC_API_KEY || ARIA_CONFIG.ANTHROPIC_KEY || '';
  if (!key || key.length < 10) throw new Error('Clé Anthropic manquante dans config.js');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-calls': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: buildSystemPromptWithContext(),
      messages: conversationHistory.slice(2),
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'Claude API error ' + res.status);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callViaN8N() {
  const res = await fetch(ARIA_CONFIG.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: conversationHistory, context: routeContext }),
  });
  if (!res.ok) throw new Error('N8N error ' + res.status);
  const data = await res.json();
  return data.response || data.message || JSON.stringify(data);
}

function parseARIAResponse(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return { message: raw.substring(0, 200), action: 'none', action_data: null, display_msg: raw };
}

function executeARIAAction(action, data) {
  if (action === 'navigate' && data) {
    const input = document.getElementById('search-input');
    if (input) input.value = data;
    searchPlaces(data).then(() => {
      setTimeout(() => {
        if (window._searchResults?.length > 0) selectDestination(0);
      }, 800);
    }).catch(() => {
      setTimeout(() => {
        if (window._searchResults?.length > 0) selectDestination(0);
      }, 1200);
    });
  } else if (action === 'stop_nav' && typeof navActive !== 'undefined' && navActive) {
    stopNavigation();
  } else if (action === 'report') {
    openReportModal();
  } else if (action === 'find_station' && typeof userLocation !== 'undefined' && userLocation) {
    loadStationsNearUser(userLocation.lat, userLocation.lng, 10);
    showToast('Stations affichées sur la carte');
  }
}

function getFallbackResponse(txt) {
  const l = txt.toLowerCase();
  if (l.includes('aller') || l.includes('navigue') || l.includes('destination'))
    return 'Je recherche votre destination !';
  if (l.includes('météo') || l.includes('meteo') || l.includes('temps'))
    return (document.getElementById('weather-temp')?.textContent || '') + ' ' + (document.getElementById('weather-desc')?.textContent || '');
  if (l.includes('arrivée') || l.includes('arrivee') || l.includes('eta'))
    return 'Arrivée prévue à ' + (document.getElementById('eta-time')?.textContent || '—');
  if (l.includes('station') || l.includes('essence'))
    return 'Je cherche les stations proches.';
  return 'Désolée, je n\'ai pas compris. Dites par exemple : aller à Lyon, ou quelle météo.';
}

// ── CONTEXTE ROUTE ────────────────────────────

function updateRouteContext() {
  routeContext.destination  = document.getElementById('nav-dest-name')?.textContent || null;
  routeContext.eta          = document.getElementById('eta-time')?.textContent || null;
  routeContext.distanceLeft = document.getElementById('nav-remaining-dist')?.textContent || null;
  routeContext.currentSpeed = document.getElementById('speed-num')?.textContent || null;
  const t = document.getElementById('weather-temp')?.textContent;
  const d = document.getElementById('weather-desc')?.textContent;
  routeContext.weather  = t ? t + ' ' + d : null;
  routeContext.fuelCost = document.getElementById('nav-fuel-cost')?.textContent || null;
  routeContext.alerts   = Array.from(document.querySelectorAll('#alerts-strip .alert-text'))
    .map(e => e.textContent).slice(0, 3);
}

// ── MESSAGES PROACTIFS ────────────────────────

function ariaOnNavStart(destination, eta) {
  const msg = 'Navigation démarrée vers ' + destination + '. Arrivée prévue à ' + eta + '. Bonne route !';
  setAriaMsg('nav', '🚗 ' + msg);
  setTimeout(() => speakARIA(msg), 600);
  conversationHistory.push({ role: 'assistant', content: msg });
}

function ariaWellbeingCheck() {
  const msgs = [
    'Vous conduisez depuis 2 heures. Comment vous sentez-vous ? Une pause s\'impose peut-être ?',
    'Cela fait 2 heures que vous conduisez. Je vous recommande une pause pour rester alerte !',
    'Petit rappel bienveillant : une pause toutes les 2 heures est recommandée. Vous allez bien ?',
  ];
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  setAriaMsg('nav', '💙 ' + msg);
  speakARIA(msg);
  conversationHistory.push({ role: 'assistant', content: msg });
}

function ariaAlertIncident(text) {
  setAriaMsg('nav', '⚠ ' + text);
  speakARIA(text);
  conversationHistory.push({ role: 'assistant', content: text });
}

function ariaAlertStation(brandName, distStr, diesel, sp95) {
  const msg = 'Station ' + brandName + ' dans ' + distStr
    + (diesel ? '. Diesel à ' + diesel + ' euros.' : '')
    + (sp95   ? ' Sans plomb à ' + sp95 + ' euros.' : '');
  const display = '⛽ ' + brandName + ' dans ' + distStr
    + (diesel ? ' · Diesel €' + diesel : '')
    + (sp95   ? ' · SP95 €' + sp95 : '');
  setAriaMsg('nav', display);
  speakARIA(msg);
}

// ── UTILITAIRES ───────────────────────────────

function setAriaMsg(state, msg) {
  const el = document.getElementById(state === 'nav' ? 'aria-nav-msg' : 'aria-idle-msg');
  if (el) el.textContent = msg;
}