/** Estado acumulado de un pedido durante la conversación. */
export interface Order {
  // ── Modelo Lalamove (activo) ──
  // Recogida / origen
  pickupAddress?: string;
  pickupContactName?: string;
  pickupContactPhone?: string;
  // Entrega / destino
  dropoffAddress?: string;
  dropoffContactName?: string;
  dropoffContactPhone?: string;
  // Artículos
  items?: string;
  // Cobro contra entrega (opcional; solo si la ciudad lo soporta)
  codAmount?: number;

  // ── Campos heredados del modelo Envia (los usan envia.ts y los scripts) ──
  pickupName?: string;
  pickupStreet?: string;
  pickupNumber?: string;
  pickupDistrict?: string;
  pickupPostalCode?: string;
  declaredValue?: number;
  destStreet?: string;
  destNumber?: string;
  destDistrict?: string;
  destPostalCode?: string;
  recipientName?: string;
  recipientPhone?: string;
}

export interface QuoteResult {
  carrier: string;
  service: string;
  serviceDescription: string;
  price: number;
  currency: string;
  raw: unknown;
}

export type OrderStatus = "collecting" | "quoted" | "created";
