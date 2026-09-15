/**
 * Address completeness — a legal check, not a UX nicety.
 *
 * ============================================================================
 * WHY THIS EXISTS: the Bulgarian Postal Services Act (ЗПУ), art. 87 item 6
 * ============================================================================
 *
 * The Act excuses the carrier ENTIRELY where the address on the waybill was
 * incomplete. So an address missing a postcode does not merely risk a
 * misrouted parcel — it voids the carrier's liability on the consignment, and
 * it does so silently, on the one document a claim would rest on. For a shop
 * shipping high-value goods a single parcel can be worth a lot, and the
 * failure is invisible until a claim is refused.
 *
 * That is the difference between this and ordinary validation: a WRONG
 * postcode costs a delivery attempt; a MISSING one costs the insurance.
 *
 * ============================================================================
 * THE RULE, from Econt's own API contract (openapi.yaml, quoted literally)
 * ============================================================================
 *   · "Required fields for valid city - ID or name + post code."
 *   · "Required fields for valid address - city, street and street number
 *      (or quarter and other)"
 *   · ...or a valid Econt OFFICE CODE (office delivery), which replaces the
 *     street address entirely.
 *
 * Measured tension, and this module follows the STATED rule, not the observed
 * one: Econt's Demo environment accepts `city: { name }` with no post code on
 * every sandbox shipment. Demo is looser than the prose; production is the one
 * that matters. Building to demo's tolerance means discovering the difference
 * on a real consignment — exactly the trade this module refuses.
 *
 * Note what a complete address is NOT: correct. This separates "асдф" from
 * "4000"; nothing here separates "4000" from "4001" — only Econt's settlement
 * data can (see serviceArea.ts). This module answers "would art. 87 item 6
 * excuse the carrier for INCOMPLETENESS", never "will this parcel arrive".
 */

/** A well-formed Bulgarian postcode: exactly four digits, not starting with 0. */
export function isValidBgPostcode(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^[1-9]\d{3}$/.test(v.trim());
}

/** Named so a caller can tell the user WHICH field to fix, in their language. */
export type AddressField =
  | 'city'
  | 'postCode'
  | 'street'
  | 'streetNum'
  | 'recipient'
  | 'phone';

export type AddressCompleteness =
  | { ok: true }
  | { ok: false; missing: AddressField[] };

export type AddressInput = {
  city?: string | null;
  postCode?: string | null;
  street?: string | null;
  streetNum?: string | null;
  /** Econt `quarter` — an alternative to street, per the contract. */
  quarter?: string | null;
  /** Econt `other` — block/entrance/floor/flat. Pairs with `quarter`. */
  other?: string | null;
  /**
   * Econt office / Еконтомат code. When present this is OFFICE DELIVERY and no
   * street address is required at all — the parcel is addressed to the office.
   */
  officeCode?: string | null;
  /** Only checked with `requireContact` — a waybill needs a person, not just a place. */
  recipient?: string | null;
  phone?: string | null;
};

const has = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Is this address complete enough that ЗПУ art. 87 item 6 would NOT excuse the
 * carrier for incompleteness?
 *
 * @param requireContact also demand a recipient name and phone — true for a
 *   waybill (a parcel needs someone to hand it to), false when validating just
 *   the geographic part, as a checkout form does before it knows the name.
 */
export function checkAddressCompleteness(
  input: AddressInput,
  { requireContact = false }: { requireContact?: boolean } = {},
): AddressCompleteness {
  const missing: AddressField[] = [];

  if (requireContact) {
    if (!has(input.recipient)) missing.push('recipient');
    if (!has(input.phone)) missing.push('phone');
  }

  // OFFICE DELIVERY short-circuits the street requirement — and ONLY that one.
  // The office code identifies the destination completely.
  if (has(input.officeCode)) {
    return missing.length > 0 ? { ok: false, missing } : { ok: true };
  }

  if (!has(input.city)) missing.push('city');

  // PRESENT AND WELL-FORMED, not merely present. "асдф" in this field is the
  // same incompleteness as an empty one as far as the carrier is concerned —
  // an address they cannot route is not made routable by having characters in it.
  if (!isValidBgPostcode(input.postCode)) missing.push('postCode');

  // street+num OR quarter+other. Either satisfies the contract; neither does not.
  const hasStreetPair = has(input.street) && has(input.streetNum);
  const hasQuarterPair = has(input.quarter) && has(input.other);
  if (!hasStreetPair && !hasQuarterPair) {
    if (!has(input.street)) missing.push('street');
    if (!has(input.streetNum)) missing.push('streetNum');
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

/** Bulgarian field names, for a message that tells the user what to fix. */
export const ADDRESS_FIELD_BG: Record<AddressField, string> = {
  city: 'населено място',
  postCode: 'пощенски код',
  street: 'улица',
  streetNum: 'номер на улицата',
  recipient: 'име на получателя',
  phone: 'телефон',
};

export function describeMissingBg(missing: readonly AddressField[]): string {
  return missing.map((f) => ADDRESS_FIELD_BG[f]).join(', ');
}
