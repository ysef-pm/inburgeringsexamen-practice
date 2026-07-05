const { test } = require('node:test');
const assert = require('node:assert');
const { createPaywall } = require('../lib/paywall');

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}
const fakeReq = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

test('requireAuth: 401 when no token', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(fakeReq(null), res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth_required');
    assert.equal(nextCalled, false);
});

test('requireAuth: 401 when token invalid', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => { throw new Error('bad'); },
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    await requireAuth(fakeReq('junk'), res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'invalid_token');
});

test('requireAuth: 401 invalid_token when decoded token has no uid', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => ({}),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(fakeReq('good'), res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'invalid_token');
    assert.equal(nextCalled, false);
});

test('requireAuth: 401 invalid_token when decoded uid is empty string', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => ({ uid: '' }),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(fakeReq('good'), res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'invalid_token');
    assert.equal(nextCalled, false);
});

test('requireAuth: 401 auth_required when header is "Bearer " with no token', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth({ headers: { authorization: 'Bearer ' } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth_required');
    assert.equal(nextCalled, false);
});

test('requireAuth: 401 auth_required when scheme is lowercase bearer', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth({ headers: { authorization: 'bearer x' } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'auth_required');
    assert.equal(nextCalled, false);
});

test('requireAuth: sets req.user and calls next on valid token', async () => {
    const { requireAuth } = createPaywall({
        verifyIdToken: async (t) => ({ uid: 'u1', email: 'a@b.c' }),
        getEntitlement: async () => null,
    });
    const req = fakeReq('good');
    let nextCalled = false;
    await requireAuth(req, fakeRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user, { uid: 'u1', email: 'a@b.c' });
});

test('requirePaid: 402 when no entitlement', async () => {
    const { requirePaid } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1', email: 'a@b.c' }),
        getEntitlement: async () => null,
    });
    const res = fakeRes();
    await requirePaid(fakeReq('good'), res, () => {});
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'payment_required');
});

test('requirePaid: 402 when entitlement exists but paid false', async () => {
    const { requirePaid } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async () => ({ paid: false }),
    });
    const res = fakeRes();
    await requirePaid(fakeReq('good'), res, () => {});
    assert.equal(res.statusCode, 402);
});

test('requirePaid: next() when paid', async () => {
    const { requirePaid } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async (uid) => (uid === 'u1' ? { paid: true } : null),
    });
    let nextCalled = false;
    await requirePaid(fakeReq('good'), fakeRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('requirePaid: 500 when entitlement lookup throws', async () => {
    const { requirePaid } = createPaywall({
        verifyIdToken: async () => ({ uid: 'u1' }),
        getEntitlement: async () => { throw new Error('firestore down'); },
    });
    const res = fakeRes();
    await requirePaid(fakeReq('good'), res, () => {});
    assert.equal(res.statusCode, 500);
});
