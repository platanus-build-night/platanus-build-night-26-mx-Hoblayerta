import { Order } from "./types";
import { FIELDS, validateField, missingFields } from "./validation";
import { getRate, generateShipment, trackShipment } from "./lalamove";
import { persistOrder } from "./store";

export interface FlowResult {
  ok: boolean;
  stage: string;
  /** Código HTTP sugerido (lo usa el server; el CLI lo ignora). */
  status: number;
  [key: string]: unknown;
}

/**
 * Núcleo compartido por el CLI (order.ts) y el server HTTP (server.ts).
 * Valida → cotiza → (si confirm) genera envío real con COD → trackea.
 */
export async function processOrder(input: unknown, confirm: boolean): Promise<FlowResult> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, stage: "input", status: 400, error: "El pedido debe ser un objeto JSON." };
  }

  const obj = input as Record<string, unknown>;
  const order: Order = {};
  const errors: string[] = [];
  for (const f of FIELDS) {
    const v = obj[f.key as string];
    if (v === undefined || v === null || v === "") continue;
    const res = validateField(f, v);
    if (res.ok) (order[f.key] as string | number) = res.value;
    else errors.push(`${f.key}: ${res.reason}`);
  }

  const missing = missingFields(order).map((f) => f.key);
  if (errors.length > 0 || missing.length > 0) {
    return { ok: false, stage: "validación", status: 422, errors, missing };
  }

  const rate = await getRate(order);
  if (!rate.ok) {
    return {
      ok: false,
      stage: "cotización",
      status: rate.coverage ? 409 : 502,
      error: rate.error,
      coverage: rate.coverage,
    };
  }

  const resumen = {
    recogeEn: order.pickupAddress,
    entregaEn: order.dropoffAddress,
    items: order.items,
    transportista: rate.quote.carrier,
    servicio: rate.quote.serviceDescription,
    costoEnvio: `${rate.quote.price} ${rate.quote.currency}`,
    ...(order.codAmount ? { cobroContraEntrega: `${order.codAmount} MXN` } : {}),
  };

  // Candado de confirmación: sin confirm NO se crea ningún envío.
  if (!confirm) {
    return {
      ok: true,
      stage: "cotizado",
      status: 200,
      resumen,
      siguiente: 'Muestra el resumen al usuario. Cuando diga "confirmar", repite la llamada con confirm.',
    };
  }

  const gen = await generateShipment(order, rate.quote, rate.quotationId, rate.stops);
  if (!gen.ok) {
    return { ok: false, stage: "generar", status: 502, error: gen.error };
  }

  persistOrder({ order, quote: rate.quote, trackingNumber: gen.trackingNumber, stateUsed: "MX" });
  const track = await trackShipment(gen.trackingNumber);

  return {
    ok: true,
    stage: "creado",
    status: 200,
    resumen,
    trackingNumber: gen.trackingNumber,
    estado: track.ok ? track.status : `(sin estado aún: ${track.error})`,
    shareLink: gen.shareLink,
  };
}
