/**
 * Is the settlement the customer typed one that ECONT ACTUALLY SERVES?
 *
 * This is a DATA-QUALITY control, not an anti-bot control. It catches typos
 * and garbage — "asdf", a village spelled wrong — which cost a shop real money
 * in failed deliveries and return shipping.
 *
 * ── WHAT IT ASSERTS, AND WHY THE WORDING MATTERS ────────────────────────────
 * Econt's `getCities` lists settlements Econt PUBLISHES — not the settlements
 * that EXIST. Bulgaria has several thousand. A customer in a small village
 * Econt does not list is a real person at a real address, and telling them
 * "invalid address" would be false as well as insulting. Every message about
 * a failure here should say the COURIER does not serve that settlement.
 *
 * Measured caveat: Econt's label API has been observed to PRICE deliveries to
 * settlements absent from `getCities` (e.g. Брацигово/4579), while refusing a
 * garbage settlement name with HTTP 517 on the identical call. The published
 * list is a SUBSET of where the carrier actually goes — treat "unknown
 * settlement" as a warning to surface, not an unconditional hard stop.
 *
 * ── THE ZONE DIGIT ──────────────────────────────────────────────────────────
 * Bulgarian postcodes are structured: first digit = zone, second = area, last
 * two = locality. A settlement sits in exactly one zone by construction, so
 * every valid postcode for it shares the first digit with its head postcode.
 * This is a zone check, NOT a postcode-exists check — "Пловдив / 9000" is
 * caught, "Пловдив / 4999" is not.
 */

export type Settlement = {
  /** Bulgarian name, as Econt spells it. */
  name: string;
  /** Latin name, so "Sofia" typed by a foreign customer still resolves. */
  nameEn: string | null;
  /** The settlement's head postcode. Its first digit is the zone. */
  postCode: string;
  /** Region — used only to disambiguate duplicate names ("Изгрев" names five). */
  region: string | null;
};

export type ServiceAreaResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_settlement' }
  | { ok: false; reason: 'zone_mismatch'; expectedZone: string };

/**
 * NORMALISATION IS WHERE THIS BREAKS IF IT BREAKS. Every rule below exists
 * because a real person types it that way:
 *
 *   „гр. София" / „гр.София" / „град София"  — the settlement-type prefix
 *   „с. Кокаляне" / „село Кокаляне"          — the same for villages
 *   „СОФИЯ" / „sofia"                        — casing, either alphabet
 *   „ Пловдив  "                             — paste whitespace
 *   „Велико  Търново"                        — a doubled inner space
 *
 * ⚠️ EVERY PREFIX ALTERNATIVE REQUIRES A DOT OR TRAILING WHITESPACE. A naive
 * alternation with a bare `с` matches the FIRST LETTER of every name starting
 * with „С": „София" becomes „офия". And it passes a naive test, because both
 * sides of the comparison run through the same function and are mangled
 * identically — the corruption is symmetric and therefore invisible until a
 * prefixed spelling breaks the symmetry. Hence: „гр." and „с." need the dot,
 * „град" and „село" need whitespace, so „Своге" and „Градец" are left alone.
 */
export function normalizeSettlementName(raw: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:гр\.|с\.|град\s|село\s)\s*/u, '')
    // Latin equivalents, same rule: a dot is required, so „Sofia" is safe.
    .replace(/^(?:gr\.|s\.|grad\s|selo\s)\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The zone is the first digit. Anything not 4 digits has no zone. */
export function postcodeZone(postCode: string): string | null {
  const t = (postCode ?? '').trim();
  return /^[1-9]\d{3}$/.test(t) ? (t[0] ?? null) : null;
}

/**
 * @param settlements a cached snapshot from `fetchSettlements()`. Passed in
 *   rather than fetched, so this stays pure and testable without a network.
 */
export function checkServiceArea(input: {
  city: string;
  postCode: string;
  settlements: readonly Settlement[];
}): ServiceAreaResult {
  const wanted = normalizeSettlementName(input.city);
  if (!wanted) return { ok: false, reason: 'unknown_settlement' };

  // Dozens of names are shared by more than one settlement („Изгрев" by five).
  // Any match is enough: the question is whether SOME served settlement of
  // that name sits in the customer's zone, not which one it is.
  const matches = input.settlements.filter(
    (s) =>
      normalizeSettlementName(s.name) === wanted ||
      (s.nameEn ? normalizeSettlementName(s.nameEn) === wanted : false),
  );
  if (matches.length === 0) return { ok: false, reason: 'unknown_settlement' };

  const zone = postcodeZone(input.postCode);
  // A malformed postcode is not this check's business — isValidBgPostcode
  // already refused it with its own message. Saying it twice, differently, is
  // worse than saying it once.
  if (!zone) return { ok: true };

  if (matches.some((s) => postcodeZone(s.postCode) === zone)) return { ok: true };

  return {
    ok: false,
    reason: 'zone_mismatch',
    expectedZone: postcodeZone(matches[0]?.postCode ?? '') ?? '',
  };
}

/**
 * Suggested user-facing copy (Bulgarian). NEVER „невалиден адрес" — this
 * reports a fact about the courier's coverage, which is verifiable, not a
 * judgement about the customer's address, which is not.
 */
export const SERVICE_AREA_ERROR_BG = {
  unknown_settlement:
    'Еконт не обслужва това населено място. Проверете изписването или изберете друг куриер.',
  zone_mismatch:
    'Пощенският код не съответства на населеното място. Проверете двете полета.',
} as const;
