# Integración Lalamove — Resumen de sesión

Migración del agente de entregas CDMX de **Envia.com → Lalamove API v3**.
El agente recibe una línea de texto, hace las preguntas necesarias y crea una
entrega real (courier same-day en moto/auto) con Lalamove.

## Qué cambió

### Archivos nuevos
| Archivo | Propósito |
|---|---|
| `src/lalamove.ts` | Cliente Lalamove v3: firma HMAC + cotizar + crear orden + rastrear. |
| `src/geocode.ts` | Dirección → lat/lng vía Nominatim (OpenStreetMap, gratis, sin llave). |
| `scripts/lalamove-cities.ts` | Sonda para confirmar ciudad, `serviceType` y soporte de COD. |

### Archivos reescritos
| Archivo | Cambio |
|---|---|
| `src/validation.ts` | `FIELDS` ahora: recogida (dirección+contacto+tel), entrega (dirección+contacto+tel), items. Nuevo tipo `address`. 7 campos (antes 14). |
| `src/agent.ts` | Abre preguntando **"¿enviar o recibir?"**; usa Lalamove; guarda `quotationId` + `stops`. |
| `src/flow.ts` | Endpoint stateless usa Lalamove. |
| `src/types.ts` | Campos del modelo Lalamove añadidos (se conservan los de Envia para compatibilidad). |
| `.env.example` | Llaves de Lalamove + geocoder. |

> `src/envia.ts` y `scripts/test-*.ts` quedaron intactos pero ya **no se usan**.

## Detalles técnicos clave

### Autenticación HMAC (en cada request)
```
raw       = `${timestamp}\r\n${METHOD}\r\n${path}\r\n\r\n${body}`   # body="" en GET
signature = HMAC_SHA256(raw, SECRET) en hex minúscula
headers:
  Authorization: hmac <API_KEY>:<timestamp>:<signature>
  Market:        MX
  Request-ID:    <uuid>
```
El body firmado y el enviado deben ser **byte-idénticos** (se serializa una sola vez).

### Endpoints usados (base prod: `https://rest.lalamove.com`)
- `POST /v3/quotations` → `quotationId`, `stops[].stopId`, `priceBreakdown.total`
- `POST /v3/orders` → usa `quotationId` + `stopId`s; `sender` = stops[0], `recipients` = [stops[1]]
- `GET /v3/orders/{orderId}` → `status`, `shareLink`
- `GET /v3/cities` → catálogo (sonda de verificación)

### Geocodificación
Lalamove cotiza con **lat/lng, no con código postal** → cada dirección se geocodifica
con Nominatim antes de cotizar. Requiere `User-Agent`; rate limit ~1 req/s.

## El endpoint para OpenClaw / Cursor / Claude

El agente externo arma el JSON y llama:
```
POST /order              → cotiza
POST /order?confirm=true → crea la entrega REAL
Header: Authorization: Bearer <API_KEY>
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

## Variables de entorno nuevas
```
LALAMOVE_API_KEY        # pk_prod_...
LALAMOVE_API_SECRET     # sk_prod_...  (solo se usa para firmar, nunca se envía)
LALAMOVE_MARKET=MX
LALAMOVE_BASE_URL=https://rest.lalamove.com
LALAMOVE_SERVICE_TYPE=MOTORCYCLE
LALAMOVE_LANGUAGE=es_MX
LALAMOVE_WEIGHT=LESS_THAN_3KG
LALAMOVE_SENDER_PHONE=...
NOMINATIM_URL=https://nominatim.openstreetmap.org/search
GEOCODE_COUNTRY=mx
```

## Estado y pendientes
- ✅ Código compila (`npm run typecheck` limpio).
- ⏳ **Sin probar contra la API real** — falta poner `LALAMOVE_API_KEY/SECRET` en `.env`.
- ⏳ Verificar con `npx tsx scripts/lalamove-cities.ts`:
  - El `serviceType` real disponible en MX (asumido `MOTORCYCLE`).
  - Si `MARKET=MX` es correcto (algunas cuentas usan locode `MX MEX`).
  - Si **COD** existe en MX (en Lalamove es un *special request*, no cobra la mercancía
    como Envia; por eso quedó opcional).

## Riesgos conocidos
1. **COD**: Lalamove no cobra el precio del producto al recibir como Envia. Su COD es
   limitado por mercado; las entregas funcionan sin él.
2. **Precisión del geocoder**: Nominatim es suficiente para demo; para volumen real
   conviene Google Geocoding.
3. **`MARKET`**: si la API lo rechaza, ajustar al locode que devuelva `/v3/cities`.
