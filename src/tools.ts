import { ToolDef } from "./llm";
import { FIELDS, FieldDef } from "./validation";

function fieldSchema(f: FieldDef): Record<string, unknown> {
  return {
    type: f.type === "number" ? "number" : "string",
    description: f.label,
  };
}

/**
 * Tres tools. El curado del pedido vive en el esquema: solo estos campos
 * existen, así el modelo no inventa datos fuera del contrato.
 */
export const TOOLS: ToolDef[] = [
  {
    name: "update_order_fields",
    description:
      "Registra/actualiza los datos del pedido que el usuario haya dado en su último mensaje. Llámala cada vez que el usuario aporte información nueva. Incluye SOLO los campos que el usuario realmente mencionó; no inventes valores.",
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(FIELDS.map((f) => [f.key, fieldSchema(f)])),
      additionalProperties: false,
    },
  },
  {
    name: "get_quote",
    description:
      "Cotiza el envío con Envia.com. Llámala SOLO cuando no falte ningún dato del pedido. Devuelve el costo de envío real para mostrarlo al usuario.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_delivery",
    description:
      'Crea el envío REAL con Envia.com, incluyendo cobro contra entrega (COD). Llámala SOLO si ya existe una cotización vigente Y el usuario escribió "confirmar" en su último mensaje. Si la llamas antes, será rechazada por el sistema.',
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];
