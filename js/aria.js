// ═══════════════════════════════════════
//  ARIA GPS — Voix & Assistant
// ═══════════════════════════════════════

let ariaRecognition = null;
let ariaListening = false;
let ariaVoices = [];
let ariaPreferredVoice = null;
let ariaLastSpeechAt = 0;
let ariaSpeechQueueLock = false;

// ──────────────────────────────────────
// HELPERS
// ──────────────────────────────────────

function ariaLog(...args) {
  console.log('[ARIA]', ...args);
}

function ariaWarn(...args) {
  console.warn('[ARIA]', ...args);
}

function getNavStateSafe() {
  return !!window.navActive;
}

function getCurrentAriaState() {
  return getNavStateSafe() ? 'nav' : 'idle';
}

function setAriaMsg(state, message) {
  const idleEl = document.getElementById('aria-idle-msg');
  const navEl = document.getElementById('aria-nav-msg');

  if (state === 'idle' && idleEl) idleEl.textContent = message;
  if (state === 'nav' && navEl) navEl.textContent = message;

  if (idleEl && state !== 'idle' && !getNavStateSafe()) {
    idleEl.textContent = message;
  }

  if (navEl && state !== 'nav' && getNavStateSafe()) {
    navEl.textContent = message;
  }
}

function ariaHasSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function ariaHasRecognition() {
  return typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );
}

function normalizeVoiceText(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, list) {
  return list.some(item => text.includes(item));
}

function updateMicUI(isActive) {
  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) return;

  micBtn.classList.toggle('active', !!isActive);
  micBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}

// ──────────────────────────────────────
// VOIX
// ──────────────────────────────────────

function loadAriaVoices() {
  if (!ariaHasSpeechSynthesis()) return;

  ariaVoices = window.speechSynthesis.getVoices() || [];

  const preferred = ariaVoices.find(v =>
    v.lang?.toLowerCase().startsWith('fr') &&
    (
      normalizeVoiceText(v.name).includes('google') ||
      normalizeVoiceText(v.name).includes('audrey') ||
      normalizeVoiceText(v.name).includes('marie') ||
      normalizeVoiceText(v.name).includes('hortense') ||
      normalizeVoiceText(v.name).includes('fr')
    )
  );

  ariaPreferredVoice =
    preferred ||
    ariaVoices.find(v => v.lang?.toLowerCase().startsWith('fr')) ||
    ariaVoices[0] ||
    null;
}

function speakARIA(text, options = {}) {
  if (!text || !ariaHasSpeechSynthesis()) return;

  const now = Date.now();
  if (ariaSpeechQueueLock && now - ariaLastSpeechAt < 350) return;

  ariaLastSpeechAt = now;
  ariaSpeechQueueLock = true;

  try {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = 'fr-FR';
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    if (ariaPreferredVoice) {
      utterance.voice = ariaPreferredVoice;
    }

    utterance.onend = () => {
      ariaSpeechQueueLock = false;
    };

    utterance.onerror = () => {
      ariaSpeechQueueLock = false;
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    ariaSpeechQueueLock = false;
    ariaWarn('speak error:', err);
  }
}

// ──────────────────────────────────────
// INIT
// ──────────────────────────────────────

function initARIA() {
  try {
    loadAriaVoices();

    if (ariaHasSpeechSynthesis()) {
      window.speechSynthesis.onvoiceschanged = () => {
        loadAriaVoices();
      };
    }

    if (ariaHasRecognition()) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      ariaRecognition = new SR();
      ariaRecognition.lang = 'fr-FR';
      ariaRecognition.continuous = false;
      ariaRecognition.interimResults = false;
      ariaRecognition.maxAlternatives = 1;

      ariaRecognition.onstart = () => {
        ariaListening = true;
        updateMicUI(true);
        setAriaMsg(getCurrentAriaState(), 'Je vous écoute…');
      };

      ariaRecognition.onend = () => {
        ariaListening = false;
        updateMicUI(false);
      };

      ariaRecognition.onerror = (event) => {
        ariaListening = false;
        updateMicUI(false);
        ariaWarn('recognition error:', event?.error || event);
      };

      ariaRecognition.onresult = async (event) => {
        const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
        if (!transcript) return;
        await handleVoiceCommand(transcript);
      };
    } else {
      ariaWarn('SpeechRecognition non disponible sur cet appareil');
    }

    setAriaMsg('idle', 'Bonjour ! Prêt pour la route ? Dites-moi où vous allez ou tapez votre destination. 😊');
    setAriaMsg('nav', 'Navigation en cours. Je surveille la route pour vous ! 🚗');
  } catch (err) {
    ariaWarn('initARIA error:', err);
  }
}

function toggleMic() {
  if (!ariaRecognition) {
    if (typeof showToast === 'function') {
      showToast('Commande vocale non disponible sur cet appareil');
    }
    return;
  }

  try {
    if (ariaListening) {
      ariaRecognition.stop();
    } else {
      ariaRecognition.start();
    }
  } catch (err) {
    ariaWarn('toggleMic error:', err);
  }
}

// ──────────────────────────────────────
// PARSING DESTINATION
// ──────────────────────────────────────

function extractDestinationFromSpeech(rawText = '') {
  const raw = String(rawText || '').trim();
  if (!raw) return '';

  const patterns = [
    /^(?:aria[\s,]+)?je veux aller\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?je voudrais aller\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?je voudrai aller\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?je veux aller au\s+(.+)$/i,
    /^(?:aria[\s,]+)?je voudrais aller au\s+(.+)$/i,
    /^(?:aria[\s,]+)?je veux aller a\s+(.+)$/i,
    /^(?:aria[\s,]+)?je voudrais aller a\s+(.+)$/i,
    /^(?:aria[\s,]+)?je vais a\s+(.+)$/i,
    /^(?:aria[\s,]+)?aller\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?va\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?vas\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?navigue\s+(?:vers|a|à|au|aux)\s+(.+)$/i,
    /^(?:aria[\s,]+)?emmene[-\s]?moi\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?emmène[-\s]?moi\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?conduis[-\s]?moi\s+(?:a|à|au|aux|vers)\s+(.+)$/i,
    /^(?:aria[\s,]+)?destination\s+(.+)$/i,
    /^(?:aria[\s,]+)?cherche\s+(.+)$/i,
    /^(?:aria[\s,]+)?itineraire\s+(?:pour|vers)?\s+(.+)$/i,
    /^(?:aria[\s,]+)?itinéraire\s+(?:pour|vers)?\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/[?.!,;:]+$/, '');
    }
  }

  return '';
}

// ──────────────────────────────────────
// ACTIONS
// ──────────────────────────────────────

async function executeARIAAction(action) {
  if (!action || typeof action !== 'object') return false;

  const type = action.type;

  try {
    switch (type) {
      case 'search': {
        const query = action.query?.trim();
        if (!query) return false;

        ariaLog('Recherche destination:', query);
        setAriaMsg(getCurrentAriaState(), `Je cherche ${query}…`);
        speakARIA(`Je cherche ${query}.`);

        const input = document.getElementById('search-input');
        if (input) {
          input.value = query;
        }

        if (typeof window.searchPlaces === 'function') {
          const results = await window.searchPlaces(query);

          if (Array.isArray(results) && results.length === 1 && typeof window.selectDestination === 'function') {
            await window.selectDestination(0);
          }

          return true;
        }

        if (typeof window.startSearch === 'function') {
          await window.startSearch();
          return true;
        }

        if (typeof showToast === 'function') {
          showToast('Recherche indisponible');
        }
        return false;
      }

      case 'quick-destination': {
        const value = action.value?.trim();
        if (!value) return false;

        setAriaMsg(getCurrentAriaState(), `Recherche rapide : ${value}`);
        speakARIA(`D'accord, ${value}.`);

        if (typeof window.quickDest === 'function') {
          window.quickDest(value);
          return true;
        }

        if (typeof window.searchPlaces === 'function') {
          await window.searchPlaces(value);
          return true;
        }

        return false;
      }

      case 'start-navigation': {
        if (typeof window.startNavigation === 'function') {
          await window.startNavigation();
          setAriaMsg('nav', 'Navigation démarrée.');
          speakARIA('Navigation démarrée.');
          return true;
        }

        if (typeof showToast === 'function') {
          showToast('Démarrage navigation indisponible');
        }
        return false;
      }

      case 'stop-navigation': {
        if (typeof window.stopNavigation === 'function') {
          window.stopNavigation();
          setAriaMsg('idle', 'Navigation arrêtée.');
          speakARIA('Navigation arrêtée.');
          return true;
        }

        if (typeof showToast === 'function') {
          showToast('Arrêt navigation indisponible');
        }
        return false;
      }

      case 'cancel-route': {
        if (typeof window.cancelRoute === 'function') {
          window.cancelRoute();
          setAriaMsg('idle', 'Itinéraire annulé.');
          speakARIA('Itinéraire annulé.');
          return true;
        }

        if (typeof showToast === 'function') {
          showToast('Annulation indisponible');
        }
        return false;
      }

      case 'toggle-stations': {
        if (typeof window.toggleStations === 'function') {
          window.toggleStations();
          speakARIA('Affichage des stations modifié.');
          return true;
        }
        return false;
      }

      case 'recenter': {
        if (typeof window.recenterMap === 'function') {
          window.recenterMap();
          speakARIA('Je recentre la carte.');
          return true;
        }
        return false;
      }

      case 'report': {
        if (action.reportType && typeof window.sendReport === 'function') {
          window.sendReport(action.reportType);
          speakARIA('Signalement envoyé.');
          return true;
        }

        if (typeof window.openReportModal === 'function') {
          window.openReportModal();
          speakARIA('J’ouvre les signalements.');
          return true;
        }

        return false;
      }

      default:
        return false;
    }
  } catch (err) {
    ariaWarn('executeARIAAction error:', err);
    return false;
  }
}

// ──────────────────────────────────────
// COMMANDES VOCALES
// ──────────────────────────────────────

async function handleVoiceCommand(transcript) {
  const raw = String(transcript || '').trim();
  const text = normalizeVoiceText(raw);

  ariaLog('Commande vocale:', raw);

  if (!text) return;

  setAriaMsg(getCurrentAriaState(), `J'ai entendu : "${raw}"`);

  if (
    includesAny(text, [
      'arrete la navigation',
      'stop navigation',
      'arreter la navigation',
      'annule la navigation',
      'quitte la navigation'
    ])
  ) {
    await executeARIAAction({ type: 'stop-navigation' });
    return;
  }

  if (
    includesAny(text, [
      'demarre la navigation',
      'lance la navigation',
      'commence la navigation',
      'demarrer la navigation'
    ])
  ) {
    await executeARIAAction({ type: 'start-navigation' });
    return;
  }

  if (
    includesAny(text, [
      'annule litineraire',
      'annule l itineraire',
      'supprime litineraire',
      'supprime l itineraire',
      'annule le trajet'
    ])
  ) {
    await executeARIAAction({ type: 'cancel-route' });
    return;
  }

  if (
    includesAny(text, [
      'masque les stations',
      'affiche les stations',
      'cache les stations',
      'montre les stations'
    ])
  ) {
    await executeARIAAction({ type: 'toggle-stations' });
    return;
  }

  if (
    includesAny(text, [
      'recentre la carte',
      'centre la carte',
      'recentre'
    ])
  ) {
    await executeARIAAction({ type: 'recenter' });
    return;
  }

  if (
    includesAny(text, [
      'maison'
    ])
  ) {
    await executeARIAAction({ type: 'quick-destination', value: 'Maison' });
    return;
  }

  if (
    includesAny(text, [
      'travail',
      'bureau'
    ])
  ) {
    await executeARIAAction({ type: 'quick-destination', value: 'Travail' });
    return;
  }

  if (
    includesAny(text, [
      'station essence',
      'essence',
      'pompe a essence',
      'pompe essence',
      'station service'
    ])
  ) {
    await executeARIAAction({ type: 'quick-destination', value: 'Station essence proche' });
    return;
  }

  if (
    includesAny(text, [
      'restaurant',
      'manger',
      'je veux manger',
      'resto'
    ])
  ) {
    await executeARIAAction({ type: 'quick-destination', value: 'Restaurant proche' });
    return;
  }

  if (includesAny(text, ['signale un accident', 'accident'])) {
    await executeARIAAction({ type: 'report', reportType: 'accident' });
    return;
  }

  if (includesAny(text, ['signale un bouchon', 'bouchon'])) {
    await executeARIAAction({ type: 'report', reportType: 'bouchon' });
    return;
  }

  if (includesAny(text, ['signale un radar', 'radar'])) {
    await executeARIAAction({ type: 'report', reportType: 'radar' });
    return;
  }

  if (includesAny(text, ['signale police', 'controle de police', 'police'])) {
    await executeARIAAction({ type: 'report', reportType: 'police' });
    return;
  }

  const destination = extractDestinationFromSpeech(raw);

  if (destination) {
    ariaLog('Destination détectée:', destination);
    await executeARIAAction({
      type: 'search',
      query: destination
    });
    return;
  }

  if (raw.length >= 3) {
    ariaLog('Fallback recherche brute:', raw);
    await executeARIAAction({
      type: 'search',
      query: raw
    });
    return;
  }

  speakARIA('Je n’ai pas compris la commande.');
}

// ──────────────────────────────────────
// ALERTES / NARRATION
// ──────────────────────────────────────

function ariaOnNavStart(destName, arrivalTime) {
  const msg = `Navigation démarrée vers ${destName}. Arrivée prévue à ${arrivalTime}.`;
  setAriaMsg('nav', msg);
  speakARIA(msg);
}

function ariaAlertStation(brand, distStr, dieselPrice, sp95Price) {
  let msg = `${brand} à ${distStr}.`;
  if (dieselPrice) msg += ` Diesel à ${dieselPrice} euro.`;
  if (sp95Price) msg += ` SP95 à ${sp95Price} euro.`;

  setAriaMsg('nav', msg);
  speakARIA(msg, { rate: 1.02 });
}

function ariaAlertIncident(text) {
  const msg = text || 'Incident signalé sur votre trajet.';
  setAriaMsg('nav', msg);
  speakARIA(msg);
}

function ariaWellbeingCheck() {
  const msg = 'Pensez à faire une pause si vous êtes fatigué.';
  setAriaMsg('nav', msg);
  speakARIA(msg);
}

// ──────────────────────────────────────
// GLOBALS
// ──────────────────────────────────────

window.initARIA = initARIA;
window.toggleMic = toggleMic;
window.speakARIA = speakARIA;
window.setAriaMsg = setAriaMsg;
window.handleVoiceCommand = handleVoiceCommand;
window.executeARIAAction = executeARIAAction;
window.ariaOnNavStart = ariaOnNavStart;
window.ariaAlertStation = ariaAlertStation;
window.ariaAlertIncident = ariaAlertIncident;
window.ariaWellbeingCheck = ariaWellbeingCheck;