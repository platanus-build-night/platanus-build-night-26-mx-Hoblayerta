import { loadEnv } from "./env";
loadEnv();

import fs from "fs";
import { processOrder } from "./flow";

/**
 * Punto de entrada NO interactivo por CLI.
 *
 * Uso:
 *   npm run order -- '<json del pedido>'            # solo cotiza
 *   npm run order -- '<json del pedido>' --confirm  # cotiza y genera el envío real
 *
 * El JSON también puede venir por stdin o por la env ORDER_JSON.
 */

function readInput(): string {
  const positional = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (positional) return positional;
  if (process.env.ORDER_JSON) return process.env.ORDER_JSON;
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm") || process.env.CONFIRM === "1";
  const raw = readInput().trim();
  if (!raw) {
    console.log(JSON.stringify({ ok: false, stage: "input", error: "Falta el pedido en JSON. Uso: npm run order -- '<json>' [--confirm]" }, null, 2));
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ ok: false, stage: "input", error: "El input no es JSON válido." }, null, 2));
    process.exit(1);
  }

  const result = await processOrder(parsed, confirm);
  const { status, ...rest } = result;
  void status;
  console.log(JSON.stringify(rest, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, stage: "excepción", error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
