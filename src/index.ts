/**
 * econt-client — a TypeScript client for the Econt e-commerce shipping API.
 *
 * Extracted from a production multi-tenant e-commerce platform; every quirk
 * documented in the source comments was measured against the live API, not
 * copied from the docs (the docs are wrong in at least one place — see
 * nomenclature.ts on `receiverOfficeCode`).
 */
export {
  postEcont,
  testConnection,
  baseUrl,
  type EcontConfig,
  type EcontResult,
} from './client.js';

export {
  createLabel,
  trackShipment,
  type CreateLabelParams,
  type TrackingResult,
} from './labels.js';

export {
  isValidBgPostcode,
  checkAddressCompleteness,
  describeMissingBg,
  ADDRESS_FIELD_BG,
  type AddressField,
  type AddressInput,
  type AddressCompleteness,
} from './address.js';

export {
  normalizeSettlementName,
  postcodeZone,
  checkServiceArea,
  SERVICE_AREA_ERROR_BG,
  type Settlement,
  type ServiceAreaResult,
} from './serviceArea.js';

export {
  fetchSettlements,
  fetchOffices,
  officeKind,
  ECONT_CITIES_URL,
  ECONT_OFFICES_URL,
  type SettlementRow,
  type OfficeRow,
  type OfficeKind,
  type SettlementsResult,
  type OfficesResult,
  type NomenclatureFailure,
  type NonEmpty,
} from './nomenclature.js';
