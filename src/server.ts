import { loadEnv } from "./env";
loadEnv();

import http from "http";
import { NodeListener } from "mppx/server";
import { processOrder } from "./flow";
import { createMppx, chargeOptions } from "./payment";

// Gate de pago MPP (transporte HTTP por defecto). Se crea una vez, perezoso:
// si MPP no está configurado, solo falla al intentar COBRAR (confirmar), no al cotizar.
let _mppx: ReturnType<typeof createMppx> | null = null;
function paymentGate() {
  if (!_mppx) _mppx = createMppx();
  return _mppx;
}

const PORT = Number(process.env.PORT || 8787);
// Si API_KEY está definida, /order exige Authorization: Bearer <API_KEY>.
// Sin auth, un endpoint público podría crear envíos reales con COD. NO lo dejes
// sin API_KEY en producción.
const API_KEY = process.env.API_KEY || "";

function send(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2));
}

/** Instrucciones que un agente externo lee para conducir el pedido por sí mismo. */
function agentInstructions(base: string, apiKey: string): string {
  const bearer = apiKey ? `\n  Authorization: Bearer ${apiKey}` : "";
  return `# Asistente de entregas CDMX (Lalamove)

Eres un asistente de entregas en la Ciudad de México que crea entregas reales con
Lalamove a través de un endpoint HTTP. Hablas español, breve y claro.

## Endpoint
- Cotizar:  POST ${base}/order
- Crear:    POST ${base}/order?confirm=true
- Headers:  Content-Type: application/json${bearer}

## Flujo
1. Primero pregunta: "¿Quieres ENVIAR algo (lo mandas tú) o RECIBIR un pedido (lo
   recogemos de una tienda y te lo traen)?"
   - RECIBIR → la recogida es la TIENDA; la entrega es la dirección del usuario.
   - ENVIAR  → la recogida es el usuario; la entrega es el destinatario.
2. Haz las preguntas UNA A LA VEZ hasta tener los 7 datos. Las direcciones deben ir
   COMPLETAS (calle, número, colonia y ciudad) porque se geolocalizan. Si tienes las
   coordenadas EXACTAS del punto, puedes mandarlas como "lat,lng" (ej "19.4358,-99.1834")
   y se usan tal cual. No mandes coordenadas aproximadas que no correspondan al lugar.
3. Con todo listo, llama a POST /order (SIN confirm). Muestra el resumen y el costo
   que devuelve y pide que el usuario escriba "confirmar".
4. SOLO cuando el usuario escriba "confirmar", repite con POST /order?confirm=true y
   el mismo JSON. Devuelve el número de orden y el shareLink. Nunca confirmes sin un
   "confirmar" explícito.

## Pago (MPP / stablecoin) — solo al confirmar
La confirmación está gateada con el Machine Payments Protocol (HTTP 402):
- POST /order?confirm=true responde **402** con un header WWW-Authenticate que es un
  Challenge MPP: cuánto pagar (en stablecoin de Tempo) y a qué wallet.
- Paga el Challenge en Tempo (con un cliente mppx o un wallet de agente) y reintenta
  la MISMA request con el Credential en el header Authorization.
- El server verifica el pago on-chain, crea la entrega y devuelve el Receipt en el
  header Payment-Receipt + el JSON con trackingNumber/shareLink.
Si usas el SDK mppx (fetch que paga solo) o el MCP server, este paso es automático.

## Body JSON
{
  "pickupAddress": "calle, número, colonia, ciudad",
  "pickupContactName": "nombre o comercio",
  "pickupContactPhone": "10 dígitos",
  "dropoffAddress": "calle, número, colonia, ciudad",
  "dropoffContactName": "nombre",
  "dropoffContactPhone": "10 dígitos",
  "items": "qué se lleva"
}

## Respuestas del endpoint
- Cotización: { ok:true, stage:"cotizado", resumen:{...}, siguiente:"..." }
- Creada:     { ok:true, stage:"creado", trackingNumber, estado, shareLink }
- Error:      { ok:false, stage, error, ... }  → explícalo en español y di qué hacer.

Nota: COD (cobrar la mercancía) NO está disponible en Lalamove México.`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "delivery-agent-cdmx" });
  }

  // Instrucciones para un agente externo (OpenClaw/Cursor/Claude). Le das UNA
  // línea con este URL y el agente lee de aquí cómo conducir el pedido. Si hay
  // API_KEY, se exige como ?k=<API_KEY> (así el token no queda público) y se
  // incrusta en las instrucciones que devuelve.
  if (req.method === "GET" && url.pathname === "/agent") {
    if (API_KEY && url.searchParams.get("k") !== API_KEY) {
      return send(res, 401, { ok: false, error: "Agrega ?k=<API_KEY> al URL." });
    }
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const base = `${proto}://${host}`;
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
    return res.end(agentInstructions(base, API_KEY));
  }

  if (req.method !== "POST" || url.pathname !== "/order") {
    return send(res, 404, { ok: false, error: "Usa POST /order con el pedido en JSON." });
  }

  if (API_KEY) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${API_KEY}`) {
      return send(res, 401, { ok: false, error: "No autorizado. Manda header Authorization: Bearer <API_KEY>." });
    }
  }

  let raw = "";
  try {
    for await (const chunk of req) raw += chunk;
  } catch {
    return send(res, 400, { ok: false, error: "No se pudo leer el body." });
  }

  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return send(res, 400, { ok: false, error: "El body no es JSON válido." });
  }

  // confirm puede venir por query (?confirm=true) o en el body { "confirm": true }.
  const confirm = url.searchParams.get("confirm") === "true" || body.confirm === true;
  // El pedido puede venir como { "order": {...} } o ser el body completo.
  const orderInput = "order" in body ? body.order : body;

  try {
    // ── Cotizar (gratis, sin pago) ──
    if (!confirm) {
      const quote = await processOrder(orderInput, false);
      const { status, ...rest } = quote;
      return send(res, status, rest);
    }

    // ── Confirmar: gate de pago MPP ANTES de crear la entrega real ──
    // 1. Re-cotiza en el server para fijar el precio (el cliente no puede pagar de menos).
    const quote = await processOrder(orderInput, false);
    if (!quote.ok || typeof quote.priceMXN !== "number") {
      const { status, ...rest } = quote;
      return send(res, status, rest);
    }
    const priceMXN = quote.priceMXN;

    // 2. Aplica el cobro en stablecoin. mppx lee el Credential del header Authorization.
    const fetchReq = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
      method: "POST",
      headers: req.headers as Record<string, string>,
      body: raw || undefined,
    });
    const dropoff = (orderInput as Record<string, unknown>)?.dropoffAddress ?? "";
    const result = await paymentGate().charge(
      chargeOptions(priceMXN, `Entrega Lalamove → ${dropoff}`),
    )(fetchReq);

    // 3. Sin pago válido → 402 con el Challenge (WWW-Authenticate). No se crea NADA.
    if (result.status === 402) {
      return void (await NodeListener.sendResponse(res, result.challenge));
    }

    // 4. Pago verificado on-chain → AHORA sí se crea la entrega real en Lalamove.
    const created = await processOrder(orderInput, true);
    const { status, ...rest } = created;
    const okResp = new Response(JSON.stringify(rest, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    return void (await NodeListener.sendResponse(res, result.withReceipt(okResp)));
  } catch (e) {
    return send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`Delivery API escuchando en http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /order        (cotiza)`);
  console.log(`  POST /order?confirm=true   (genera envío real)`);
  if (!API_KEY) console.log("  ⚠️  API_KEY no definida: el endpoint está ABIERTO. Define API_KEY antes de exponerlo.");
});
