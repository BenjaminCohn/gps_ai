// /api/fuel.js
export default async function handler(req, res) {
  // ── CORS (utile si tu testes depuis un autre domaine)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── Params
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    const radius = clampNumber(req.query.radius, 15000, 1000, 60000); // 1km → 60km
    const limit = clampNumber(req.query.limit, 50, 1, 100);          // 1 → 100
    const mode = String(req.query.mode || "array");                  // array | raw | normalized

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: "Missing/invalid lat,lng",
        example: "/api/fuel?lat=48.8566&lng=2.3522&radius=15000&limit=50&mode=array",
      });
    }

    // ── Endpoint Opendatasoft (léger) + géofiltre
    // Dataset : prix-des-carburants-en-france-flux-instantane-v2
    const base =
      "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/" +
      "prix-des-carburants-en-france-flux-instantane-v2/records";

    const url =
      `${base}?limit=${encodeURIComponent(limit)}` +
      `&geofilter.distance=${encodeURIComponent(`${lat},${lng},${radius}`)}`;

    // ── Timeout
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);

    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "accept": "application/json",
        "user-agent": "aria-gps/1.0 (+vercel)",
      },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({
        error: "Upstream error",
        status: upstream.status,
        detail: text?.slice(0, 500) || "No details",
      });
    }

    const data = await upstream.json();

    // ── Cache Vercel (CDN)
    // 5 min frais, puis peut servir du stale le temps de revalider
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    // ── Modes de sortie
    if (mode === "raw") {
      return res.status(200).json(data);
    }

    const results = Array.isArray(data?.results) ? data.results : [];

    if (mode === "normalized") {
      // Normalisation "best effort" (les champs exacts peuvent varier selon le dataset)
      const normalized = results.map((r) => normalizeFuelRecord(r)).filter(Boolean);
      return res.status(200).json({
        count: normalized.length,
        radius,
        limit,
        items: normalized,
      });
    }

    // mode = array (par défaut) : simple tableau, facile à consommer côté front
    return res.status(200).json(results);
  } catch (err) {
    return res.status(502).json({
      error: "Fuel API fetch failed",
      detail: String(err),
    });
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function clampNumber(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Normalisation "best effort".
 * Selon le dataset, les champs peuvent être :
 * - geom / geo_point_2d / coordinates
 * - adresse / cp / ville
 * - prix (array) ou champs séparés
 */
function normalizeFuelRecord(r) {
  if (!r || typeof r !== "object") return null;

  const id =
    r.id ??
    r.station_id ??
    r.identifiant ??
    r.code ??
    null;

  const brand =
    r.enseigne ??
    r.nom ??
    r.brand ??
    r.marque ??
    null;

  const address =
    r.adresse ??
    r.address ??
    null;

  const city =
    r.ville ??
    r.commune ??
    null;

  const postcode =
    r.cp ??
    r.code_postal ??
    null;

  // Coordonnées : plusieurs formats possibles
  let lat = null, lng = null;

  if (Array.isArray(r.geo_point_2d) && r.geo_point_2d.length === 2) {
    lat = Number(r.geo_point_2d[0]);
    lng = Number(r.geo_point_2d[1]);
  } else if (r.geo_point_2d && typeof r.geo_point_2d === "object") {
    // parfois { lat, lon } ou { latitude, longitude }
    lat = Number(r.geo_point_2d.lat ?? r.geo_point_2d.latitude);
    lng = Number(r.geo_point_2d.lon ?? r.geo_point_2d.lng ?? r.geo_point_2d.longitude);
  } else if (r.geom?.coordinates && Array.isArray(r.geom.coordinates)) {
    // GeoJSON: [lng, lat]
    lng = Number(r.geom.coordinates[0]);
    lat = Number(r.geom.coordinates[1]);
  } else if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
    lat = Number(r.latitude);
    lng = Number(r.longitude);
  }

  // Prix : souvent un array d’objets (carburant, valeur, maj, etc.)
  // On garde le brut + un petit mapping simplifié si possible.
  const pricesRaw = r.prix ?? r.prices ?? null;

  const prices = {};
  if (Array.isArray(pricesRaw)) {
    for (const p of pricesRaw) {
      const key = String(p?.nom ?? p?.carburant ?? p?.type ?? "").toLowerCase().trim();
      const val = Number(p?.valeur ?? p?.price ?? p?.prix);
      if (key && Number.isFinite(val)) prices[key] = val;
    }
  }

  return {
    id,
    brand,
    address,
    city,
    postcode,
    location: (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null,
    prices,      // mapping simplifié
    raw: r,      // au cas où ton front a besoin d’un champ particulier
  };
}