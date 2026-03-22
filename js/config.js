// ═══════════════════════════════════════
//  ARIA GPS — Configuration
//  IMPORTANT : Remplacez les clés API ci-dessous
// ═══════════════════════════════════════



const ARIA_CONFIG = {
  MAPBOX_TOKEN: window.__ENV?.MAPBOX_TOKEN || "",
  OPENWEATHER_KEY: window.__ENV?.OPENWEATHER_KEY || "",
  SUPABASE_URL: window.__ENV?.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: window.__ENV?.SUPABASE_ANON_KEY || "",
  N8N_WEBHOOK_URL: window.__ENV?.N8N_WEBHOOK_URL || "",
  N8N_REPORT_WEBHOOK: window.__ENV?.N8N_REPORT_WEBHOOK || "",
  ELEVENLABS_KEY: "",
  ELEVENLABS_VOICE_ID: "pNInz6obpgDQGcFmaJgB",
  VEHICLE: {
    consumption_per_100km: 7.5,
    fuel_price_per_liter: 1.82,
    co2_per_liter: 2.31,
  },
  MAP_STYLE: "mapbox://styles/mapbox/navigation-night-v1",
  DEFAULT_CENTER: [2.3522, 48.8566],
  DEFAULT_ZOOM: 15,
};
window.ARIA_CONFIG = ARIA_CONFIG;