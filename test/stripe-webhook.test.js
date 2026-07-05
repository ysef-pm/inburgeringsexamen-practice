const { test } = require('node:test');
const assert = require('node:assert');
const { createWebhookHandler } = require('../lib/stripe-webhook');

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}
const reqWith = (event) => ({ body: Buffer.from('raw'), headers: { 'stripe-signature': 'sig' }, _event: event });

function makeSession(overrides = {}) {
    return {
        id: 'cs_test_123', client_reference_id: 'u1', customer: 'cus_1',
        payment_status: 'paid', customer_details: { email: 'a@b.c' },
        metadata: { uid: 'u1' }, ...overrides,
    };
}

test('bad signature -> 400', async () => {
    const handler = createWebhookHandler({
        constructEvent: () => { throw new Error('bad sig'); },
        writeEntitlement: async () => {},
    });
    const res = fakeRes();
    await handler(reqWith(null), res);
    assert.equal(res.statusCode, 400);
});

test('checkout.session.completed writes entitlement', async () => {
    let written = null;
    const handler = createWebhookHandler({
        constructEvent: () => ({ type: 'checkout.session.completed', data: { object: makeSession() } }),
        writeEntitlement: async (e) => { written = e; },
    });
    const res = fakeRes();
    await handler(reqWith(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(written.uid, 'u1');
    assert.equal(written.email, 'a@b.c');
    assert.equal(written.stripeSessionId, 'cs_test_123');
});

test('unpaid session does not write', async () => {
    let written = null;
    const handler = createWebhookHandler({
        constructEvent: () => ({ type: 'checkout.session.completed', data: { object: makeSession({ payment_status: 'unpaid' }) } }),
        writeEntitlement: async (e) => { written = e; },
    });
    await handler(reqWith(), fakeRes());
    assert.equal(written, null);
});

test('missing uid -> 200 with warning, no write', async () => {
    let written = null;
    const handler = createWebhookHandler({
        constructEvent: () => ({ type: 'checkout.session.completed', data: { object: makeSession({ client_reference_id: null, metadata: {} }) } }),
        writeEntitlement: async (e) => { written = e; },
    });
    const res = fakeRes();
    await handler(reqWith(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.warning, 'missing_uid');
    assert.equal(written, null);
});

test('other event types -> 200 no write', async () => {
    let written = null;
    const handler = createWebhookHandler({
        constructEvent: () => ({ type: 'payment_intent.created', data: { object: {} } }),
        writeEntitlement: async (e) => { written = e; },
    });
    const res = fakeRes();
    await handler(reqWith(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(written, null);
});

test('writeEntitlement failure -> 500 so Stripe retries', async () => {
    const handler = createWebhookHandler({
        constructEvent: () => ({ type: 'checkout.session.completed', data: { object: makeSession() } }),
        writeEntitlement: async () => { throw new Error('firestore down'); },
    });
    const res = fakeRes();
    await handler(reqWith(), res);
    assert.equal(res.statusCode, 500);
});
