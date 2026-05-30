# Entregas CDMX con Lalamove — Platanus Build Night CDMX

**Current project logo:** project-logo.png

<img src="./project-logo.png" alt="Project Logo" width="200" />

Hacker:

- José Román Andrade Pérez ([@Hoblayerta](https://github.com/Hoblayerta))

> Cualquier **agente** pide una entrega en CDMX y **paga en stablecoin (Tempo) vía MPP**;
> el pago verificado on-chain dispara la **entrega real** con Lalamove (moto/auto same-day),
> devolviendo el Receipt (tx hash) + el tracking.

Pensado para que un agente externo (OpenClaw, Cursor, Claude) lo consuma de forma
autónoma: cotiza gratis y, al confirmar, paga el equivalente en stablecoin a la wallet
del proveedor. El **pago MPP es el candado** — no hace falta API key.

## 🟢 En vivo

```
https://entregas-cdmx-mpp.onrender.com
```

## 💸 Pago con MPP (Machine Payments Protocol)

La confirmación está gateada con **HTTP 402** sobre **Tempo mainnet**:

```
Agente → POST /order                 → costo en MXN (gratis)
Agente → POST /order?confirm=true     → 402 + WWW-Authenticate: Payment (cuánto / a qué wallet)
Agente → paga en stablecoin (Tempo) a la wallet del proveedor
Agente → reintenta con el Credential  → server verifica on-chain → entrega Lalamove + Receipt
```

- El precio se **recalcula en el server** al confirmar (anti-manipulación).
- **Nunca** se crea la entrega Lalamove sin pago verificado.
- Doc detallada del endpoint: [claudedocs/mpp-endpoint.md](claudedocs/mpp-endpoint.md).

### Consumir desde un agente
- **MCP server** (local): `npm run serve:mcp` → tools `cotizar_entrega` (gratis) y
  `confirmar_entrega` (cobra). El pago MPP es automático.
- **HTTP + cliente MPP**: SDK `mppx` o `npx mppx` contra `…/order?confirm=true`.
- **Leer instrucciones**: dale al agente el URL `GET /agent`.

## Cómo funciona

- **Dos formas de usarlo:**
  - **Chat en terminal** (`src/index.ts`) — escribes una línea y el agente LLM te
    pregunta el resto, cotiza y crea la entrega.
  - **Endpoint HTTP** (`src/server.ts`) — un agente externo arma el JSON y llama a
    `POST /order`.
- **Lalamove API v3** (`src/lalamove.ts`):
  - Firma **HMAC-SHA256** en cada request (el secret nunca viaja por la red).
  - Cotiza con `POST /v3/quotations` → `quotationId`, `stopId`s y precio.
  - Crea con `POST /v3/orders` usando ese `quotationId`.
  - Rastrea con `GET /v3/orders/{orderId}`.
- **Geocodificación** (`src/geocode.ts`): Lalamove cotiza con **lat/lng, no con código
  postal**. Convertimos direcciones a coordenadas con Nominatim (gratis, sin llave). Si
  ya mandas coordenadas como `"lat,lng"`, se usan tal cual (más preciso).
- **Candado de confirmación**: sin un `"confirmar"` explícito sobre una cotización
  vigente, no se crea ninguna entrega. El LLM no puede saltárselo.
- **Validación**: direcciones completas, teléfonos de 10 dígitos (se normalizan a +52).

## Setup

```bash
npm install
cp .env.example .env   # completa LLM_API_KEY, LALAMOVE_API_KEY y LALAMOVE_API_SECRET
npm run serve          # levanta el endpoint HTTP (tsx)
# o
npm run dev            # chat conversacional en terminal
# o
npm run build && npm start   # producción
```

Verifica tu cuenta Lalamove (ciudad, servicios y si tienes COD) sin crear nada:

```bash
npx tsx scripts/lalamove-cities.ts
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `LLM_API_KEY` | API key del proveedor LLM (por defecto Anthropic). |
| `LLM_MODEL` | Modelo a usar (default `claude-sonnet-4-6`). |
| `LALAMOVE_API_KEY` / `LALAMOVE_API_SECRET` | Credenciales de tu cuenta Lalamove. |
| `LALAMOVE_MARKET` | Código de país ISO. México = `MX`. |
| `LALAMOVE_BASE_URL` | Base del API (default `https://rest.lalamove.com`). |
| `LALAMOVE_SERVICE_TYPE` | Servicio por defecto (default `MOTORCYCLE`). |
| `LALAMOVE_LANGUAGE` | Idioma de cotización (default `es_MX`). |
| `LALAMOVE_WEIGHT` | Peso para cotizar (default `LESS_THAN_3KG`). |
| `LALAMOVE_SENDER_PHONE` | Teléfono remitente por defecto si no se pregunta. |
| `NOMINATIM_URL` / `GEOCODE_COUNTRY` | Geocodificador (default OpenStreetMap, `mx`). |
| `PORT` | Puerto del server HTTP (default `8787`). |
| `API_KEY` | Opcional. Si se define, protege `POST /order` y `GET /agent`. En el deploy público va **vacío**: el pago MPP es el candado del confirmar. |

## API HTTP

### `POST /order` — cotiza (sin crear nada)
### `POST /order?confirm=true` — crea la entrega REAL (gateado con pago MPP, ver arriba)

```
Header: Content-Type: application/json
# Authorization: Bearer <API_KEY>  ← solo si configuraste API_KEY (el deploy público no la usa)
```
```json
{
  "pickupAddress": "Av. Reforma 222, Juárez, CDMX",
  "pickupContactName": "Tacos El Güero",
  "pickupContactPhone": "5512345678",
  "dropoffAddress": "Calle Madero 10, Centro, CDMX",
  "dropoffContactName": "Juan Pérez",
  "dropoffContactPhone": "5587654321",
  "items": "3 órdenes de tacos al pastor"
}
```
`pickupAddress` / `dropoffAddress` aceptan dirección textual **o** `"lat,lng"`.

Cotización → `{ "ok": true, "stage": "cotizado", "resumen": { "costoEnvio": "42.2 MXN", ... } }`

Creación → `{ "ok": true, "stage": "creado", "trackingNumber": "...", "estado": "ASSIGNING_DRIVER", "shareLink": "https://share.lalamove.com/..." }`

### `GET /agent` — instrucciones para un agente externo

Devuelve, en markdown, las instrucciones completas (endpoint y flujo de pago MPP) para
que un agente como OpenClaw las lea y conduzca el pedido por sí mismo. La única línea que
le das al agente es:

```
Lee y sigue https://entregas-cdmx-mpp.onrender.com/agent y ayúdame con mi entrega
```

(Si configuras `API_KEY`, el endpoint pasa a exigir `GET /agent?k=<API_KEY>`.)

### `GET /health` — estado del servicio

## Scripts de utilidad

| Script | Para qué |
|---|---|
| `scripts/lalamove-cities.ts` | Lista ciudades, servicios y special requests de tu cuenta. |
| `scripts/lalamove-track.ts <orderId>` | Sondea el estado de una orden hasta que termine. |

## Notas de implementación

- **COD**: en Lalamove México **no existe** cobro de la mercancía contra entrega (es un
  *special request* limitado a ciertos mercados; CDMX no lo lista). Las entregas
  funcionan igual; el cobro del producto se maneja por fuera.
- **Geocoder**: Nominatim es suficiente para demo. Para volumen real conviene Google
  Geocoding o pasar coordenadas exactas.
- **Persistencia**: cada orden creada se guarda en `orders.json` (ignorado por git).
- **Legado Envia**: `src/envia.ts` y `scripts/test-*.ts` quedan como referencia
  histórica, pero **ya no se usan** (el motor activo es Lalamove).

## ⚠️ Deploying (Vercel, Render, etc.)

Deploy platforms like **Vercel**, **Render** or **Netlify** can only connect to
repositories **you own** — they can't be granted access to this organization repo.
To deploy while keeping your commits here, mirror your code to a personal repo:

1. Create a **personal** repository on your own GitHub account.
2. Point your local `origin` at **both** repos, so a single `git push` updates each one:

   ```bash
   # this org repo (keep it as a push target)...
   git remote set-url --add --push origin https://github.com/platanus-build-night/platanus-build-night-26-mx-Hoblayerta.git
   # ...and your personal repo
   git remote set-url --add --push origin https://github.com/<your-user>/<your-repo>.git
   ```

   From now on `git push` sends every commit to **both** repositories.
3. Connect your deploy service (Vercel, Render, …) to your **personal** repo and deploy from there.

> El deploy público va **sin `API_KEY`** a propósito: cualquiera puede cotizar (gratis) y
> el **pago MPP** es el candado para confirmar (no se crea entrega sin pago verificado a tu
> wallet). Si prefieres acceso cerrado, define `API_KEY` y el endpoint exigirá el Bearer.

Have fun! 🚀
