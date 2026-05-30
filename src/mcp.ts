import { loadEnv } from "./env";
loadEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Transport } from "mppx/mcp-sdk/server";
import { z } from "zod";
import { processOrder } from "./flow";
import { createMppx, chargeOptions, paymentInfo } from "./payment";

/**
 * MCP server de entregas CDMX con pago MPP.
 *
 * Cualquier agente compatible con MCP (Claude, Cursor, OpenClaw…) registra este
 * server y obtiene dos herramientas:
 *   - cotizar_entrega  → gratis, devuelve el costo.
 *   - confirmar_entrega → cobra en stablecoin (Tempo) a TU wallet vía MPP y, solo
 *     tras verificar el pago on-chain, crea la entrega real en Lalamove.
 *
 * El flujo de pago MPP es automático para el agente: si llama confirmar_entrega
 * sin Credential, recibe un error -32042 con el Challenge (cuánto/ a qué wallet);
 * paga en Tempo y reintenta con el Credential en _meta; el server verifica y crea.
 */

const mppx = createMppx(Transport.mcpSdk());

const server = new McpServer({ name: "entregas-cdmx-lalamove", version: "0.2.0" });

const orderShape = {
  pickupAddress: z.string().describe("Dirección COMPLETA de recogida (calle, número, colonia, ciudad) o 'lat,lng'"),
  pickupContactName: z.string().describe("Nombre o comercio en la recogida"),
  pickupContactPhone: z.string().describe("Teléfono de contacto en la recogida (10 dígitos)"),
  dropoffAddress: z.string().describe("Dirección COMPLETA de entrega o 'lat,lng'"),
  dropoffContactName: z.string().describe("Nombre de quien recibe"),
  dropoffContactPhone: z.string().describe("Teléfono de quien recibe (10 dígitos)"),
  items: z.string().describe("Qué se va a llevar"),
};

server.registerTool(
  "cotizar_entrega",
  {
    title: "Cotizar entrega",
    description:
      "Cotiza una entrega Lalamove en CDMX. Devuelve el costo. Es GRATIS, no crea nada ni cobra.",
    inputSchema: orderShape,
  },
  async (order) => {
    const r = await processOrder(order, false);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
  },
);

server.registerTool(
  "confirmar_entrega",
  {
    title: "Confirmar entrega (requiere pago)",
    description:
      "Crea la entrega Lalamove REAL. Requiere pago en stablecoin (Tempo) equivalente al costo cotizado, " +
      "que cae a la wallet del proveedor. Sin pago verificado no se crea nada.",
    inputSchema: orderShape,
  },
  async (order, extra) => {
    // 1. Re-cotiza en el server para fijar el precio (anti-manipulación).
    const quote = await processOrder(order, false);
    if (!quote.ok || typeof quote.priceMXN !== "number") {
      return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }], isError: true };
    }

    // 2. Cobro MPP. Sin Credential válido lanza el Challenge (-32042).
    const result = await mppx.charge(
      chargeOptions(quote.priceMXN, `Entrega Lalamove → ${order.dropoffAddress}`),
    )(extra);
    if (result.status === 402) throw result.challenge;

    // 3. Pago verificado → se crea la entrega real en Lalamove.
    const created = await processOrder(order, true);
    return result.withReceipt({
      content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
      isError: !created.ok,
    });
  },
);

async function main(): Promise<void> {
  const info = paymentInfo();
  console.error(
    `MCP entregas-cdmx-lalamove listo. Cobro: ${info.network}, recipient ${info.recipient}, token ${info.currency}.`,
  );
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
