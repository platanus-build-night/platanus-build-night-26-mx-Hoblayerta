/**
 * FASE 1 — Validación de la API de Envia (sandbox).
 *
 * Hace POST a /ship/rate/ con un origen y destino reales dentro de CDMX y un
 * paquete chico. Primero intenta SIN el bloque `shipment` (para que el API
 * devuelva todas las paqueterías); si responde 400 "Required property missing:
 * carrier", reintenta con shipment.carrier = "fedex".
 *
 * Imprime la respuesta completa e identifica qué carriers soportan entrega
 * local en CDMX y cobro contra entrega (COD).
 *
 * Correr:  npx tsx scripts/test-rate.ts
 */
import { loadEnv, requireEnv } from "../src/env";

loadEnv();

const BASE = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";

// Paqueterías de entrega local same-day en CDMX que nos interesan.
const LOCAL_CARRIERS = ["ivoy", "noventa9minutos", "99minutos", "treggo", "borzo"];

// CDMX: Colonia Roma (03100… en realidad 06700 es Roma Norte). Usamos dos CPs
// reales dentro de la ciudad para forzar una ruta intra-CDMX.
const ORIGIN = {
  name: "Taquería El Califa",
  company: "Taquería El Califa",
  email: "pickup@example.com",
  phone: "5512345678",
  street: "Avenida Insurgentes Sur",
  number: "300",
  district: "Roma Norte",
  city: "Ciudad de Mexico",
  state: "CMX",
  country: "MX",
  postalCode: "06700",
  reference: "Local en esquina",
};

const DESTINATION = {
  name: "Cliente de Prueba",
  company: "",
  email: "cliente@example.com",
  phone: "5587654321",
  street: "Calle Doctor Erazo",
  number: "120",
  district: "Doctores",
  city: "Ciudad de Mexico",
  state: "CMX",
  country: "MX",
  postalCode: "06720",
  reference: "Depto 4",
};

const PACKAGES = [
  {
    content: "Comida preparada",
    amount: 1,
    type: "box",
    weight: 1,
    insurance: 0,
    declaredValue: 250,
    weightUnit: "KG",
    lengthUnit: "CM",
    dimensions: { length: 25, width: 25, height: 15 },
  },
];

interface PostResult {
  status: number;
  json: any;
  rawText: string;
}

async function rate(body: unknown): Promise<PostResult> {
  const token = requireEnv("ENVIA_TOKEN");
  const res = await fetch(`${BASE}/ship/rate/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let json: any = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = { _unparseable: rawText };
  }
  return { status: res.status, json, rawText };
}

/**
 * ¿La respuesta indica que falta el campo carrier?
 * El sandbox lo señala de dos formas: HTTP 400 "Required property missing:
 * carrier", o bien HTTP 200 con un body { code: 400, description: "Undefined
 * property: stdClass::$carrier" }. Cubrimos ambas.
 */
function isCarrierMissing(r: PostResult): boolean {
  const blob = JSON.stringify(r.json ?? r.rawText).toLowerCase();
  const codeIs400 = r.status === 400 || r.json?.code === 400;
  return codeIs400 && blob.includes("carrier");
}

function rows(json: any): any[] {
  const d = json?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") return [d];
  return [];
}

async function main() {
  console.log(`▶ Envia sandbox: ${BASE}/ship/rate/`);
  console.log(`▶ Ruta: ${ORIGIN.postalCode} (${ORIGIN.district}) → ${DESTINATION.postalCode} (${DESTINATION.district}), state=${ORIGIN.state}\n`);

  const baseBody = {
    origin: ORIGIN,
    destination: DESTINATION,
    packages: PACKAGES,
    settings: { currency: "MXN" },
  };

  // Intento 1: SIN bloque shipment → debería devolver todas las paqueterías.
  console.log("── Intento 1: sin bloque `shipment` (todas las paqueterías) ──");
  let r = await rate(baseBody);
  console.log(`HTTP ${r.status}`);

  if (isCarrierMissing(r)) {
    // Intento 2: con carrier fedex, como exige el API.
    console.log('⚠ El API exige `carrier`. Reintentando con shipment={ carrier:"fedex", type:1 }\n');
    console.log("── Intento 2: con shipment.carrier = fedex ──");
    r = await rate({ ...baseBody, shipment: { carrier: "fedex", type: 1 } });
    console.log(`HTTP ${r.status}`);
  }

  console.log("\n── Respuesta completa ──");
  console.log(JSON.stringify(r.json, null, 2));

  const data = rows(r.json);
  const bodyCode = Number(r.json?.code ?? 200);
  if (r.status !== 200 || bodyCode >= 400 || data.length === 0) {
    console.log("\n❌ El rate NO devolvió tarifas reales. NO avanzar a la Fase 2.");
    if (r.json?.meta === "error" || r.json?.error) {
      console.log("   Detalle del error:", JSON.stringify(r.json?.error ?? r.json?.meta));
    }
    process.exitCode = 1;
    return;
  }

  // ── Resumen de tarifas ──
  console.log(`\n✅ ${data.length} tarifa(s) real(es) recibida(s):\n`);
  for (const t of data) {
    const carrier = String(t.carrier ?? "?");
    const service = String(t.serviceDescription ?? t.service ?? "?");
    const price = t.totalPrice ?? t.basePrice ?? "?";
    const currency = t.currency ?? "MXN";
    const deliveryEst = t.deliveryEstimate ?? t.deliveryDate ?? "";
    console.log(`  • ${carrier.padEnd(18)} ${service.padEnd(28)} ${price} ${currency}  ${deliveryEst}`);
  }

  // ── Detección de paqueterías locales / COD ──
  const carriersSeen = [...new Set(data.map((t) => String(t.carrier ?? "").toLowerCase()))];
  const localFound = carriersSeen.filter((c) =>
    LOCAL_CARRIERS.some((lc) => c.includes(lc) || lc.includes(c)),
  );

  console.log("\n── Paqueterías de entrega local en CDMX detectadas ──");
  if (localFound.length) {
    console.log("  ✅ " + localFound.join(", "));
  } else {
    console.log("  ⚠ Ninguna de [" + LOCAL_CARRIERS.join(", ") + "] apareció en este rate.");
    console.log("    Paqueterías disponibles: " + carriersSeen.join(", "));
  }

  // COD: algunos rates exponen banderas de servicios adicionales.
  console.log("\n── Indicadores de COD (cobro contra entrega) en la respuesta ──");
  const codHits = data.filter((t) => {
    const blob = JSON.stringify(t).toLowerCase();
    return blob.includes("cashondelivery") || blob.includes("cash_on_delivery") || blob.includes("cod");
  });
  if (codHits.length) {
    console.log(`  ✅ ${codHits.length} tarifa(s) mencionan COD. Carriers: ` +
      [...new Set(codHits.map((t) => String(t.carrier)))].join(", "));
  } else {
    console.log("  ℹ El rate no expone COD por tarifa (es normal: COD se agrega como");
    console.log("    servicio adicional en /ship/generate/). Verificar contra docs.envia.com.");
  }

  console.log("\n✅ Fase 1 OK: el rate devuelve precios reales. Se puede avanzar a la Fase 2.");
}

main().catch((e) => {
  console.error("\n❌ Excepción no controlada en la prueba:", e);
  process.exitCode = 1;
});
