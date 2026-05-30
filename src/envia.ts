import { Order, QuoteResult } from "./types";
import { requireEnv } from "./env";

const BASE = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";

// Datos que el flujo conversacional no pregunta pero que Envia exige.
const PICKUP_PHONE = process.env.ENVIA_PICKUP_PHONE || "5500000000";
const PICKUP_EMAIL = process.env.ENVIA_PICKUP_EMAIL || "pickup@example.com";
const RECIPIENT_EMAIL = process.env.ENVIA_RECIPIENT_EMAIL || "cliente@example.com";

interface EnviaResponse {
  ok: boolean;
  status: number;
  error: string | null;
  data: Record<string, unknown> | null;
}

function buildAddress(kind: "origin" | "destination", order: Order, state: string) {
  if (kind === "origin") {
    return {
      name: order.pickupName,
      company: order.pickupName,
      email: PICKUP_EMAIL,
      phone: PICKUP_PHONE,
      street: order.pickupStreet,
      number: order.pickupNumber,
      district: order.pickupDistrict,
      city: "Ciudad de Mexico",
      state,
      country: "MX",
      postalCode: order.pickupPostalCode,
      reference: "",
    };
  }
  return {
    name: order.recipientName,
    company: "",
    email: RECIPIENT_EMAIL,
    phone: order.recipientPhone,
    street: order.destStreet,
    number: order.destNumber,
    district: order.destDistrict,
    city: "Ciudad de Mexico",
    state,
    country: "MX",
    postalCode: order.destPostalCode,
    reference: "",
  };
}

function buildPackages(order: Order) {
  // El flujo no pide peso/dimensiones; usamos un paquete chico por defecto,
  // razonable para entregas locales/comida. Ajustar si hay datos reales.
  return [
    {
      content: order.items || "Pedido",
      amount: 1,
      type: "box",
      weight: 1,
      insurance: 0,
      declaredValue: order.declaredValue ?? 0,
      weightUnit: "KG",
      lengthUnit: "CM",
      dimensions: { length: 20, width: 20, height: 20 },
    },
  ];
}

async function enviaPost(pathname: string, body: unknown): Promise<EnviaResponse> {
  const token = requireEnv("ENVIA_TOKEN");
  let res: Response;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: `No se pudo conectar con Envia: ${msg}`, data: null };
  }

  const txt = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = txt ? (JSON.parse(txt) as Record<string, unknown>) : null;
  } catch {
    json = { raw: txt };
  }

  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      error: "Token inválido (401). Revisa ENVIA_TOKEN en tu .env.",
      data: json,
    };
  }
  if (!res.ok || (json && json.meta === "error")) {
    return {
      ok: false,
      status: res.status,
      error: extractError(json) || `Error HTTP ${res.status}`,
      data: json,
    };
  }
  return { ok: true, status: res.status, error: null, data: json };
}

function extractError(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  const err = json.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string") return m;
    if (Array.isArray(err)) {
      return err
        .map((e) => (e && typeof e === "object" && "message" in e ? String((e as Record<string, unknown>).message) : JSON.stringify(e)))
        .join("; ");
    }
  }
  if (typeof json.message === "string") return json.message;
  return null;
}

function isCoverageError(msg: string): boolean {
  const m = msg.toLowerCase();
  return ["coverage", "cobertura", "no service", "sin servicio", "not available"].some((k) => m.includes(k));
}

function isStateError(msg: string): boolean {
  const m = msg.toLowerCase();
  return ["state", "estado", "cmx", "province"].some((k) => m.includes(k));
}

function asArray(data: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!data) return [];
  const d = data.data;
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  if (d && typeof d === "object") return [d as Record<string, unknown>];
  return [];
}

export type RateOutcome =
  | { ok: true; quote: QuoteResult; stateUsed: string }
  | { ok: false; error: string; coverage: boolean };

// Envia cotiza UN carrier por llamada (no soporta "todos" en una sola request).
// Iteramos sobre una lista y juntamos lo que responda. Configurable por env.
const CARRIERS = (process.env.ENVIA_CARRIERS ||
  "fedex,redpack,estafeta,dhl,paquetexpress,ampm")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Cotiza con /ship/rate/ pidiendo carrier por carrier y quedándose con la tarifa
 * más barata. Reintenta con estado "DF" si "CMX" es rechazado. Los carriers no
 * habilitados en la cuenta se omiten sin abortar.
 */
export async function getRate(order: Order): Promise<RateOutcome> {
  let lastError = "No hay transportistas que devuelvan tarifa para este envío.";
  let sawCoverage = false;

  for (const state of ["CMX", "DF"]) {
    const collected: Record<string, unknown>[] = [];
    let stateRejected = false;

    for (const carrier of CARRIERS) {
      const body = {
        origin: buildAddress("origin", order, state),
        destination: buildAddress("destination", order, state),
        packages: buildPackages(order),
        shipment: { carrier, type: 1 },
        settings: { currency: "MXN" },
      };
      const r = await enviaPost("/ship/rate/", body);
      if (r.ok) {
        collected.push(...asArray(r.data));
        continue;
      }
      const err = r.error || "";
      if (isStateError(err)) {
        stateRejected = true; // reintentar todo el bloque con "DF"
        break;
      }
      if (isCoverageError(err)) sawCoverage = true;
      // Carrier no soportado/no habilitado → se omite y seguimos con el resto.
      lastError = err || lastError;
    }

    if (collected.length > 0) {
      const best = collected.reduce((a, b) =>
        Number(b.totalPrice) < Number(a.totalPrice) ? b : a,
      );
      const quote: QuoteResult = {
        carrier: String(best.carrier ?? ""),
        service: String(best.service ?? ""),
        serviceDescription: String(best.serviceDescription ?? best.service ?? ""),
        price: Number(best.totalPrice ?? 0),
        currency: String(best.currency ?? "MXN"),
        raw: best,
      };
      return { ok: true, quote, stateUsed: state };
    }

    // Si no fue problema de estado, no tiene sentido reintentar con "DF".
    if (!stateRejected) {
      return {
        ok: false,
        error: sawCoverage
          ? "Destino sin cobertura para los transportistas disponibles."
          : lastError,
        coverage: sawCoverage,
      };
    }
  }

  return { ok: false, error: "El API rechazó el estado (CMX/DF) para CDMX.", coverage: false };
}

export type GenerateOutcome =
  | { ok: true; trackingNumber: string; label: string | null; raw: unknown }
  | { ok: false; error: string };

/** Genera el envío real con /ship/generate/, incluyendo el servicio de COD. */
export async function generateShipment(
  order: Order,
  quote: QuoteResult,
  stateUsed: string,
): Promise<GenerateOutcome> {
  const body = {
    origin: buildAddress("origin", order, stateUsed),
    destination: buildAddress("destination", order, stateUsed),
    packages: buildPackages(order),
    shipment: {
      carrier: quote.carrier,
      service: quote.service,
      type: 1,
    },
    settings: {
      currency: "MXN",
      labelFormat: "pdf",
      printFormat: "PDF",
      printSize: "STOCK_4X6",
      comments: order.items || "",
      // COD (cobro contra entrega). NOTA: el shape exacto del payload de COD es
      // el campo más frágil de la integración (lo marcó la revisión). Verificar
      // contra docs.envia.com con un curl real antes del demo y ajustar aquí.
      cashOnDelivery: {
        amount: order.codAmount,
        currency: "MXN",
      },
    },
  };
  const r = await enviaPost("/ship/generate/", body);
  if (!r.ok) return { ok: false, error: r.error || "Error al generar el envío" };

  const data = asArray(r.data)[0];
  const trackingNumber =
    (data?.trackingNumber as string) ||
    (data?.tracking_number as string) ||
    (data?.tracking as string);
  if (!trackingNumber) {
    return { ok: false, error: "Envia no devolvió número de tracking." };
  }
  return { ok: true, trackingNumber, label: (data?.label as string) ?? null, raw: data };
}

export type TrackOutcome =
  | { ok: true; status: string; raw: unknown }
  | { ok: false; error: string };

/**
 * Rastrea un envío. La spec mencionaba GET /ship/generate/{tracking}, pero el
 * endpoint real de Envia es POST /ship/generaltrack/ con un array de tracking
 * numbers en el body. Usamos el real.
 */
export async function trackShipment(trackingNumber: string): Promise<TrackOutcome> {
  const r = await enviaPost("/ship/generaltrack/", { trackingNumbers: [trackingNumber] });
  if (!r.ok) return { ok: false, error: r.error || "Error al rastrear" };
  const data = asArray(r.data)[0];
  const statusRaw =
    (data?.status as Record<string, unknown>)?.description ??
    data?.status ??
    data?.statusDescription ??
    "sin estado";
  return {
    ok: true,
    status: typeof statusRaw === "string" ? statusRaw : JSON.stringify(statusRaw),
    raw: data,
  };
}
