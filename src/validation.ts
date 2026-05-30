import { Order } from "./types";

export type FieldType = "string" | "number" | "postalCode" | "phone" | "address";

export interface FieldDef {
  key: keyof Order;
  /** Etiqueta corta en español para mensajes. */
  label: string;
  /** Pregunta conversacional cuando falta el dato. */
  ask: string;
  type: FieldType;
}

/**
 * Modelo Lalamove. Orden = secuencia natural de preguntas:
 * recogida (dónde + quién entrega) → entrega (dónde + quién recibe) → qué se lleva.
 *
 * "Recoger" y "entregar" se mapean según lo que el usuario quiera:
 *  - Recibir un pedido → recogida = la tienda, entrega = el usuario.
 *  - Enviar algo       → recogida = el usuario, entrega = el destinatario.
 * El agente decide el encuadre; los campos son los mismos.
 */
export const FIELDS: FieldDef[] = [
  { key: "pickupAddress", label: "dirección de recogida", ask: "¿Cuál es la dirección COMPLETA de recogida? (calle, número, colonia y ciudad)", type: "address" },
  { key: "pickupContactName", label: "contacto en la recogida", ask: "¿A nombre de quién o de qué comercio recogemos?", type: "string" },
  { key: "pickupContactPhone", label: "teléfono en la recogida", ask: "¿Teléfono de contacto en la recogida? (10 dígitos)", type: "phone" },
  { key: "dropoffAddress", label: "dirección de entrega", ask: "¿Cuál es la dirección COMPLETA de entrega? (calle, número, colonia y ciudad)", type: "address" },
  { key: "dropoffContactName", label: "contacto en la entrega", ask: "¿A nombre de quién va la entrega?", type: "string" },
  { key: "dropoffContactPhone", label: "teléfono en la entrega", ask: "¿Teléfono de quien recibe? (10 dígitos)", type: "phone" },
  { key: "items", label: "qué se lleva", ask: "¿Qué vamos a llevar exactamente?", type: "string" },
];

export type ValidationResult =
  | { ok: true; value: string | number }
  | { ok: false; reason: string };

/** Valida y normaliza un valor según el tipo del campo. */
export function validateField(def: FieldDef, value: unknown): ValidationResult {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return { ok: false, reason: `${def.label} no puede estar vacío` };
  }

  switch (def.type) {
    case "string":
      return { ok: true, value: String(value).trim() };
    case "address": {
      const s = String(value).trim();
      // Una dirección utilizable trae al menos calle + algo más; pedimos >8 chars.
      if (s.length < 8) {
        return { ok: false, reason: "la dirección parece incompleta; incluye calle, número, colonia y ciudad" };
      }
      return { ok: true, value: s };
    }
    case "number": {
      const n =
        typeof value === "number"
          ? value
          : Number(String(value).replace(/[^0-9.]/g, ""));
      if (!isFinite(n) || n <= 0) {
        return { ok: false, reason: `${def.label} debe ser un número mayor a 0` };
      }
      return { ok: true, value: n };
    }
    case "postalCode": {
      const s = String(value).trim();
      if (!/^\d{5}$/.test(s)) {
        return { ok: false, reason: "el código postal debe tener exactamente 5 dígitos" };
      }
      return { ok: true, value: s };
    }
    case "phone": {
      const s = String(value).replace(/\D/g, "");
      if (!/^\d{10}$/.test(s)) {
        return { ok: false, reason: "el teléfono debe tener exactamente 10 dígitos" };
      }
      return { ok: true, value: s };
    }
  }
}

/** Devuelve los campos que aún faltan (vacíos/indefinidos) en el pedido. */
export function missingFields(order: Order): FieldDef[] {
  return FIELDS.filter((f) => {
    const v = order[f.key];
    return v === undefined || v === null || v === "";
  });
}
