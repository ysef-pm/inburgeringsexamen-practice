const { test } = require('node:test');
const assert = require('node:assert');
const { createSessionAuth } = require('../lib/session-auth');

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}
const req = (body) => ({ body });

const notFound = () => { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; };

function handler(overrides = {}) {
    return createSessionAuth({
        getSubscriberEmail: async () => 'x@example.com',
        getUserByEmail: async () => notFound(),
        createAuthUser: async (email) => ({ uid: 'new-uid', email }),
        createCustomToken: async (uid) => `token-for-${uid}`,
        getEntitlement: async () => null,
        ...overrides,
    });
}

test('mints a token for a brand-new email (user created passwordless)', async () => {
    let created = null;
    const res = fakeRes();
    await handler({
        createAuthUser: async (email) => { created = email; return { uid: 'new-uid', email }; },
    })(req({ subscriberId: 'sid1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.token, 'token-for-new-uid');
    assert.equal(created, 'x@example.com');
});

test('mints a token for an existing passwordless unpaid user', async () => {
    const res = fakeRes();
    await handler({
        getUserByEmail: async () => ({ uid: 'u9', providerData: [] }),
    })(req({ subscriberId: 'sid1' }), res);
    assert.equal(res.body.token, 'token-for-u9');
});

test('existing user WITH providers -> requiresSignIn, never a token', async () => {
    const res = fakeRes();
    await handler({
        getUserByEmail: async () => ({ uid: 'u2', providerData: [{ providerId: 'google.com' }] }),
    })(req({ subscriberId: 'sid1' }), res);
    assert.equal(res.body.requiresSignIn, true);
    assert.equal(res.body.token, undefined);
});

test('existing PAID user -> requiresSignIn even without providers (no account takeover)', async () => {
    const res = fakeRes();
    await handler({
        getUserByEmail: async () => ({ uid: 'u3', providerData: [] }),
        getEntitlement: async () => ({ paid: true }),
    })(req({ subscriberId: 'sid1' }), res);
    assert.equal(res.body.requiresSignIn, true);
    assert.equal(res.body.token, undefined);
});

test('unknown subscriber -> 400', async () => {
    const res = fakeRes();
    await handler({ getSubscriberEmail: async () => null })(req({ subscriberId: 'nope' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'unknown_subscriber');
});

test('missing/invalid subscriberId -> 400', async () => {
    for (const body of [{}, { subscriberId: '' }, { subscriberId: 42 }, { subscriberId: 'x'.repeat(65) }, null]) {
        const res = fakeRes();
        await handler()(req(body), res);
        assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
});

test('unexpected auth error -> 500, no token leaked', async () => {
    const res = fakeRes();
    await handler({ getUserByEmail: async () => { throw new Error('boom'); } })(req({ subscriberId: 'sid1' }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.token, undefined);
});
