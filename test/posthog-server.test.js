const { test } = require('node:test');
const assert = require('node:assert');
const { buildPurchaseEvent, capturePurchase, uuidFromSession } = require('../lib/posthog-server');
const { analyticsMetadata, buildCheckoutSessionParams } = require('../lib/checkout');

const session = (md = {}) => ({
    id: 'cs_test_1', currency: 'eur', amount_total: 2400, payment_status: 'paid',
    metadata: { uid: 'firebase-uid', focus: 'writing', ...md },
});

test('no consent in metadata → no PostHog event', async () => {
    assert.equal(buildPurchaseEvent(session()), null);
    assert.equal(buildPurchaseEvent(session({ ph_consent: '1' })), null); // no distinct id
    let called = false;
    const r = await capturePurchase(session(), { fetchImpl: async () => { called = true; } });
    assert.deepEqual(r, { sent: false, reason: 'no_consent' });
    assert.equal(called, false);
});

test('consented purchase: distinct id, first-touch UTMs, dedupe uuid, never email/uid', () => {
    const ev = buildPurchaseEvent(session({
        ph_consent: '1', ph_distinct_id: 'sid-42',
        ph_ft: JSON.stringify({ utm_source: 'facebook', utm_campaign: 'c1', fbclid: 'F', evil: 'x' }),
    }));
    assert.equal(ev.event, 'purchase_completed');
    assert.equal(ev.distinct_id, 'sid-42');
    assert.equal(ev.uuid, uuidFromSession('cs_test_1'));
    assert.match(ev.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(ev.properties.utm_source, 'facebook');
    assert.equal(ev.properties.fbclid, 'F');
    assert.equal(ev.properties.evil, undefined);
    assert.equal(ev.properties.value, 24);
    assert.equal(ev.properties.checkout_session_id, 'cs_test_1');
    assert.ok(!JSON.stringify(ev).includes('firebase-uid'));
});

test('same session → same uuid (PostHog-side dedupe on webhook retries)', () => {
    assert.equal(uuidFromSession('cs_a'), uuidFromSession('cs_a'));
    assert.notEqual(uuidFromSession('cs_a'), uuidFromSession('cs_b'));
});

test('capturePurchase posts to the EU capture endpoint', async () => {
    let url, body;
    await capturePurchase(session({ ph_consent: '1', ph_distinct_id: 'd1' }), {
        host: 'https://eu.i.posthog.com', apiKey: 'phc_x',
        fetchImpl: async (u, o) => { url = u; body = JSON.parse(o.body); return { ok: true }; },
    });
    assert.equal(url, 'https://eu.i.posthog.com/i/v0/e/');
    assert.equal(body.api_key, 'phc_x');
    assert.equal(body.distinct_id, 'd1');
});

test('checkout metadata carries consent only when granted', () => {
    assert.deepEqual(analyticsMetadata(undefined), {});
    assert.deepEqual(analyticsMetadata({ consent: false, distinctId: 'd' }), {});
    assert.deepEqual(analyticsMetadata({ consent: true }), {});
    const md = analyticsMetadata({ consent: true, distinctId: 'd1', firstTouch: { utm_source: 'fb', junk: 'x' } });
    assert.deepEqual(md, { ph_consent: '1', ph_distinct_id: 'd1', ph_ft: '{"utm_source":"fb"}' });
    const big = analyticsMetadata({ consent: true, distinctId: 'd1', firstTouch: {
        utm_source: 'a'.repeat(120), utm_medium: 'b'.repeat(120), utm_campaign: 'c'.repeat(120),
        utm_content: 'd'.repeat(120), fbclid: 'f'.repeat(120) } });
    assert.ok(big.ph_ft.length <= 500);
    assert.ok(!big.ph_ft.includes('fbclid'));
    const p = buildCheckoutSessionParams({
        priceId: 'p', uid: 'u1', origin: 'https://x', analytics: { consent: true, distinctId: 'd1' },
    });
    assert.equal(p.metadata.ph_consent, '1');
    assert.equal(p.metadata.uid, 'u1');
});
