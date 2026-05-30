# Entregas CDMX con Lalamove — Platanus Build Night CDMX

**Current project logo:** project-logo.png

<img src="./project-logo.png" alt="Project Logo" width="200" />

Hacker:

- José Román Andrade Pérez ([@Hoblayerta](https://github.com/Hoblayerta))

> Mandas **una sola línea de texto** y un agente reúne lo que falta, cotiza con
> **Lalamove** y crea una **entrega real** en la Ciudad de México (moto/auto same-day),
> devolviendo el número de orden y el enlace de seguimiento.

Pensado para que un agente externo (OpenClaw, Cursor, Claude) lo consuma: le das **una
sola línea con un URL** y el agente lee de ahí cómo conducir todo el pedido — sin pegar
prompts.

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
| `API_KEY` | Protege `POST /order` y `GET /agent`. **Defínela antes de exponer.** |

## API HTTP

### `POST /order` — cotiza (sin crear nada)
### `POST /order?confirm=true` — crea la entrega REAL

```
Header: Authorization: Bearer <API_KEY>
Header: Content-Type: application/json
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

### `GET /agent?k=<API_KEY>` — instrucciones para un agente externo

Devuelve, en markdown, las instrucciones completas (endpoint, token y flujo) para que
un agente como OpenClaw las lea y conduzca el pedido por sí mismo. La única línea que le
das al agente es:

```
Lee y sigue https://<tu-host>/agent?k=<API_KEY> y ayúdame con mi entrega
```

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

> Antes de exponer a internet, define `API_KEY`. Sin ella, `POST /order` queda abierto y
> cualquiera podría crear entregas reales con tu saldo de Lalamove.

Have fun! 🚀
