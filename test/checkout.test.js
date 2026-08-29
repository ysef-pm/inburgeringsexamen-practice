const { test } = require('node:test');
const assert = require('node:assert');
const { buildCheckoutSessionParams, normalizeLocale, prefillCountry } = require('../lib/checkout');

const base = {
    priceId: 'price_123', uid: 'u1', email: 'test@example.com',
    origin: 'https://ratemydutch.com', returnTo: '/scorecard',
};

test('Dutch checkout contract: EUR-only, iDEAL first, no phone, no adaptive pricing', () => {
    const p = buildCheckoutSessionParams({ ...base, locale: 'nl' });
    assert.deepEqual(p.adaptive_pricing, { enabled: false });
    assert.equal(p.payment_method_types[0], 'ideal');
    assert.ok(p.payment_method_types.includes('card'));
    assert.ok(!p.payment_method_types.includes('amazon_pay'));
    assert.deepEqual(p.phone_number_collection, { enabled: false });
    assert.equal(p.locale, 'nl');
    assert.equal(p.mode, 'payment');
    assert.deepEqual(p.line_items, [{ price: 'price_123', quantity: 1 }]);
});

test('return URLs stay on the origin + whitelisted path', () => {
    const p = buildCheckoutSessionParams(base);
    assert.equal(p.success_url, 'https://ratemydutch.com/scorecard?checkout=success');
    assert.equal(p.cancel_url, 'https://ratemydutch.com/scorecard?checkout=cancelled');
});

test('email prefill when no customer; customer wins when present (params are exclusive)', () => {
    const withEmail = buildCheckoutSessionParams(base);
    assert.equal(withEmail.customer_email, 'test@example.com');
    assert.equal(withEmail.customer, undefined);

    const withCustomer = buildCheckoutSessionParams({ ...base, customerId: 'cus_1' });
    assert.equal(withCustomer.customer, 'cus_1');
    assert.equal(withCustomer.customer_email, undefined);
});

test('funnel metadata flows into the session for the webhook', () => {
    const p = buildCheckoutSessionParams({
        ...base, subscriberId: 'sid1', anonId: 'a-1', focus: 'speaking',
    });
    assert.deepEqual(p.metadata, { uid: 'u1', subscriberId: 'sid1', anonId: 'a-1', focus: 'speaking' });
    assert.equal(p.client_reference_id, 'u1');
});

test('metadata omits empty funnel fields', () => {
    const p = buildCheckoutSessionParams(base);
    assert.deepEqual(p.metadata, { uid: 'u1' });
});

test('locale whitelist: unknown or missing values fall back to auto (never a US assumption)', () => {
    assert.equal(normalizeLocale('nl'), 'nl');
    assert.equal(normalizeLocale('de'), 'de');
    assert.equal(normalizeLocale('xx'), 'auto');
    assert.equal(normalizeLocale(undefined), 'auto');
    assert.equal(normalizeLocale('en-US'), 'auto');
});

test('billing-country prefill only for NL/BE/DE', () => {
    assert.equal(prefillCountry('NL'), 'NL');
    assert.equal(prefillCountry('be'), 'BE');
    assert.equal(prefillCountry('DE'), 'DE');
    assert.equal(prefillCountry('US'), null);
    assert.equal(prefillCountry(undefined), null);
});
