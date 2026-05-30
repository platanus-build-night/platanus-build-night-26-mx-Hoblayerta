/**
 * FASE 1 (sonda) — Descubre qué carriers están habilitados en ESTE token de
 * sandbox para una ruta intra-CDMX. El endpoint /ship/rate/ de Envia exige un
 * `carrier`; si el carrier no está habilitado para la cuenta, el backend revienta
 * con "Undefined array key 1". Probamos una lista y reportamos cuáles devuelven
 * tarifas reales.
 *
 * Correr:  npx tsx scripts/probe-carriers.ts
 */
import { loadEnv, requireEnv } from "../src/env";

loadEnv();

const BASE = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";

const CARRIERS = [
  "fedex", "dhl", "redpack", "estafeta", "paquetexpress", "ampm",
  "sendex", "carssa", "jtexpress", "quiken", "scm", "noventa9minutos",
  "99minutos", "ivoy", "treggo", "borzo", "uber",
];

const ORIGIN = {
  name: "Taquería El Califa", company: "Taquería El Califa",
  email: "pickup@example.com", phone: "5512345678",
  street: "Avenida Insurgentes Sur", number: "300", district: "Roma Norte",
  city: "Ciudad de Mexico", state: "CMX", country: "MX",
  postalCode: "06700", reference: "Local en esquina",
};
const DESTINATION = {
  name: "Cliente de Prueba", company: "",
  email: "cliente@example.com", phone: "5587654321",
  street: "Calle Doctor Erazo", number: "120", district: "Doctores",
  city: "Ciudad de Mexico", state: "CMX", country: "MX",
  postalCode: "06720", reference: "Depto 4",
};
const PACKAGES = [{
  content: "Comida preparada", amount: 1, type: "box", weight: 1, insurance: 0,
  declaredValue: 250, weightUnit: "KG", lengthUnit: "CM",
  dimensions: { length: 25, width: 25, height: 15 },
}];

async function rate(carrier: string) {
  const token = requireEnv("ENVIA_TOKEN");
  const body = {
    origin: ORIGIN, destination: DESTINATION, packages: PACKAGES,
    shipment: { carrier, type: 1 }, settings: { currency: "MXN" },
  };
  const res = await fetch(`${BASE}/ship/rate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
  return { http: res.status, json };
}

function rows(json: any): any[] {
  const d = json?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") return [d];
  return [];
}

async function main() {
  console.log(`▶ Sondeando carriers en ${BASE}/ship/rate/  (${ORIGIN.postalCode} → ${DESTINATION.postalCode}, CDMX)\n`);
  const ok: { carrier: string; services: { service: string; price: any; currency: any }[] }[] = [];

  for (const carrier of CARRIERS) {
    const r = await rate(carrier);
    const code = Number(r.json?.code ?? r.http);
    const data = rows(r.json);
    if (r.http === 200 && code < 400 && data.length) {
      const services = data.map((t) => ({
        service: String(t.serviceDescription ?? t.service ?? "?"),
        price: t.totalPrice ?? t.basePrice ?? "?",
        currency: t.currency ?? "MXN",
      }));
      ok.push({ carrier, services });
      console.log(`✅ ${carrier.padEnd(16)} → ${services.length} servicio(s): ` +
        services.map((s) => `${s.service} $${s.price}`).join(" | "));
    } else {
      const why = r.json?.description ?? r.json?.message ?? r.json?.error ?? `HTTP ${r.http}`;
      console.log(`✗  ${carrier.padEnd(16)} → ${typeof why === "string" ? why : JSON.stringify(why)}`);
    }
  }

  console.log("\n── Resumen ──");
  if (ok.length) {
    console.log("Carriers con tarifas reales para esta ruta CDMX:");
    for (const c of ok) {
      console.log(`  • ${c.carrier}: ` + c.services.map((s) => `${s.service} ($${s.price} ${s.currency})`).join(", "));
    }
  } else {
    console.log("⚠ Ningún carrier de la lista devolvió tarifas. Revisar token/cobertura.");
  }
}

main().catch((e) => { console.error("❌", e); process.exitCode = 1; });
