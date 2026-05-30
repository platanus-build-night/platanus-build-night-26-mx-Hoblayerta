# Endpoint de pago MPP — Entregas CDMX (Lalamove)

Servicio que cobra en **stablecoin (Tempo, vía Machine Payments Protocol)** antes de
crear una entrega real con Lalamove. Cualquier agente puede consumirlo: cotiza gratis y,
para confirmar, paga el equivalente en stablecoin a la wallet del proveedor.

## Endpoint en vivo

```
https://entregas-cdmx-mpp.onrender.com
```

| Ruta | Qué hace |
|---|---|
| `GET /health` | Estado del servicio. |
| `POST /order` | **Cotiza** (gratis). Devuelve costo en MXN. |
| `POST /order?confirm=true` | **Crea la entrega real**. Gateado con pago MPP (HTTP 402). |
| `GET /agent` | Instrucciones autoejecutables para un agente externo. |

> No requiere API key: el **pago MPP es el candado** del confirmar. Cotizar es abierto.

## Flujo de pago (HTTP 402 / MPP)

```
Agente → POST /order                  → costo (ej. 98.61 MXN)
Agente → POST /order?confirm=true      → 402 Payment Required
Server                                   WWW-Authenticate: Payment id=…, method="tempo",
                                         intent="charge", request=<base64>, expires=…
Agente → paga en Tempo (stablecoin) a la wallet del proveedor
Agente → POST /order?confirm=true      → con el Credential en Authorization
Server → verifica on-chain → crea entrega Lalamove → 200 + Payment-Receipt + tracking
```

El precio se **recalcula en el server** al confirmar (el cliente no puede pagar de menos).
Nunca se crea la entrega Lalamove sin pago verificado.

### Body JSON
```json
{
  "pickupAddress": "Av. Reforma 222, Juárez, CDMX",
  "pickupContactName": "Tacos El Güero",
  "pickupContactPhone": "5512345678",
  "dropoffAddress": "Av. Insurgentes Sur 1000, Del Valle, CDMX",
  "dropoffContactName": "Juan Pérez",
  "dropoffContactPhone": "5587654321",
  "items": "3 tacos al pastor"
}
```
Las direcciones aceptan texto **o** `"lat,lng"`.

## Configuración del cobro (server, por env)

| Variable | Valor actual | Nota |
|---|---|---|
| `MPP_RECIPIENT_ADDRESS` | `0x0a01A6423D6bF683F53BFd8C18bF8375E1aA50BC` | wallet que recibe el pago |
| `MPP_CURRENCY_ADDRESS` | `0x20c0…0000` (**pathUSD**) | cambiar a USDC si se obtiene su dirección TIP-20 en Tempo |
| `MPP_CURRENCY_DECIMALS` | `6` | TIP-20 |
| `MPP_TESTNET` | `false` | **Tempo mainnet** (chainId 4217, dinero real) |
| `USDC_PER_MXN` | `0.055` | tipo de cambio MXN→stablecoin |
| `MPP_SECRET_KEY` | (secreto) | firma HMAC de los challenges |

## Consumir desde un agente

**Opción A — MCP server (local).** Registra el server MCP; el agente obtiene las tools
`cotizar_entrega` y `confirmar_entrega` y el pago MPP es automático:
```bash
npm run serve:mcp     # stdio MCP server
```

**Opción B — HTTP con cliente MPP.** Usa el SDK `mppx` (fetch que paga el 402 solo) o el
CLI `npx mppx`, apuntando a `https://entregas-cdmx-mpp.onrender.com/order?confirm=true`.

**Opción C — leer instrucciones.** Dale al agente una línea con el URL `GET /agent` y
seguirá el flujo (cotizar → 402 → pagar → confirmar) por sí mismo.

## Limitaciones honestas

- **Token**: se cobra en **pathUSD** (stablecoin documentado de Tempo). El USDC canónico
  en Tempo mainnet no está publicado; en cuanto se tenga la dirección, es cambiar una env.
- **Red**: MPP/`mppx` solo soporta **Tempo** (y Stripe para tarjeta). **No soporta Base.**
- **Liquidez**: solo agentes con saldo en Tempo mainnet pueden pagar (cadena nueva).
- **Sin probar end-to-end con pago real**: el gate 402 está verificado; la verificación
  on-chain del pago no se ejecutó con fondos reales.
- **Idempotencia**: si el pago se verifica pero Lalamove falla al crear, el cliente ya
  pagó. Pendiente: reembolso o reintento idempotente (se guarda el tracking para reconciliar).
