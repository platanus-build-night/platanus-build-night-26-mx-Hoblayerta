import { requireEnv } from "./env";

// ── Tipos neutrales (independientes del proveedor) ──
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Msg {
  role: "user" | "assistant";
  content: Block[];
}

export interface ChatRequest {
  system: string;
  messages: Msg[];
  tools: ToolDef[];
}
export interface ChatResult {
  text: string;
  toolUses: ToolUseBlock[];
}

/**
 * Único punto de entrada modelo-agnóstico. El resto de la app NO conoce al
 * proveedor: para cambiar de LLM, solo se toca esta función.
 * Proveedor por defecto: Anthropic (Messages API).
 */
export async function chat(req: ChatRequest): Promise<ChatResult> {
  return anthropicChat(req);
}

const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

async function anthropicChat(req: ChatRequest): Promise<ChatResult> {
  const apiKey = requireEnv("LLM_API_KEY");
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: req.system,
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    })),
    messages: req.messages.map(mapMsg),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error del LLM (${res.status}): ${txt}`);
  }

  const json = (await res.json()) as {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
  };

  let text = "";
  const toolUses: ToolUseBlock[] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolUses.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      });
    }
  }
  return { text, toolUses };
}

/** Mapea un mensaje neutral al formato de bloques de Anthropic. */
function mapMsg(m: Msg): { role: "user" | "assistant"; content: unknown[] } {
  return {
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") {
        return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      }
      return {
        type: "tool_result",
        tool_use_id: b.toolUseId,
        content: b.content,
        is_error: b.isError ?? false,
      };
    }),
  };
}
