/**
 * Verificación de la cuenta Lalamove: lista ciudades, servicios y special requests
 * disponibles para tu Market (MX). Úsalo para confirmar:
 *   - El locode de la ciudad (ej. "MX MEX" = CDMX).
 *   - Los serviceType válidos (MOTORCYCLE, SEDAN, VAN, ...).
 *   - Si "COD" aparece en specialRequests (saber si puedes cobrar contra entrega).
 *
 * Correr:  npx tsx scripts/lalamove-cities.ts
 */
import crypto from "crypto";
import { loadEnv, requireEnv } from "../src/env";

loadEnv();

const BASE = process.env.LALAMOVE_BASE_URL || "https://rest.lalamove.com";
const MARKET = process.env.LALAMOVE_MARKET || "MX";

async function main(): Promise<void> {
  const apiKey = requireEnv("LALAMOVE_API_KEY");
  const secret = requireEnv("LALAMOVE_API_SECRET");
  const ts = Date.now().toString();
  const path = "/v3/cities";
  const raw = `${ts}\r\nGET\r\n${path}\r\n\r\n`;
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `hmac ${apiKey}:${ts}:${signature}`,
      Market: MARKET,
      "Request-ID": crypto.randomUUID(),
      Accept: "application/json",
    },
  });

  const txt = await res.text();
  if (!res.ok) {
    console.log(`❌ HTTP ${res.status}\n${txt}`);
    process.exit(1);
  }

  const json = JSON.parse(txt);
  const cities = json?.data ?? json;
  if (!Array.isArray(cities)) {
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  for (const c of cities) {
    console.log(`\n🏙️  ${c.locode}  —  ${c.name ?? ""}`);
    for (const s of c.services ?? []) {
      const sr = (s.specialRequests ?? c.specialRequests ?? [])
        .map((x: { name?: string }) => x.name)
        .filter(Boolean);
      const hasCOD = sr.some((n: string) => /cod|cash/i.test(n));
      console.log(`   • ${s.key}${hasCOD ? "   [COD disponible]" : ""}`);
      if (sr.length) console.log(`       specialRequests: ${sr.join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
