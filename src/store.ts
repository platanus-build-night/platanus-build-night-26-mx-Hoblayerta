import fs from "fs";
import path from "path";

const LOG = path.resolve(process.cwd(), "orders.json");

/** Agrega un registro de pedido al log local JSON (append a un array). */
export function persistOrder(record: Record<string, unknown>): void {
  let arr: unknown[] = [];
  try {
    if (fs.existsSync(LOG)) {
      const parsed = JSON.parse(fs.readFileSync(LOG, "utf8"));
      if (Array.isArray(parsed)) arr = parsed;
    }
  } catch {
    // Si el archivo está corrupto, empezamos de cero en vez de romper el flujo.
    arr = [];
  }
  arr.push({ ...record, savedAt: new Date().toISOString() });
  fs.writeFileSync(LOG, JSON.stringify(arr, null, 2), "utf8");
}
