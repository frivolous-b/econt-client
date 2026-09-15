/**
 * Waybills (labels) and shipment tracking.
 */
import { postEcont, type EcontConfig } from './client.js';
import { checkAddressCompleteness, describeMissingBg } from './address.js';

export interface CreateLabelParams {
  senderName: string;
  senderPhone: string;
  senderCity: string;
  senderPostCode: string;
  senderStreet: string;
  senderNum: string;
  receiverName: string;
  receiverPhone: string;
  receiverCity: string;
  receiverPostCode: string;
  /** Block/entrance/floor/flat, joined. Optional — a house has none. */
  receiverOther?: string;
  receiverStreet: string;
  receiverNum: string;
  /** Kilograms. */
  weight: number;
  shipmentDescription: string;
  declaredValue: number;
  /** Cash-on-delivery amount. Defaults to declaredValue when isCod. */
  codAmount?: number;
  isCod: boolean;
  /** Currency for COD. Defaults to 'EUR' (post-2026 BGN→EUR changeover). */
  codCurrency?: string;
}

type EcontLabelResponse = {
  label?: {
    shipmentNumber?: string;
    pdfURL?: string;
  };
};

type LabelClient = { name: string; phones: string[] };

type LabelAddress = {
  /**
   * `postCode` IS NOT OPTIONAL DECORATION. Econt's openapi.yaml, literally:
   * "Required fields for valid city - ID or name + post code." An address type
   * that carries `{ name }` alone drops the postcode one boundary before the
   * label — and under ЗПУ art. 87 item 6 an incomplete address voids the
   * carrier's liability on the consignment (see address.ts).
   */
  city: { name: string; postCode: string };
  street: string;
  num: string;
  /**
   * Econt `other` — "Block number, entrance number, floor, apartment number
   * and other additional information" (API docs, literally). This is where an
   * apartment customer's entrance and floor belong on the waybill.
   */
  other?: string;
};

function buildClient(name: string, phone: string): LabelClient {
  return { name, phones: [phone] };
}

function buildAddress(
  city: string,
  postCode: string,
  street: string,
  num: string,
  other?: string,
): LabelAddress {
  const address: LabelAddress = { city: { name: city, postCode }, street, num };
  // Omitted rather than sent empty: `other` is free text on the waybill, and a
  // blank line is noise on a printed label.
  if (other && other.trim()) address.other = other.trim();
  return address;
}

/**
 * Create a waybill (label) for a door-address shipment.
 *
 * THE PRODUCER REFUSES, NOT ONLY THE CALLER. TypeScript types are erased at
 * runtime: an untyped caller (a .mjs script, a JS consumer) can omit
 * `senderPostCode` and `JSON.stringify` silently drops the `undefined` — the
 * request body is then byte-identical to one that never had a postcode, with
 * no error anywhere. A guard that lives only in callers protects only the
 * callers someone remembered; the function that BUILDS the waybill is where
 * the refusal belongs, so no future caller and no untyped path can emit an
 * incomplete address (which would void carrier liability — see address.ts).
 */
export async function createLabel(
  config: EcontConfig,
  params: CreateLabelParams,
): Promise<{
  success: boolean;
  trackingNumber?: string;
  labelUrl?: string;
  error?: string;
}> {
  for (const side of ['sender', 'receiver'] as const) {
    const check = checkAddressCompleteness(
      {
        city: side === 'sender' ? params.senderCity : params.receiverCity,
        postCode: side === 'sender' ? params.senderPostCode : params.receiverPostCode,
        street: side === 'sender' ? params.senderStreet : params.receiverStreet,
        streetNum: side === 'sender' ? params.senderNum : params.receiverNum,
        recipient: side === 'sender' ? params.senderName : params.receiverName,
        phone: side === 'sender' ? params.senderPhone : params.receiverPhone,
      },
      { requireContact: true },
    );
    if (!check.ok) {
      return {
        success: false,
        error:
          `${side === 'sender' ? 'Sender' : 'Receiver'} address is incomplete — ` +
          `missing: ${describeMissingBg(check.missing)}. A waybill with an ` +
          'incomplete address voids carrier liability (ЗПУ art. 87 item 6), so it is not created.',
      };
    }
  }

  const codAmount = params.codAmount ?? params.declaredValue;
  const services = params.isCod
    ? {
        cdAmount: codAmount,
        cdCurrency: params.codCurrency ?? 'EUR',
        cdType: 'get',
      }
    : undefined;

  const body = {
    mode: 'create',
    label: {
      senderClient: buildClient(params.senderName, params.senderPhone),
      senderAddress: buildAddress(
        params.senderCity,
        params.senderPostCode,
        params.senderStreet,
        params.senderNum,
      ),
      receiverClient: buildClient(params.receiverName, params.receiverPhone),
      receiverAddress: buildAddress(
        params.receiverCity,
        params.receiverPostCode,
        params.receiverStreet,
        params.receiverNum,
        params.receiverOther,
      ),
      shipmentType: 'PACK',
      weight: params.weight,
      shipmentDescription: params.shipmentDescription,
      packCount: 1,
      ...(services ? { services } : {}),
    },
  };

  const res = await postEcont<EcontLabelResponse>(
    config,
    '/Shipments/LabelService.createLabel.json',
    body,
  );
  if (!res.ok) return { success: false, error: res.error };

  const trackingNumber = res.data?.label?.shipmentNumber;
  if (!trackingNumber) {
    return { success: false, error: 'Econt did not return shipmentNumber' };
  }

  return {
    success: true,
    trackingNumber,
    /**
     * ⚠️ ECONT RETURNS THIS OVER **http://**, not https, and the URL carries a
     * `_key=` token. Never embed it raw in an https page (mixed content blocks
     * it at exactly the moment someone needs to print, and the token lands in
     * page source) — proxy it through an authenticated route instead.
     */
    labelUrl: res.data?.label?.pdfURL ?? undefined,
  };
}

/**
 * ⚠️ THE TRACKING SHAPE BELOW IS MEASURED, NOT GUESSED — verified against a
 * real sandbox shipment. `shipmentStatuses[0]` carries exactly `{ status,
 * error }`; the events live on `status.trackingEvents`, not at the top level.
 * A parser reading fields that don't exist returns a successful-looking empty
 * result — the fail-silent shape this module refuses everywhere.
 */
type TrackingEvent = {
  isReceipt?: boolean;
  destinationType?: string;
  /** The human-readable step, e.g. „Очаква предаване към Еконт". */
  destinationDetails?: string;
  destinationDetailsEn?: string;
  officeName?: string | null;
  cityName?: string | null;
  time?: number | string | null;
};

type TrackResponse = {
  shipmentStatuses?: Array<{
    status?: {
      shipmentNumber?: string;
      /** Econt's own one-line summary. BG and EN are separate fields. */
      shortDeliveryStatus?: string;
      shortDeliveryStatusEn?: string;
      /** Epoch millis. */
      expectedDeliveryDate?: number | null;
      totalPrice?: number | null;
      currency?: string | null;
      /** ⚠️ http://, not https — see the note at the createLabel return. */
      pdfURL?: string | null;
      trackingEvents?: TrackingEvent[];
    };
    error?: { message?: string } | null;
  }>;
};

export type TrackingResult = {
  success: boolean;
  status?: string;
  expectedDeliveryDate?: string;
  totalPrice?: number;
  currency?: string;
  /** ⚠️ http:// — proxy it, never embed. */
  labelUrl?: string;
  events?: Array<{ date: string; description: string }>;
  error?: string;
};

export async function trackShipment(
  config: EcontConfig,
  trackingNumber: string,
  locale: 'bg' | 'en' = 'bg',
): Promise<TrackingResult> {
  const res = await postEcont<TrackResponse>(
    config,
    '/Shipments/ShipmentService.getShipmentStatuses.json',
    { shipmentNumbers: [trackingNumber], includeEvents: true },
  );
  if (!res.ok) return { success: false, error: res.error };

  const first = res.data.shipmentStatuses?.[0];
  if (!first) return { success: false, error: 'Econt returned no shipment status' };

  // Econt reports a per-shipment error INSIDE a 200 response — an unknown
  // tracking number is not an HTTP failure. Turning that into `success: true`
  // with empty fields would be the worst of both.
  if (first.error?.message) return { success: false, error: first.error.message };

  const st = first.status;
  if (!st) return { success: false, error: 'Econt returned no status object' };

  const status =
    locale === 'en'
      ? st.shortDeliveryStatusEn || st.shortDeliveryStatus
      : st.shortDeliveryStatus || st.shortDeliveryStatusEn;

  const toIso = (v: number | string | null | undefined): string => {
    if (v == null || v === '') return '';
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : String(v);
  };

  const events = (st.trackingEvents ?? []).map((ev) => ({
    date: toIso(ev.time),
    description:
      (locale === 'en'
        ? ev.destinationDetailsEn || ev.destinationDetails
        : ev.destinationDetails || ev.destinationDetailsEn) ?? '',
  }));

  return {
    success: true,
    status: status ?? undefined,
    expectedDeliveryDate: toIso(st.expectedDeliveryDate) || undefined,
    totalPrice: st.totalPrice ?? undefined,
    currency: st.currency ?? undefined,
    labelUrl: st.pdfURL ?? undefined,
    events,
  };
}
