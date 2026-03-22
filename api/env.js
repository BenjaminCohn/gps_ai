export default function handler(req, res) {
  res.json({
    MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN,
    OPENWEATHER_KEY: process.env.VITE_OPENWEATHER_KEY,
    SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    N8N_WEBHOOK_URL: process.env.VITE_N8N_WEBHOOK_URL,
    N8N_REPORT_WEBHOOK: process.env.VITE_N8N_REPORT_WEBHOOK,
  });
}