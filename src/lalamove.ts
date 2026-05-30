import crypto from "crypto";
import { requireEnv } from "./env";
import { Order, QuoteResult } from "./types";
import { geocode } from "./geocode";

/**
 * Cliente de Lalamove API v3 (courier same-day: moto/auto/van).
 *
 * Reemplaza a Envia.com. Diferencias clave frente a una paquetería:
 *  - Autenticación por firma HMAC-SHA256 en CADA request (no Bearer fijo).
 *  - Cotiza con COORDENADAS (lat/lng), no con código postal → geocodificamos.
 *  - El pedido se crea con el quotationId + los stopId que devuelve la cotización.
 *
 * Doc: https://developers.lalamove.com/  (REST v3)
 */

const BASE = process.env.LALAMOVE_BASE_URL || "https://rest.lalamove.com";
// Header "Market": código de país ISO. México = "MX".
const MARKET = process.env.LALAMOVE_MARKET || "MX";
// Tipo de servicio por defecto. Se confirma con scripts/lalamove-cities.ts.
const SERVICE_TYPE = process.env.LALAMOVE_SERVICE_TYPE || "MOTORCYCLE";
// Idioma de la cotización para México.
const LANGUAGE = process.env.LALAMOVE_LANGUAGE || "es_MX";

interface LalaResponse {
  ok: boolean;
  status: number;
  error: string | null;
  data: Record<string, unknown> | null;
}

/**
 * Construye la cadena a firmar y devuelve los headers HMAC.
 * SIGNATURE = HmacSHA256( `${ts}\r\n${METHOD}\r\n${path}\r\n\r\n${body}` , SECRET )
 * Para GET, body = "" (la sección de body queda vacía pero los \r\n se mantienen).
 */
function authHeaders(method: string, path: string, body: string): Record<string, string> {
  const apiKey = requireEnv("LALAMOVE_API_KEY");
  const secret = requireEnv("LALAMOVE_API_SECRET");
  const ts = Date.now().toString();
  const raw = `${ts}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return {
    Authorization: `hmac ${apiKey}:${ts}:${signature}`,
    Market: MARKET,
    "Request-ID": crypto.randomUUID(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function lalaRequest(
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
): Promise<LalaResponse> {
  // El body firmado y el body enviado DEBEN ser byte-idénticos.
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = authHeaders(method, path, body);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : body,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: `No se pudo conectar con Lalamove: ${msg}`, data: null };
  }

  const txt = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = txt ? (JSON.parse(txt) as Record<string, unknown>) : null;
  } catch {
    json = { raw: txt };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: res.status,
      error: `Credenciales rechazadas (${res.status}). Revisa LALAMOVE_API_KEY / LALAMOVE_API_SECRET / LALAMOVE_MARKET.`,
      data: json,
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: extractError(json) || `Error HTTP ${res.status}`, data: json };
  }
  return { ok: true, status: res.status, error: null, data: json };
}

function extractError(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  // Lalamove devuelve { errors: [{ id, message, detail }] } o { message }.
  const errs = json.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs
      .map((e) => {
        if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          return String(o.detail || o.message || o.id || JSON.stringify(o));
        }
        return String(e);
      })
      .join("; ");
  }
  if (typeof json.message === "string") return json.message;
  return null;
}

/** Normaliza un teléfono mexicano de 10 dígitos a formato E.164 (+52...). */
function toE164MX(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("52")) return `+${digits}`;
  return `+52${digits}`;
}

interface Stop {
  coordinates: { lat: string; lng: string };
  address: string;
}

/** Geocodifica origen y destino y arma los stops [recogida, entrega]. */
async function buildStops(order: Order): Promise<{ ok: true; stops: Stop[] } | { ok: false; error: string }> {
  const pickup = await geocode(order.pickupAddress || "");
  if (!pickup.ok) return { ok: false, error: `No ubiqué la dirección de recogida: ${pickup.error}` };
  const dropoff = await geocode(order.dropoffAddress || "");
  if (!dropoff.ok) return { ok: false, error: `No ubiqué la dirección de entrega: ${dropoff.error}` };

  return {
    ok: true,
    stops: [
      { coordinates: { lat: String(pickup.lat), lng: String(pickup.lng) }, address: pickup.display },
      { coordinates: { lat: String(dropoff.lat), lng: String(dropoff.lng) }, address: dropoff.display },
    ],
  };
}

// ── Cotización ────────────────────────────────────────────────────────────

export type RateOutcome =
  | { ok: true; quote: QuoteResult; quotationId: string; stops: { stopId: string }[] }
  | { ok: false; error: string; coverage: boolean };

/**
 * Cotiza con POST /v3/quotations. Devuelve precio + quotationId + stopIds,
 * que son necesarios para crear la orden después.
 */
export async function getRate(order: Order): Promise<RateOutcome> {
  const built = await buildStops(order);
  if (!built.ok) return { ok: false, error: built.error, coverage: false };

  const payload = {
    data: {
      serviceType: SERVICE_TYPE,
      language: LANGUAGE,
      stops: built.stops,
      item: {
        quantity: "1",
        weight: process.env.LALAMOVE_WEIGHT || "LESS_THAN_3KG",
        categories: ["FOOD_DELIVERY"],
        handlingInstructions: [],
      },
    },
  };

  const r = await lalaRequest("POST", "/v3/quotations", payload);
  if (!r.ok) {
    const msg = r.error || "Error al cotizar";
    const coverage = /coverage|cobertura|out of|no service|service area|distance/i.test(msg);
    return { ok: false, error: msg, coverage };
  }

  const data = (r.data?.data as Record<string, unknown>) || {};
  const quotationId = String(data.quotationId ?? "");
  const stopsRaw = Array.isArray(data.stops) ? (data.stops as Record<string, unknown>[]) : [];
  const stops = stopsRaw.map((s) => ({ stopId: String(s.stopId ?? "") }));
  const pb = (data.priceBreakdown as Record<string, unknown>) || {};

  if (!quotationId || stops.length < 2) {
    return { ok: false, error: "Lalamove no devolvió una cotización utilizable (sin quotationId/stops).", coverage: false };
  }

  const quote: QuoteResult = {
    carrier: "Lalamove",
    service: SERVICE_TYPE,
    serviceDescription: `Lalamove ${SERVICE_TYPE}`,
    price: Number(pb.total ?? pb.totalBeforeOptimization ?? 0),
    currency: String(pb.currency ?? "MXN"),
    raw: data,
  };
  return { ok: true, quote, quotationId, stops };
}

// ── Crear orden real ─────────────────────────────────────────────────────

export type GenerateOutcome =
  | { ok: true; trackingNumber: string; label: string | null; shareLink: string | null; raw: unknown }
  | { ok: false; error: string };

/**
 * Crea la orden real con POST /v3/orders usando el quotationId y los stopIds
 * de la cotización. stops[0] = remitente (recogida), stops[1] = destinatario.
 */
export async function generateShipment(
  order: Order,
  quote: QuoteResult,
  quotationId: string,
  stops: { stopId: string }[],
): Promise<GenerateOutcome> {
  const senderPhone = toE164MX(order.pickupContactPhone || process.env.LALAMOVE_SENDER_PHONE || "");
  const recipientPhone = toE164MX(order.dropoffContactPhone || "");

  const payload = {
    data: {
      quotationId,
      sender: {
        stopId: stops[0].stopId,
        name: order.pickupContactName || order.pickupName || "Remitente",
        phone: senderPhone,
      },
      recipients: [
        {
          stopId: stops[1].stopId,
          name: order.dropoffContactName || order.recipientName || "Destinatario",
          phone: recipientPhone,
          remarks: order.items || "",
        },
      ],
      isPODEnabled: true,
      metadata: { items: order.items || "", cod: order.codAmount ? String(order.codAmount) : "" },
    },
  };

  const r = await lalaRequest("POST", "/v3/orders", payload);
  if (!r.ok) return { ok: false, error: r.error || "Error al crear la orden" };

  const data = (r.data?.data as Record<string, unknown>) || {};
  const trackingNumber = String(data.orderId ?? "");
  if (!trackingNumber) return { ok: false, error: "Lalamove no devolvió orderId." };

  return {
    ok: true,
    trackingNumber,
    label: null,
    shareLink: (data.shareLink as string) ?? null,
    raw: data,
  };
}

// ── Rastreo ────────────────────────────────────────────────────────────────

export type TrackOutcome = { ok: true; status: string; raw: unknown } | { ok: false; error: string };

/** Consulta el estado con GET /v3/orders/{orderId}. */
export async function trackShipment(orderId: string): Promise<TrackOutcome> {
  const r = await lalaRequest("GET", `/v3/orders/${encodeURIComponent(orderId)}`);
  if (!r.ok) return { ok: false, error: r.error || "Error al rastrear" };
  const data = (r.data?.data as Record<string, unknown>) || {};
  const status = String(data.status ?? "sin estado");
  return { ok: true, status, raw: data };
}
