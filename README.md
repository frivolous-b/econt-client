# econt-client

TypeScript client for the **[Econt](https://www.econt.com/en)** e-commerce shipping API (Bulgaria's largest courier): waybills (labels) with cash-on-delivery, shipment tracking, the offices & settlements nomenclature, and address validation aligned with the Bulgarian Postal Services Act.

Extracted from a production multi-tenant e-commerce platform. Every API quirk documented in the source was **measured against the live API**, not copied from the docs — the docs are wrong in at least one place (see [Field notes](#field-notes-what-the-docs-dont-tell-you)).

## Features

- **Create waybills** (`createLabel`) — door delivery with COD support, with a built-in refusal of legally incomplete addresses
- **Track shipments** (`trackShipment`) — status, expected delivery date, price, and the full event timeline, in Bulgarian or English
- **Nomenclature** (`fetchSettlements`, `fetchOffices`) — every settlement and office/locker/mobile-station Econt publishes, normalised and counted (no credentials required — these endpoints are open)
- **Address completeness** (`checkAddressCompleteness`) — the exact rule from Econt's API contract, with named missing fields for user-facing messages
- **Service-area check** (`checkServiceArea`) — does Econt serve the settlement the customer typed, with careful Bulgarian name normalisation („гр. София", „с. Кокаляне", „SOFIA"…)
- **Sandbox support** — one flag switches to Econt's Demo environment
- Zero runtime dependencies. Node 18+. Fully typed. `fetch` injectable everywhere, so everything is testable offline.

## Install

```bash
npm install econt-client
```

## Quick start

```ts
import { testConnection, createLabel, trackShipment } from 'econt-client';

const config = {
  username: process.env.ECONT_USERNAME!,
  password: process.env.ECONT_PASSWORD!,
  sandbox: true, // Demo environment; omit for production
};

// Verify credentials
const conn = await testConnection(config);
if (!conn.success) throw new Error(conn.error);

// Create a COD waybill
const label = await createLabel(config, {
  senderName: 'Моят магазин ЕООД',
  senderPhone: '0888000000',
  senderCity: 'Пловдив',
  senderPostCode: '4000',
  senderStreet: 'ул. Търговска',
  senderNum: '1',
  receiverName: 'Иван Иванов',
  receiverPhone: '0888111111',
  receiverCity: 'София',
  receiverPostCode: '1000',
  receiverStreet: 'бул. Витоша',
  receiverNum: '15',
  receiverOther: 'вх. Б, ет. 3, ап. 12',
  weight: 0.5,
  shipmentDescription: 'Бижута',
  declaredValue: 120,
  isCod: true,
});

if (label.success) {
  console.log('Tracking number:', label.trackingNumber);
}

// Track it
const tracking = await trackShipment(config, label.trackingNumber!, 'bg');
console.log(tracking.status, tracking.events);
```

### Offices & settlements (no credentials needed)

```ts
import { fetchSettlements, fetchOffices } from 'econt-client';

const settlements = await fetchSettlements();
const offices = await fetchOffices();

if (offices.ok) {
  // offices.rows[i].extCode is what the label API consumes — NOT the id.
  const lockers = offices.rows.filter((o) => o.kind === 'aps');
}
```

### Validating a checkout address

```ts
import { checkAddressCompleteness, describeMissingBg, checkServiceArea } from 'econt-client';

const check = checkAddressCompleteness({
  city: form.city,
  postCode: form.postCode,
  street: form.street,
  streetNum: form.streetNum,
});
if (!check.ok) {
  showError(`Липсва: ${describeMissingBg(check.missing)}`);
}
```

## Why address completeness is a legal check, not a UX nicety

The Bulgarian Postal Services Act (ЗПУ), art. 87 item 6, **excuses the carrier entirely** where the address on the waybill was incomplete. A missing postcode does not merely risk a misrouted parcel — it silently voids the carrier's liability on the consignment. A wrong postcode costs a delivery attempt; a *missing* one costs the insurance.

That is why `createLabel` refuses an incomplete address itself, before any network call, instead of trusting every caller to validate: TypeScript types are erased at runtime, and `JSON.stringify` silently drops an `undefined` field — an untyped caller would otherwise produce a request byte-identical to a valid one, minus the postcode.

## Field notes (what the docs don't tell you)

Findings measured against the live API, preserved as source comments where they apply:

| Finding | Consequence |
| --- | --- |
| `receiverOfficeCode` takes the office **`code`** ("4044"), **not the `id`** — Econt's docs say "the id", and it 517s | Store `office.code`; keep `id` only for joins |
| Office codes can contain `@` — `"2951@2932"` is a real mobile post station | Treat codes as strings; `parseInt` produces a *plausible wrong* code |
| ~6% of settlement records carry an internal id in the `postCode` field | Null the field, keep the row — they are real settlements |
| Office business hours arrive as **epoch milliseconds** with a stale date half | Store wall-clock HH:mm in Europe/Sofia |
| Tracking events live on `status.trackingEvents`, not at the top level; per-shipment errors arrive **inside** an HTTP 200 | Parse the measured shape or get successful-looking empty results |
| The label PDF URL is served over **http://** and carries a `_key=` token | Proxy it through an authenticated route; never embed it in an https page |
| `getCities` is a **subset** of where Econt actually delivers (the label API prices settlements absent from it) | Treat "unknown settlement" as a warning to surface, not a hard stop |
| The nomenclature endpoints require **no authentication** | An office picker can be built with zero credentials |

## Design notes

- **No fail-silent shapes.** The nomenclature fetch result's success arm is a non-empty tuple (`[T, ...T[]]`) — "ok, and here are no rows" cannot be constructed, so a carrier outage can never sync an office picker to empty with a green status.
- **Counted drops.** Rows the mappers discard are counted and returned (`droppedRows`, `skippedPseudoRows`, `postCodesNulled`), never silently absorbed.
- **Pure where possible.** The service-area and address checks take data as arguments and touch no network, so they run in any environment and test offline.

## Scripts

```bash
npm run build   # tsc → dist/
npm test        # build + node --test (21 tests, all offline)
```

## License

MIT © [Ivo Karabashev](https://github.com/frivolous-b)

*This is an unofficial client. Econt and Еконт are trademarks of Econt Express OOD. Verify behaviour against your own Econt contract before production use.*
