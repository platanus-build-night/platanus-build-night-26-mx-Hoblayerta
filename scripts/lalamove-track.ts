/**
 * Sondea el estado de una orden Lalamove hasta que cambie a un estado terminal.
 *
 * Uso:  npx tsx scripts/lalamove-track.ts <orderId> [intervaloSeg] [maxMin]
 */
import { loadEnv } from "../src/env";
loadEnv();
import { trackShipment } from "../src/lalamove";

const orderId = process.argv[2];
const intervalSec = Number(process.argv[3] || 30);
const maxMin = Number(process.argv[4] || 30);

if (!orderId) {
  console.error("Falta el orderId. Uso: npx tsx scripts/lalamove-track.ts <orderId>");
  process.exit(1);
}

// Estados donde dejamos de sondear (ya hay repartidor o la orden terminó).
const DONE = new Set(["ON_GOING", "PICKED_UP", "COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function main(): Promise<void> {
  const deadline = Date.now() + maxMin * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const r = await trackShipment(orderId);
    if (!r.ok) {
      console.log(`[${stamp()}] error: ${r.error}`);
    } else {
      const raw = r.raw as Record<string, unknown>;
      const driver = String(raw.driverId || "");
      if (r.status !== last) {
        console.log(`[${stamp()}] estado: ${r.status}${driver ? ` (driver ${driver})` : ""}`);
        last = r.status;
      }
      if (DONE.has(r.status)) {
        console.log(`[${stamp()}] 🏁 terminal: ${r.status}`);
        return;
      }
    }
    await new Promise((res) => setTimeout(res, intervalSec * 1000));
  }
  console.log(`[${stamp()}] ⏱️ se acabó la ventana de ${maxMin} min; última: ${last || "sin estado"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
