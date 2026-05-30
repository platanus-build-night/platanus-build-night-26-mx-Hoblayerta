import fs from "fs";
import path from "path";

/**
 * Carga un archivo .env sin dependencias externas.
 * No sobreescribe variables ya presentes en process.env.
 */
export function loadEnv(file = ".env"): void {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/** Devuelve la variable de entorno o lanza un error claro si falta. */
export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Falta la variable de entorno ${key}. Cópiala en tu archivo .env (ver .env.example).`,
    );
  }
  return v;
}
