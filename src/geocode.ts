/**
 * Geocodificación dirección → coordenadas, sin API key.
 *
 * Lalamove cotiza con lat/lng, no con código postal. Usamos Nominatim
 * (OpenStreetMap), que es gratis y no requiere llave. Para producción de alto
 * volumen conviene cambiar a Google Geocoding, pero para el demo basta.
 *
 * Nominatim exige un User-Agent identificable y tiene rate limit (~1 req/s).
 */

const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
// Sesga resultados a México para direcciones ambiguas.
const COUNTRY = process.env.GEOCODE_COUNTRY || "mx";

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; display: string }
  | { ok: false; error: string };

// Coincide con "lat,lng" (con o sin espacios), ej: "19.4358,-99.1834".
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export async function geocode(address: string): Promise<GeocodeResult> {
  const q = address.trim();
  if (!q) return { ok: false, error: "dirección vacía" };

  // Si ya vienen coordenadas, las usamos tal cual (es lo más preciso para
  // Lalamove). Evita que el geocoder "reinterprete" un punto exacto.
  const m = q.match(COORD_RE);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { ok: true, lat, lng, display: q };
    }
    return { ok: false, error: "coordenadas fuera de rango" };
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", COUNTRY);
  url.searchParams.set("addressdetails", "0");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        // Nominatim rechaza requests sin User-Agent identificable.
        "User-Agent": "delivery-agent-cdmx/0.1 (hackathon demo)",
        Accept: "application/json",
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) return { ok: false, error: `geocoder HTTP ${res.status}` };

  let arr: unknown;
  try {
    arr = JSON.parse(await res.text());
  } catch {
    return { ok: false, error: "respuesta no-JSON del geocoder" };
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, error: `sin resultados para "${q}"` };
  }
  const top = arr[0] as Record<string, unknown>;
  const lat = Number(top.lat);
  const lng = Number(top.lon);
  if (!isFinite(lat) || !isFinite(lng)) {
    return { ok: false, error: "el geocoder no devolvió coordenadas válidas" };
  }
  return { ok: true, lat, lng, display: String(top.display_name ?? q) };
}
