/**
 * FASE 1 (validación COD) — Confirma el shape correcto del servicio adicional
 * cash_on_delivery probándolo contra /ship/rate/. Si el shape es correcto, la
 * respuesta debe poblar cashOnDeliveryAmount / cashOnDeliveryCommission (>0).
 *
 * Probamos dos ubicaciones del array additionalServices (top-level vs settings)
 * para los carriers locales de CDMX (ivoy, noventa9minutos).
 *
 * Correr:  npx tsx scripts/test-cod-rate.ts
 */
import { loadEnv, requireEnv } from "../src/env";

loadEnv();
const BASE = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";
const COD_AMOUNT = 250;

const ORIGIN = {
  name: "Taquería El Califa", company: "Taquería El Califa",
  email: "pickup@example.com", phone: "5512345678",
  street: "Avenida Insurgentes Sur", number: "300", district: "Roma Norte",
  city: "Ciudad de Mexico", state: "CMX", country: "MX", postalCode: "06700", reference: "",
};
const DESTINATION = {
  name: "Cliente de Prueba", company: "",
  email: "cliente@example.com", phone: "5587654321",
  street: "Calle Doctor Erazo", number: "120", district: "Doctores",
  city: "Ciudad de Mexico", state: "CMX", country: "MX", postalCode: "06720", reference: "",
};
const PACKAGES = [{
  content: "Comida preparada", amount: 1, type: "box", weight: 1, insurance: 0,
  declaredValue: 250, weightUnit: "KG", lengthUnit: "CM",
  dimensions: { length: 25, width: 25, height: 15 },
}];

const COD_SERVICE = { service: "cash_on_delivery", data: { amount: String(COD_AMOUNT) } };

async function rate(body: unknown) {
  const token = requireEnv("ENVIA_TOKEN");
  const res = await fetch(`${BASE}/ship/rate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return JSON.parse(await res.text());
}

function firstRow(json: any): any {
  const d = json?.data;
  if (Array.isArray(d)) return d[0];
  return d ?? json;
}

async function probe(carrier: string, label: string, extra: Record<string, unknown>) {
  const body = {
    origin: ORIGIN, destination: DESTINATION, packages: PACKAGES,
    shipment: { carrier, type: 1 }, settings: { currency: "MXN" }, ...extra,
  };
  const json = await rate(body);
  const r = firstRow(json);
  if (json?.code >= 400 || !r) {
    console.log(`   ${label.padEnd(26)} → ERROR: ${json?.description ?? json?.message ?? JSON.stringify(json)}`);
    return;
  }
  console.log(`   ${label.padEnd(26)} → total $${r.totalPrice}  codAmount=${r.cashOnDeliveryAmount}  codCommission=${r.cashOnDeliveryCommission}`);
}

async function main() {
  for (const carrier of ["ivoy", "noventa9minutos"]) {
    console.log(`\n══ ${carrier} ══`);
    await probe(carrier, "sin COD (baseline)", {});
    await probe(carrier, "additionalServices top", { additionalServices: [COD_SERVICE] });
    await probe(carrier, "settings.additionalServices", { settings: { currency: "MXN", additionalServices: [COD_SERVICE] } });
  }
  console.log("\nℹ Buscamos la variante donde codAmount/codCommission dejan de ser 0.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
