import { Mppx, tempo } from "mppx/server";
import type * as Transport from "mppx/server";
import { requireEnv } from "./env";

/**
 * Gate de pago MPP (Machine Payments Protocol) sobre Tempo.
 *
 * El cliente (un agente) cotiza gratis; para CONFIRMAR la entrega el server
 * exige un pago en stablecoin (Tempo) equivalente al costo, que cae a TU wallet.
 * Solo cuando el pago se verifica on-chain se crea la entrega real en Lalamove.
 *
 * Todo es configurable por env para cambiar de red/token sin tocar código:
 *  - MPP_RECIPIENT_ADDRESS  → tu wallet EVM que RECIBE el pago.
 *  - MPP_CURRENCY_ADDRESS   → token TIP-20 (pathUSD 0x20c0… o USDC si lo tienes).
 *  - MPP_CURRENCY_DECIMALS  → decimales del token (TIP-20 = 6).
 *  - MPP_TESTNET            → "true" usa Moderato (prueba); cualquier otra cosa = mainnet.
 *  - MPP_SECRET_KEY         → secreto del server para firmar challenges (HMAC).
 *  - USDC_PER_MXN           → tipo de cambio MXN→stablecoin para fijar el monto.
 *
 * Las env se leen de forma perezosa (dentro de las funciones), así importar este
 * módulo no exige tener MPP configurado: el server puede cotizar sin pago.
 */

function cfg() {
  return {
    recipient: requireEnv("MPP_RECIPIENT_ADDRESS") as `0x${string}`,
    currency: requireEnv("MPP_CURRENCY_ADDRESS"),
    decimals: Number(process.env.MPP_CURRENCY_DECIMALS || "6"),
    testnet: process.env.MPP_TESTNET === "true",
    secretKey: requireEnv("MPP_SECRET_KEY"),
    fx: Number(process.env.USDC_PER_MXN || "0.055"),
  };
}

/** Crea una instancia de Mppx con el método Tempo charge para el transporte dado. */
export function createMppx<T extends Transport.Transport.AnyTransport>(transport?: T) {
  const { testnet, secretKey } = cfg();
  return Mppx.create({
    methods: [tempo.charge({ testnet })],
    secretKey,
    ...(transport ? { transport } : {}),
  });
}

/** Convierte el precio MXN (de Lalamove) a monto de stablecoin, 6 decimales, hacia arriba. */
export function mxnToStable(priceMXN: number): string {
  const amount = priceMXN * cfg().fx;
  return (Math.ceil(amount * 1e6) / 1e6).toFixed(6);
}

/** Opciones de cobro para una entrega: monto + token + destino. */
export function chargeOptions(priceMXN: number, description: string) {
  const { currency, decimals, recipient } = cfg();
  // El description viaja en el header WWW-Authenticate, que debe ser ASCII (latin1).
  // Quitamos acentos y cualquier carácter fuera de ASCII imprimible.
  const safe = description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 120);
  return { amount: mxnToStable(priceMXN), currency, decimals, recipient, description: safe };
}

/** Datos públicos del cobro (para mostrar/anunciar; no incluye secretos). */
export function paymentInfo() {
  const { recipient, currency, decimals, testnet, fx } = cfg();
  return {
    recipient,
    currency,
    decimals,
    network: testnet ? "Tempo Moderato (testnet)" : "Tempo mainnet",
    fxMxnToStable: fx,
  };
}
