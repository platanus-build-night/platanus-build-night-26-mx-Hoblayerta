import { chat, Msg, Block, ToolResultBlock } from "./llm";
import { TOOLS } from "./tools";
import { FIELDS, validateField, missingFields } from "./validation";
import { Order, QuoteResult, OrderStatus } from "./types";
import { getRate, generateShipment, trackShipment } from "./lalamove";
import { persistOrder } from "./store";

const SYSTEM = `Eres un asistente de entregas para la Ciudad de México que opera con Lalamove (mensajería same-day en moto/auto). Hablas SIEMPRE en español, con tono cercano, breve y claro.

Tu trabajo: a partir de UNA línea de texto del usuario, reunir los datos necesarios y crear una entrega real con Lalamove.

ARRANQUE — lo primero que haces:
- Si por el primer mensaje no queda clarísimo el sentido del envío, pregunta: "¿Quieres ENVIAR algo (lo mandas tú) o RECIBIR un pedido (lo recogemos de una tienda y te lo traemos)?"
- Según la respuesta, encuadra los campos:
  · RECIBIR un pedido → la recogida es la TIENDA/comercio; la entrega es el USUARIO.
  · ENVIAR algo       → la recogida es el USUARIO; la entrega es el DESTINATARIO.
- Internamente siempre son los mismos campos: recogida (dirección + contacto + teléfono) y entrega (dirección + contacto + teléfono). Solo cambia cómo lo explicas.

Reglas estrictas:
- Pregunta los datos que falten UNO A LA VEZ. Nunca pidas varios datos en el mismo mensaje.
- Las direcciones deben ir COMPLETAS (calle, número, colonia y ciudad) porque las geolocalizamos. Si una dirección viene vaga, pide que la complete.
- Cada vez que el usuario dé uno o más datos, llama a update_order_fields con SOLO los campos que mencionó. No inventes valores.
- update_order_fields devuelve qué falta y qué fue inválido. Si algo fue inválido, explica brevemente por qué y vuelve a pedir ESE dato.
- Cuando "allComplete" sea true, llama a get_quote para cotizar con Lalamove. Luego muestra un resumen claro: qué se lleva, de dónde a dónde, y el costo de la entrega. Pide explícitamente que escriba "confirmar".
- NUNCA llames a create_delivery hasta que exista una cotización vigente y el usuario haya escrito "confirmar". Si lo intentas antes, el sistema lo rechaza.
- Tras crear la entrega, comparte el número de orden, el enlace de seguimiento (shareLink) y el estado que te devuelva el sistema.
- Si una tool devuelve un error, explícaselo al usuario en español de forma simple y dile qué puede hacer.`;

interface ToolOutput {
  content: Record<string, unknown>;
  isError: boolean;
}

const CONFIRM_WORDS = ["confirmar", "confirmo", "si confirmar", "si, confirmar", "lo confirmo"];

export class DeliveryAgent {
  private messages: Msg[] = [];
  private order: Order = {};
  private status: OrderStatus = "collecting";
  private quote: QuoteResult | null = null;
  private quotationId = "";
  private stops: { stopId: string }[] = [];
  private confirmed = false;

  /** Procesa un mensaje del usuario y emite respuestas vía `say`. */
  async handle(userText: string, say: (s: string) => void): Promise<void> {
    // Candado determinista de confirmación: un "confirmar fresco" solo cuenta
    // si hay una cotización vigente y ESTE mensaje es la confirmación.
    const normalized = userText.trim().toLowerCase();
    this.confirmed = this.status === "quoted" && CONFIRM_WORDS.includes(normalized);

    this.messages.push({ role: "user", content: [{ type: "text", text: userText }] });

    // Bucle de tool-calling hasta que el modelo deje de pedir tools.
    for (let i = 0; i < 8; i++) {
      const res = await chat({ system: SYSTEM, messages: this.messages, tools: TOOLS });

      const assistantBlocks: Block[] = [];
      if (res.text.trim()) {
        say(res.text.trim());
        assistantBlocks.push({ type: "text", text: res.text });
      }
      for (const tu of res.toolUses) assistantBlocks.push(tu);
      if (assistantBlocks.length === 0) {
        // Defensa: Anthropic requiere contenido no vacío en el mensaje.
        assistantBlocks.push({ type: "text", text: "(procesando)" });
      }
      this.messages.push({ role: "assistant", content: assistantBlocks });

      if (res.toolUses.length === 0) return; // el modelo espera al usuario

      const results: ToolResultBlock[] = [];
      for (const tu of res.toolUses) {
        const out = await this.dispatch(tu.name, tu.input, say);
        results.push({
          type: "tool_result",
          toolUseId: tu.id,
          content: JSON.stringify(out.content),
          isError: out.isError,
        });
      }
      this.messages.push({ role: "user", content: results });
    }
  }

  private async dispatch(
    name: string,
    input: Record<string, unknown>,
    say: (s: string) => void,
  ): Promise<ToolOutput> {
    switch (name) {
      case "update_order_fields":
        return this.toolUpdate(input);
      case "get_quote":
        return this.toolQuote();
      case "create_delivery":
        return this.toolCreate(say);
      default:
        return { content: { error: `Tool desconocida: ${name}` }, isError: true };
    }
  }

  private toolUpdate(input: Record<string, unknown>): ToolOutput {
    const invalid: { field: string; reason: string }[] = [];
    const accepted: string[] = [];

    for (const f of FIELDS) {
      const raw = input[f.key as string];
      if (raw === undefined || raw === null || raw === "") continue;
      const v = validateField(f, raw);
      if (v.ok) {
        // El tipo del valor (string|number) está garantizado por validateField.
        (this.order[f.key] as string | number) = v.value;
        accepted.push(f.key);
      } else {
        invalid.push({ field: f.key, reason: v.reason });
      }
    }

    // Cualquier cambio de datos invalida una cotización/confirmación previa.
    if (accepted.length > 0 && this.status !== "collecting") {
      this.status = "collecting";
      this.quote = null;
      this.confirmed = false;
    }

    const missing = missingFields(this.order).map((f) => ({
      key: f.key,
      label: f.label,
      ask: f.ask,
    }));

    return {
      content: { accepted, invalid, missing, allComplete: missing.length === 0 },
      isError: false,
    };
  }

  private async toolQuote(): Promise<ToolOutput> {
    const missing = missingFields(this.order);
    if (missing.length > 0) {
      return {
        content: { error: "Aún faltan datos", missing: missing.map((m) => m.key) },
        isError: true,
      };
    }
    const r = await getRate(this.order);
    if (!r.ok) {
      return { content: { error: r.error, coverage: r.coverage }, isError: true };
    }
    this.quote = r.quote;
    this.quotationId = r.quotationId;
    this.stops = r.stops;
    this.status = "quoted";
    this.confirmed = false;
    return {
      content: {
        shippingCost: r.quote.price,
        currency: r.quote.currency,
        carrier: r.quote.carrier,
        service: r.quote.serviceDescription,
        codAmount: this.order.codAmount,
        items: this.order.items,
        pickup: this.order.pickupAddress,
        dropoff: this.order.dropoffAddress,
        instruction:
          'Muestra este resumen al usuario (de dónde a dónde y el costo de la entrega) y pídele que escriba "confirmar".',
      },
      isError: false,
    };
  }

  private async toolCreate(say: (s: string) => void): Promise<ToolOutput> {
    if (this.status !== "quoted" || !this.quote) {
      return {
        content: { error: "No hay cotización vigente. Primero cotiza con get_quote." },
        isError: true,
      };
    }
    if (!this.confirmed) {
      return {
        content: { error: 'El usuario no escribió "confirmar". No se puede crear el envío.' },
        isError: true,
      };
    }

    const r = await generateShipment(this.order, this.quote, this.quotationId, this.stops);
    if (!r.ok) {
      return { content: { error: r.error }, isError: true };
    }

    this.status = "created";
    this.confirmed = false;
    persistOrder({
      order: this.order,
      quote: this.quote,
      trackingNumber: r.trackingNumber,
      shareLink: r.shareLink,
    });

    say(`📦 Entrega creada con Lalamove. Orden: ${r.trackingNumber}`);
    if (r.shareLink) say(`🔗 Seguimiento: ${r.shareLink}`);
    await this.pollTracking(r.trackingNumber, say);

    return {
      content: { trackingNumber: r.trackingNumber, shareLink: r.shareLink, created: true },
      isError: false,
    };
  }

  /** Sondea el estado del envío unas pocas veces y transmite cambios al chat. */
  private async pollTracking(trackingNumber: string, say: (s: string) => void): Promise<void> {
    let last = "";
    for (let i = 0; i < 3; i++) {
      const t = await trackShipment(trackingNumber);
      if (t.ok) {
        if (t.status && t.status !== last) {
          say(`🔎 Estado: ${t.status}`);
          last = t.status;
        }
      } else if (i === 0) {
        say(`(Aún no hay estado disponible: ${t.error})`);
        break;
      }
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
