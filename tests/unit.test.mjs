/**
 * Unit tests for the pure modules — run with `npm test` (node --test).
 * Network-touching functions are covered by injecting a stub fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidBgPostcode,
  checkAddressCompleteness,
  describeMissingBg,
} from '../dist/address.js';
import {
  normalizeSettlementName,
  postcodeZone,
  checkServiceArea,
} from '../dist/serviceArea.js';
import { officeKind } from '../dist/nomenclature.js';
import { createLabel } from '../dist/labels.js';
import { fetchSettlements, fetchOffices } from '../dist/nomenclature.js';

// ── postcode ────────────────────────────────────────────────────────────────

test('isValidBgPostcode', () => {
  assert.equal(isValidBgPostcode('4000'), true);
  assert.equal(isValidBgPostcode(' 1000 '), true);
  assert.equal(isValidBgPostcode('0999'), false); // no BG postcode starts with 0
  assert.equal(isValidBgPostcode('400'), false);
  assert.equal(isValidBgPostcode('асдф'), false);
  assert.equal(isValidBgPostcode(''), false);
  assert.equal(isValidBgPostcode(null), false);
});

// ── address completeness ────────────────────────────────────────────────────

test('complete door address passes', () => {
  const r = checkAddressCompleteness({
    city: 'Пловдив',
    postCode: '4000',
    street: 'ул. Витоша',
    streetNum: '1',
  });
  assert.deepEqual(r, { ok: true });
});

test('missing postcode is reported by name', () => {
  const r = checkAddressCompleteness({
    city: 'Пловдив',
    street: 'ул. Витоша',
    streetNum: '1',
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['postCode']);
  assert.equal(describeMissingBg(r.missing), 'пощенски код');
});

test('malformed postcode counts as missing, not present', () => {
  const r = checkAddressCompleteness({
    city: 'Пловдив',
    postCode: 'асдф',
    street: 'ул. Витоша',
    streetNum: '1',
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['postCode']);
});

test('office delivery needs no street address', () => {
  const r = checkAddressCompleteness({ officeCode: '4044' });
  assert.deepEqual(r, { ok: true });
});

test('requireContact demands recipient and phone', () => {
  const r = checkAddressCompleteness(
    { city: 'София', postCode: '1000', street: 'x', streetNum: '1' },
    { requireContact: true },
  );
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['recipient', 'phone']);
});

test('quarter+other satisfies the street requirement', () => {
  const r = checkAddressCompleteness({
    city: 'София',
    postCode: '1000',
    quarter: 'ж.к. Люлин',
    other: 'бл. 5, вх. А',
  });
  assert.deepEqual(r, { ok: true });
});

// ── settlement name normalisation ───────────────────────────────────────────

test('prefixes are stripped only with dot or whitespace', () => {
  assert.equal(normalizeSettlementName('гр. София'), 'софия');
  assert.equal(normalizeSettlementName('гр.София'), 'софия');
  assert.equal(normalizeSettlementName('град София'), 'софия');
  assert.equal(normalizeSettlementName('с. Кокаляне'), 'кокаляне');
  assert.equal(normalizeSettlementName('село Кокаляне'), 'кокаляне');
  // The regression that motivated the rule: a bare 'с' must NOT eat the
  // first letter of names starting with С.
  assert.equal(normalizeSettlementName('София'), 'софия');
  assert.equal(normalizeSettlementName('Своге'), 'своге');
  assert.equal(normalizeSettlementName('Селановци'), 'селановци');
  assert.equal(normalizeSettlementName('Градец'), 'градец');
});

test('casing, alphabets and whitespace are normalised', () => {
  assert.equal(normalizeSettlementName('  СОФИЯ  '), 'софия');
  assert.equal(normalizeSettlementName('Велико  Търново'), 'велико търново');
  assert.equal(normalizeSettlementName('Sofia'), 'sofia');
});

// ── zone check ──────────────────────────────────────────────────────────────

const SETTLEMENTS = [
  { name: 'Пловдив', nameEn: 'Plovdiv', postCode: '4000', region: 'Пловдив' },
  { name: 'София', nameEn: 'Sofia', postCode: '1000', region: 'София' },
];

test('postcodeZone', () => {
  assert.equal(postcodeZone('4000'), '4');
  assert.equal(postcodeZone('0999'), null);
  assert.equal(postcodeZone('40'), null);
});

test('served settlement in the right zone passes', () => {
  assert.deepEqual(
    checkServiceArea({ city: 'гр. Пловдив', postCode: '4002', settlements: SETTLEMENTS }),
    { ok: true },
  );
});

test('zone mismatch is caught and names the expected zone', () => {
  const r = checkServiceArea({ city: 'Пловдив', postCode: '9000', settlements: SETTLEMENTS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'zone_mismatch');
  assert.equal(r.expectedZone, '4');
});

test('latin spelling resolves through nameEn', () => {
  assert.deepEqual(
    checkServiceArea({ city: 'Sofia', postCode: '1618', settlements: SETTLEMENTS }),
    { ok: true },
  );
});

test('unknown settlement is reported as coverage, not validity', () => {
  const r = checkServiceArea({ city: 'asdf', postCode: '4000', settlements: SETTLEMENTS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown_settlement');
});

// ── office kind ─────────────────────────────────────────────────────────────

test('officeKind covers all four states', () => {
  assert.equal(officeKind({}), 'office');
  assert.equal(officeKind({ isAPS: true }), 'aps');
  assert.equal(officeKind({ isMPS: true }), 'mps');
  assert.equal(officeKind({ isAPS: true, isMPS: true }), 'office'); // least-promising kind
  assert.equal(officeKind({ isAPS: 'false' }), 'office'); // strict === true
});

// ── createLabel refuses an incomplete address BEFORE any network call ───────

test('createLabel refuses a missing receiver postcode without calling fetch', async () => {
  let fetchCalled = false;
  const config = {
    username: 'demo',
    password: 'demo',
    sandbox: true,
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('must not be reached');
    },
  };
  const res = await createLabel(config, {
    senderName: 'Магазин',
    senderPhone: '0888000000',
    senderCity: 'Пловдив',
    senderPostCode: '4000',
    senderStreet: 'ул. Търговска',
    senderNum: '1',
    receiverName: 'Клиент',
    receiverPhone: '0888111111',
    receiverCity: 'София',
    receiverPostCode: '', // the defect this guard exists for
    receiverStreet: 'ул. Витоша',
    receiverNum: '2',
    weight: 0.5,
    shipmentDescription: 'Бижута',
    declaredValue: 100,
    isCod: true,
  });
  assert.equal(res.success, false);
  assert.match(res.error, /пощенски код/);
  assert.equal(fetchCalled, false);
});

// ── nomenclature: the non-empty contract ────────────────────────────────────

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('fetchSettlements maps rows and drops pseudo-rows', async () => {
  const stub = async () =>
    jsonResponse({
      cities: [
        {
          id: 1,
          name: 'Пловдив',
          nameEn: 'Plovdiv',
          postCode: '4000',
          regionName: 'Пловдив',
          country: { code3: 'BGR' },
          servingOffices: [
            { officeCode: '4044', servingType: 'to_office_courier' },
            { officeCode: '4044', servingType: 'to_office_courier' }, // dup — deduped
            { officeCode: '9999', servingType: 'from_office_courier' }, // dropped
          ],
        },
        { id: 2, name: 'Мобилен РЦ Юг', country: { code3: 'BGR' } }, // pseudo-row
        { id: 3, name: 'Бенковски', postCode: '68651', country: { code3: 'BGR' } }, // bad postcode
      ],
    });
  const res = await fetchSettlements(stub);
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 2);
  assert.equal(res.skippedPseudoRows, 1);
  assert.equal(res.postCodesNulled, 1);
  assert.deepEqual(res.servingLinks, [
    { settlementExtId: '1', officeExtCode: '4044' },
  ]);
  assert.equal(res.rows[1].postCode, null); // nulled, row kept
});

test('zero carrier rows is a failure, never an empty success', async () => {
  const stub = async () => jsonResponse({ cities: [] });
  const res = await fetchSettlements(stub);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'empty');
});

test('a renamed array is wrong_shape, not an empty carrier', async () => {
  const stub = async () => jsonResponse({ towns: [] });
  const res = await fetchSettlements(stub);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'wrong_shape');
});

test('fetchOffices keeps @-codes as strings and counts drops', async () => {
  const stub = async () =>
    jsonResponse({
      offices: [
        {
          id: 970,
          code: '4044',
          name: 'Пловдив Тракия',
          isAPS: false,
          isMPS: false,
          address: { city: { id: 1 }, fullAddress: 'Пловдив, ул. X 1' },
        },
        { id: 971, code: '2951@2932', name: 'МПС Родопи', isMPS: true, address: { city: { id: 1 } } },
        { id: 972, name: 'счупен запис без код' }, // dropped + counted
      ],
    });
  const res = await fetchOffices(stub);
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 2);
  assert.equal(res.droppedRows, 1);
  assert.equal(res.rows[1].extCode, '2951@2932'); // never parseInt-ed
  assert.equal(res.rows[1].kind, 'mps');
});

test('transport failure is reported as transport', async () => {
  const stub = async () => {
    throw new Error('ECONNREFUSED');
  };
  const res = await fetchOffices(stub);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'transport');
});
