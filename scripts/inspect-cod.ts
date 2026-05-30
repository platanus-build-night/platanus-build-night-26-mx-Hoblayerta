/**
 * FASE 1 (sonda COD) — Vuelca la respuesta COMPLETA de /ship/rate/ para los
 * carriers locales que sí funcionan (ivoy, noventa9minutos, estafeta), para ver
 * qué campos exponen sobre servicios adicionales / cash on delivery (COD).
 *
 * Correr:  npx tsx scripts/inspect-cod.ts
 */
import { loadEnv, requireEnv } from "../src/env";

loadEnv();
const BASE = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";

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

async function rate(carrier: string) {
  const token = requireEnv("ENVIA_TOKEN");
  const res = await fetch(`${BASE}/ship/rate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      origin: ORIGIN, destination: DESTINATION, packages: PACKAGES,
      shipment: { carrier, type: 1 }, settings: { currency: "MXN" },
    }),
  });
  return JSON.parse(await res.text());
}

async function main() {
  for (const carrier of ["ivoy", "noventa9minutos", "estafeta"]) {
    console.log(`\n══════════ ${carrier} ══════════`);
    const json = await rate(carrier);
    console.log(JSON.stringify(json, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
