import { loadEnv } from "./env";
loadEnv();

import * as readline from "readline";
import { DeliveryAgent } from "./agent";

function main(): void {
  const agent = new DeliveryAgent();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const say = (s: string) => console.log(`\n🤖 ${s}\n`);

  console.log("🛵 Agente de entregas CDMX (Envia.com + cobro contra entrega).");
  console.log('   Escribe tu pedido en una sola línea. Escribe "salir" para terminar.\n');

  const ask = (): void => {
    rl.question("🧑 ", async (line) => {
      const text = line.trim();
      if (!text) return ask();
      if (["salir", "exit", "quit"].includes(text.toLowerCase())) {
        rl.close();
        return;
      }
      try {
        await agent.handle(text, say);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        say(`Ocurrió un error: ${msg}`);
      }
      ask();
    });
  };

  ask();
}

main();
