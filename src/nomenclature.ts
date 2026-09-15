/**
 * Econt nomenclature: settlements (cities/villages) and offices/lockers.
 *
 * ── AUTH: NONE. Measured, not assumed ───────────────────────────────────────
 * Production host `ee.econt.com/services`, no `Authorization` header:
 * `getCities` returns ~1100 rows, `getOffices` ~630. Every nomenclature Econt
 * publishes is open — an office/settlement picker can be built while holding
 * no Econt credential of any kind.
 *
 * ── `receiverOfficeCode` TAKES `code`, NOT `id` — AND THE DOCS SAY OTHERWISE ─
 * Econt's developer docs state the label API takes "the id". It is wrong.
 * Settled by probe against one live office (id=970, code="4044", Пловдив):
 * two identical `mode:'calculate'` calls differing in one field:
 *
 *     receiverOfficeCode: "4044"  (the code) → HTTP 200, priced
 *     receiverOfficeCode: "970"   (the id)   → HTTP 517, ExInvalidParam
 *
 * The failure is not loud: both are short numeric-looking strings off the
 * same object, so a column populated from whichever field a reader happened
 * to pick works for some rows and 517s for others — at label time, after
 * payment. So `extCode` is `office.code`; the `id` is kept only for joins.
 *
 * ── THE FAIL-SILENT SHAPE THIS MODULE REFUSES ───────────────────────────────
 * Some carriers refuse an unauthenticated read with HTTP 200 and the error in
 * the body. A client that checks `res.ok`, parses, and finds no rows would
 * conclude "the carrier serves nowhere" — and an office picker then syncs to
 * EMPTY, silently. Hence `NomenclatureFetch<T>`'s success arm carries
 * `[T, ...T[]]`, a non-empty tuple: "ok, and here are no rows" cannot be
 * constructed, so it cannot be returned, so it cannot be forgotten.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fetch contract
// ─────────────────────────────────────────────────────────────────────────────

/** A list that cannot be empty. The whole point of this module. */
export type NonEmpty<T> = [T, ...T[]];

export type NomenclatureFailure =
  /** DNS, TLS, timeout — we never reached them. */
  | 'transport'
  /** A non-2xx status. */
  | 'http'
  /** 2xx that did not parse as JSON. */
  | 'not_json'
  /** 2xx whose BODY is a refusal (some carriers do this; Econt has no such shape today). */
  | 'carrier_refusal'
  /** Parsed, but the array we expected is not where the contract says it is. */
  | 'wrong_shape'
  /** Parsed, well-shaped, and ZERO rows. Never a success. */
  | 'empty';

export type NomenclatureFetch<T> =
  | { ok: true; rows: NonEmpty<T> }
  | { ok: false; reason: NomenclatureFailure; detail: string };

type Source<TRaw> = {
  label: string;
  url: string;
  body: unknown;
  extract: (body: unknown) => TRaw[] | undefined;
};

async function fetchRows<TRaw>(
  source: Source<TRaw>,
  fetchImpl: typeof fetch = fetch,
): Promise<NomenclatureFetch<TRaw>> {
  let res: Response;
  try {
    res = await fetchImpl(source.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source.body),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'transport',
      detail: err instanceof Error ? err.message : 'fetch failed',
    };
  }

  if (!res.ok) return { ok: false, reason: 'http', detail: `HTTP ${res.status}` };

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, reason: 'not_json', detail: `HTTP ${res.status}, body did not parse` };
  }

  const rows = source.extract(parsed);
  if (rows === undefined) {
    return {
      ok: false,
      reason: 'wrong_shape',
      detail: `${source.label}: the expected array was not in the response`,
    };
  }

  // The type already forbids returning this as a success. The check is what
  // stops a carrier's empty day from becoming our empty table.
  if (rows.length === 0) {
    return { ok: false, reason: 'empty', detail: `${source.label}: the carrier returned zero rows` };
  }

  return { ok: true, rows: rows as NonEmpty<TRaw> };
}

// ─────────────────────────────────────────────────────────────────────────────
// Office kind — derived, and the derivation is a decision, not a lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Econt gives two INDEPENDENT booleans, `isAPS` (Еконтомат, a locker) and
 * `isMPS` (a mobile post station). Two booleans make four states, not three.
 * Measured live across all ~630 offices: plain 569, APS 38, MPS 23, both 0.
 * Zero today is not zero forever — so "both true" resolves to `office`, the
 * kind that PROMISES THE LEAST: `aps` tells a customer "a locker, collect any
 * hour", `mps` tells them "a van, at these hours", and the wrong badge costs
 * a person a wasted trip or a parcel.
 */
export type OfficeKind = 'office' | 'aps' | 'mps';

export function officeKind(flags: { isAPS?: unknown; isMPS?: unknown }): OfficeKind {
  // Strict `=== true`: the carrier sends real booleans today, and a truthy
  // string like "false" must not become a locker.
  const aps = flags.isAPS === true;
  const mps = flags.isMPS === true;
  if (aps && mps) return 'office'; // the fourth state — see above
  if (aps) return 'aps';
  if (mps) return 'mps';
  return 'office';
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows as this library returns them
// ─────────────────────────────────────────────────────────────────────────────

export type SettlementRow = {
  /** ⚠️ TEXT, even though Econt's ids are numeric today. */
  extId: string;
  name: string;
  nameEn: string | null;
  postCode: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
};

export type OfficeRow = {
  /**
   * ⚠️ THE HANDLE THE LABEL API CONSUMES: `office.code` — "4044", and for
   * mobile stations "2951@2932". NOT the `id`. See the module header.
   */
  extCode: string;
  extId: string | null;
  kind: OfficeKind;
  name: string;
  nameEn: string | null;
  settlementExtId: string | null;
  addressText: string | null;
  lat: number | null;
  lng: number | null;
  /** Wall-clock "HH:mm" in Europe/Sofia — see the note at `hhmm`. */
  hoursFrom: string | null;
  hoursTo: string | null;
  shipmentTypes: string[] | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://ee.econt.com/services/Nomenclatures/NomenclaturesService';
export const ECONT_CITIES_URL = `${BASE}.getCities.json`;
export const ECONT_OFFICES_URL = `${BASE}.getOffices.json`;

/**
 * ⚠️ Rows that are not settlements. „Мобилен РЦ" is a mobile depot and
 * „<name> (местност)" is a locality — neither is a place a customer types.
 * The filter is on the NAME because that is the property.
 */
export const PSEUDO_ROW = /Мобилен РЦ|\(местност\)/u;

/**
 * ⚠️ A BULGARIAN POST CODE IS FOUR DIGITS; ECONT'S FIELD IS NOT ALWAYS ONE.
 * Dozens of city records carry an internal id here instead („Бенковски"
 * 68651). Those are real settlements with an unusable post code, not fake
 * settlements: dropping the row loses the place, nulling the field loses only
 * the field.
 */
function normalisePostCode(raw: unknown): string | null {
  const s = String(raw ?? '');
  return /^[1-9]\d{3}$/.test(s) ? s : null;
}

/**
 * ⚠️ BUSINESS HOURS ARRIVE AS EPOCH MILLISECONDS, NOT AS A TIME.
 * `normalBusinessHoursFrom: 1785909600000` is 06:00Z — which is 09:00 in
 * Sofia, and the DATE half is noise that goes stale the next day. Store the
 * wall-clock time in the carrier's own timezone.
 */
const SOFIA_HHMM = new Intl.DateTimeFormat('bg-BG', {
  timeZone: 'Europe/Sofia',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
function hhmm(raw: unknown): string | null {
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return SOFIA_HHMM.format(new Date(ms));
}

function num(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function str(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw carrier shapes
// ─────────────────────────────────────────────────────────────────────────────

type EcontCity = {
  id?: number;
  name?: string;
  nameEn?: string | null;
  postCode?: string | number;
  regionName?: string | null;
  location?: { latitude?: number; longitude?: number } | null;
  country?: { code3?: string };
  servingOffices?: { officeCode?: string | number; servingType?: string }[];
};

type EcontOffice = {
  id?: number;
  code?: string | number;
  isMPS?: boolean;
  isAPS?: boolean;
  name?: string;
  nameEn?: string | null;
  normalBusinessHoursFrom?: number;
  normalBusinessHoursTo?: number;
  shipmentTypes?: string[];
  address?: {
    city?: { id?: number };
    fullAddress?: string;
    location?: { latitude?: number; longitude?: number } | null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type SettlementsResult =
  | {
      ok: true;
      rows: SettlementRow[];
      /** (settlement, office) pairs the CARRIER declares — `to_office_*` only. */
      servingLinks: { settlementExtId: string; officeExtCode: string }[];
      skippedPseudoRows: number;
      postCodesNulled: number;
    }
  | { ok: false; reason: NomenclatureFailure; detail: string };

/** Customer-collects directions. `from_office_*` is the shop dropping off. */
const TO_OFFICE = /^to_office_/;

export async function fetchSettlements(
  fetchImpl: typeof fetch = fetch,
): Promise<SettlementsResult> {
  const res = await fetchRows<EcontCity>(
    {
      label: 'econt.getCities',
      url: ECONT_CITIES_URL,
      body: { countryCode: 'BGR' },
      extract: (body) => {
        const cities = (body as { cities?: unknown }).cities;
        return Array.isArray(cities) ? cities : undefined;
      },
    },
    fetchImpl,
  );
  if (!res.ok) return res;

  const rows: SettlementRow[] = [];
  const servingLinks: { settlementExtId: string; officeExtCode: string }[] = [];
  let skippedPseudoRows = 0;
  let postCodesNulled = 0;

  for (const c of res.rows) {
    const name = str(c.name);
    if (c.id === undefined || c.id === null || name === null) continue;
    if (c.country?.code3 !== 'BGR') continue;
    if (PSEUDO_ROW.test(name)) {
      skippedPseudoRows++;
      continue;
    }

    const postCode = normalisePostCode(c.postCode);
    if (postCode === null && str(c.postCode) !== null) postCodesNulled++;

    const extId = String(c.id);
    rows.push({
      extId,
      name,
      nameEn: str(c.nameEn),
      postCode,
      region: str(c.regionName),
      lat: num(c.location?.latitude),
      lng: num(c.location?.longitude),
    });

    const seen = new Set<string>();
    for (const s of c.servingOffices ?? []) {
      if (!TO_OFFICE.test(String(s.servingType ?? ''))) continue;
      const code = str(s.officeCode);
      if (code === null || seen.has(code)) continue;
      seen.add(code);
      servingLinks.push({ settlementExtId: extId, officeExtCode: code });
    }
  }

  // `fetchRows` guarantees the CARRIER sent rows. This guarantees OUR mapping
  // did not throw them all away — a filter bug and an empty carrier are the
  // same empty table, and only one of them is theirs.
  if (rows.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      detail: `econt.getCities: ${res.rows.length} rows fetched, 0 survived mapping`,
    };
  }

  return { ok: true, rows, servingLinks, skippedPseudoRows, postCodesNulled };
}

export type OfficesResult =
  | {
      ok: true;
      rows: OfficeRow[];
      /** Offices where isAPS and isMPS were BOTH true — a state measured as impossible. */
      ambiguousKinds: number;
      /**
       * ⚠️ Offices the mapper THREW AWAY. Counted, never silent: change the
       * type of `code` at the carrier and rows would vanish with `ok: true`
       * and no signal. A drop nobody counts is a drop nobody sees.
       */
      droppedRows: number;
      /** Offices with no settlement id, unreachable from a settlement picker. */
      withoutSettlement: number;
    }
  | { ok: false; reason: NomenclatureFailure; detail: string };

export async function fetchOffices(
  fetchImpl: typeof fetch = fetch,
): Promise<OfficesResult> {
  const res = await fetchRows<EcontOffice>(
    {
      label: 'econt.getOffices',
      url: ECONT_OFFICES_URL,
      body: { countryCode: 'BGR' },
      extract: (body) => {
        const offices = (body as { offices?: unknown }).offices;
        return Array.isArray(offices) ? offices : undefined;
      },
    },
    fetchImpl,
  );
  if (!res.ok) return res;

  const rows: OfficeRow[] = [];
  let ambiguousKinds = 0;
  let droppedRows = 0;
  let withoutSettlement = 0;

  for (const o of res.rows) {
    // ⚠️ String(), never Number(). Some codes contain '@' — "2951@2932" is a
    // real mobile post station. `parseInt` would yield 2951: not an error, a
    // plausible wrong code that fails at label time, after payment.
    const code =
      typeof o.code === 'string' || typeof o.code === 'number' ? str(o.code) : null;
    const name = str(o.name);
    if (code === null || name === null) {
      droppedRows++;
      continue;
    }

    if (o.isAPS === true && o.isMPS === true) ambiguousKinds++;
    if (o.address?.city?.id === undefined || o.address?.city?.id === null) {
      withoutSettlement++;
    }

    rows.push({
      extCode: code,
      extId: o.id === undefined || o.id === null ? null : String(o.id),
      kind: officeKind(o),
      name,
      nameEn: str(o.nameEn),
      settlementExtId:
        o.address?.city?.id === undefined || o.address?.city?.id === null
          ? null
          : String(o.address.city.id),
      addressText: str(o.address?.fullAddress),
      lat: num(o.address?.location?.latitude),
      lng: num(o.address?.location?.longitude),
      hoursFrom: hhmm(o.normalBusinessHoursFrom),
      hoursTo: hhmm(o.normalBusinessHoursTo),
      shipmentTypes: Array.isArray(o.shipmentTypes) ? o.shipmentTypes.map(String) : null,
    });
  }

  if (rows.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      detail: `econt.getOffices: ${res.rows.length} rows fetched, 0 survived mapping`,
    };
  }

  return { ok: true, rows, ambiguousKinds, droppedRows, withoutSettlement };
}
