# RateMyDutch Stripe Paywall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Add Firebase Auth + Firestore entitlements + Stripe Checkout (€24 one-time) to the Express app so AI grading endpoints are paid-only, per `docs/plans/2026-07-05-stripe-paywall-design.md`.

**Architecture:** Paywall logic lives in small dependency-injected factories under `lib/` (testable without real Firebase/Stripe). `server.js` wires real implementations. Frontend uses Firebase compat CDN SDK, attaches ID tokens to AI fetches, and shows an upgrade modal on 402.

**Tech Stack:** Express, `stripe`, `firebase-admin` (server); Firebase Auth compat CDN SDK (client); Node built-in `node:test` runner (no new dev deps).

**Working directory:** `.worktrees/stripe-paywall` (branch `feature/stripe-paywall`)

**CRITICAL ordering constraint:** `server.js:6` has `app.use(express.json({limit:'10mb'}))`. The Stripe webhook route MUST be registered BEFORE that line with `express.raw({type: 'application/json'})`, otherwise signature verification fails because the body is already parsed.

---

### Task 1: Dependencies + test harness

**Files:**
- Modify: `package.json`

**Step 1:** `npm install stripe firebase-admin`

**Step 2:** Add test script to `package.json` scripts:
```json
"test": "node --test test/"
```

**Step 3:** `mkdir -p test lib` and create a trivial `test/smoke.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
test('test runner works', () => assert.ok(true));
```

**Step 4:** Run `npm test` → expect 1 pass.

**Step 5:** Commit: `chore: add stripe + firebase-admin deps and node:test harness`

---

### Task 2: Paywall middleware factory (TDD)

**Files:**
- Create: `lib/paywall.js`
- Test: `test/paywall.test.js`

**Behavior:** `createPaywall({ verifyIdToken, getEntitlement })` returns `{ requireAuth, requirePaid }` Express middlewares.

- `requireAuth`: reads `Authorization: Bearer <token>`. Missing/malformed → 401 `{ success:false, error:'auth_required' }`. `verifyIdToken` throws → 401 `{ success:false, error:'invalid_token' }`. Valid → sets `req.user = { uid, email }`, calls `next()`.
- `requirePaid`: runs `requireAuth` logic first, then `getEntitlement(uid)`. Entitlement missing or `paid !== true` → **402** `{ success:false, error:'payment_required' }`. Paid → `next()`. `getEntitlement` throws → 500 `{ success:false, error:'entitlement_check_failed' }`.

**Step 1: Write failing tests** in `test/paywall.test.js` using fake req/res:
```js
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
```

**Step 2:** `npm test` → expect FAIL (module not found).

**Step 3: Implement** `lib/paywall.js`:
```js
function createPaywall({ verifyIdToken, getEntitlement }) {
    async function authenticate(req, res) {
        const header = req.headers.authorization || '';
        const match = header.match(/^Bearer (.+)$/);
        if (!match) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return null;
        }
        try {
            const decoded = await verifyIdToken(match[1]);
            req.user = { uid: decoded.uid, email: decoded.email };
            return req.user;
        } catch (err) {
            res.status(401).json({ success: false, error: 'invalid_token' });
            return null;
        }
    }

    async function requireAuth(req, res, next) {
        const user = await authenticate(req, res);
        if (user) next();
    }

    async function requirePaid(req, res, next) {
        const user = await authenticate(req, res);
        if (!user) return;
        try {
            const entitlement = await getEntitlement(user.uid);
            if (!entitlement || entitlement.paid !== true) {
                return res.status(402).json({ success: false, error: 'payment_required' });
            }
            next();
        } catch (err) {
            console.error('Entitlement check failed:', err);
            res.status(500).json({ success: false, error: 'entitlement_check_failed' });
        }
    }

    return { requireAuth, requirePaid };
}

module.exports = { createPaywall };
```

**Step 4:** `npm test` → all pass.

**Step 5:** Commit: `feat: add paywall middleware factory (requireAuth/requirePaid)`

---

### Task 3: Stripe webhook handler factory (TDD)

**Files:**
- Create: `lib/stripe-webhook.js`
- Test: `test/stripe-webhook.test.js`

**Behavior:** `createWebhookHandler({ constructEvent, writeEntitlement })` returns an Express handler for the raw-body webhook route.

- `constructEvent(rawBody, signature)` is Stripe's `stripe.webhooks.constructEvent` partially applied with the secret; throws on bad signature → respond 400 `{ error: 'invalid_signature' }`.
- Event `checkout.session.completed` with `payment_status === 'paid'`: call `writeEntitlement({ uid, email, stripeCustomerId, stripeSessionId })` where `uid = session.client_reference_id || session.metadata.uid`; respond 200 `{ received: true }`.
- Session missing uid → log error, still 200 (don't make Stripe retry forever) with `{ received: true, warning: 'missing_uid' }`.
- Any other event type → 200 `{ received: true }` without writing.
- `writeEntitlement` throws → 500 (so Stripe retries).

**Step 1: Write failing tests** in `test/stripe-webhook.test.js`:
```js
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
```

**Step 2:** `npm test` → new tests FAIL.

**Step 3: Implement** `lib/stripe-webhook.js`:
```js
function createWebhookHandler({ constructEvent, writeEntitlement }) {
    return async function handleWebhook(req, res) {
        let event;
        try {
            event = constructEvent(req.body, req.headers['stripe-signature']);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: 'invalid_signature' });
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (session.payment_status === 'paid') {
                const uid = session.client_reference_id || (session.metadata && session.metadata.uid);
                if (!uid) {
                    console.error('checkout.session.completed with no uid:', session.id);
                    return res.status(200).json({ received: true, warning: 'missing_uid' });
                }
                try {
                    await writeEntitlement({
                        uid,
                        email: (session.customer_details && session.customer_details.email) || null,
                        stripeCustomerId: session.customer || null,
                        stripeSessionId: session.id,
                    });
                } catch (err) {
                    console.error('Failed to write entitlement:', err);
                    return res.status(500).json({ error: 'entitlement_write_failed' });
                }
            }
        }
        res.status(200).json({ received: true });
    };
}

module.exports = { createWebhookHandler };
```

**Step 4:** `npm test` → all pass. **Step 5:** Commit: `feat: add stripe webhook handler factory`

---

### Task 4: Firebase Admin wiring module

**Files:**
- Create: `lib/firebase.js`

No unit tests (thin wrapper around firebase-admin; nothing to test without the real service). Must not crash the app when `FIREBASE_SERVICE_ACCOUNT` is unset — return `null`/throw only on use, mirroring how the app already warns about missing AI keys.

```js
const admin = require('firebase-admin');

let initialized = false;
let initError = null;

function init() {
    if (initialized || initError) return;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        initError = new Error('FIREBASE_SERVICE_ACCOUNT not set');
        return;
    }
    try {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        initialized = true;
    } catch (err) {
        initError = err;
        console.error('Firebase Admin init failed:', err.message);
    }
}

function isConfigured() { init(); return initialized; }

async function verifyIdToken(token) {
    init();
    if (!initialized) throw initError;
    return admin.auth().verifyIdToken(token);
}

async function getEntitlement(uid) {
    init();
    if (!initialized) throw initError;
    const snap = await admin.firestore().collection('entitlements').doc(uid).get();
    return snap.exists ? snap.data() : null;
}

async function writeEntitlement({ uid, email, stripeCustomerId, stripeSessionId }) {
    init();
    if (!initialized) throw initError;
    await admin.firestore().collection('entitlements').doc(uid).set({
        uid, email, paid: true, stripeCustomerId, stripeSessionId,
        purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

module.exports = { isConfigured, verifyIdToken, getEntitlement, writeEntitlement };
```

Verify: `node -e "const f = require('./lib/firebase'); console.log('configured:', f.isConfigured())"` → `configured: false`, no crash.

Commit: `feat: add firebase admin wrapper with lazy init`

---

### Task 5: Wire routes into server.js

**Files:**
- Modify: `server.js`

**Step 1:** At top of `server.js` (after existing requires, before `app.use(express.json(...))` at current line 6), add:

```js
const Stripe = require('stripe');
const firebase = require('./lib/firebase');
const { createPaywall } = require('./lib/paywall');
const { createWebhookHandler } = require('./lib/stripe-webhook');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const { requireAuth, requirePaid } = createPaywall({
    verifyIdToken: firebase.verifyIdToken,
    getEntitlement: firebase.getEntitlement,
});
```

**Step 2:** Register the webhook route BEFORE `app.use(express.json(...))` (this is the critical ordering — raw body needed for signature verification):

```js
// Stripe webhook needs the raw body — MUST be registered before express.json()
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'stripe_not_configured' });
    }
    return createWebhookHandler({
        constructEvent: (rawBody, sig) => stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET),
        writeEntitlement: firebase.writeEntitlement,
    })(req, res);
});
```

**Step 3:** After the existing static/json middleware, add checkout + me endpoints:

```js
app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
    if (!stripe || !STRIPE_PRICE_ID) {
        return res.status(500).json({ success: false, error: 'stripe_not_configured' });
    }
    try {
        const existing = await firebase.getEntitlement(req.user.uid);
        if (existing && existing.paid === true) {
            return res.json({ success: true, alreadyPaid: true });
        }
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
            client_reference_id: req.user.uid,
            customer_email: req.user.email || undefined,
            metadata: { uid: req.user.uid },
            success_url: `${origin}/?checkout=success`,
            cancel_url: `${origin}/?checkout=cancelled`,
        });
        res.json({ success: true, url: session.url });
    } catch (err) {
        console.error('Checkout session creation failed:', err);
        res.status(500).json({ success: false, error: 'checkout_failed' });
    }
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const entitlement = await firebase.getEntitlement(req.user.uid);
        res.json({ success: true, paid: !!(entitlement && entitlement.paid === true) });
    } catch (err) {
        console.error('Entitlement lookup failed:', err);
        res.status(500).json({ success: false, error: 'entitlement_check_failed' });
    }
});
```

**Step 4:** Gate the three AI endpoints by inserting `requirePaid` as middleware:
- `app.post('/api/grade-writing', requirePaid, async (req, res) => {` (current line 54)
- `app.post('/api/transcribe-speech', requirePaid, async (req, res) => {` (current line 212)
- `app.post('/api/grade-speaking', requirePaid, async (req, res) => {` (current line 296)

Leave `/api/check-grammar` as-is (it re-dispatches into grade-writing, which is now gated).

**Step 5:** In the local-startup block (current line ~377), add startup warnings mirroring the existing pattern for `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`FIREBASE_SERVICE_ACCOUNT` unset.

**Step 6: Verify** — `npm test` still green, then boot check:
```bash
node server.js &  # then:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3456/                        # 200
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3456/api/grade-writing -H 'Content-Type: application/json' -d '{"userText":"hoi"}'   # 401 auth_required
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3456/api/transcribe-speech -H 'Content-Type: application/json' -d '{}'               # 401
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3456/api/grade-speaking -H 'Content-Type: application/json' -d '{}'                  # 401
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3456/api/stripe-webhook -d '{}'  # 500 stripe_not_configured
```

**Step 7:** Commit: `feat: gate AI endpoints behind paywall, add checkout + webhook + me routes`

---

### Task 6: Frontend — Firebase client config + auth service

**Files:**
- Create: `public/js/firebase-config.js`
- Create: `public/js/auth.js`
- Modify: `index.html` (script includes in `<head>` / before closing `</body>`)

**Step 1:** `public/js/firebase-config.js` — placeholder the owner fills in from Firebase console (public values, safe to commit):
```js
// Firebase web app config — public values, safe to expose.
// TODO(owner): replace with real values from Firebase console > Project settings > Your apps.
window.FIREBASE_CONFIG = {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME.firebaseapp.com',
    projectId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
};
```

**Step 2:** `public/js/auth.js` — plain script (not module) exposing `window.RMDAuth`:

```js
// RateMyDutch auth service. Requires firebase compat SDK + firebase-config.js loaded first.
(function () {
    const configured = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
    let currentUser = null;
    let paid = false;
    const listeners = [];

    function notify() { listeners.forEach((fn) => fn({ user: currentUser, paid })); }

    async function refreshEntitlement() {
        if (!currentUser) { paid = false; return; }
        try {
            const token = await currentUser.getIdToken();
            const resp = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
            const data = await resp.json();
            paid = !!data.paid;
        } catch (e) { paid = false; }
    }

    if (configured) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
        firebase.auth().onAuthStateChanged(async (user) => {
            currentUser = user;
            await refreshEntitlement();
            notify();
        });
    }

    window.RMDAuth = {
        isConfigured: () => configured,
        onChange(fn) { listeners.push(fn); fn({ user: currentUser, paid }); },
        getUser: () => currentUser,
        isPaid: () => paid,
        async getToken() { return currentUser ? currentUser.getIdToken() : null; },
        async refresh() { await refreshEntitlement(); notify(); },
        signInGoogle: () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()),
        signInEmail: (email, pw) => firebase.auth().signInWithEmailAndPassword(email, pw),
        signUpEmail: (email, pw) => firebase.auth().createUserWithEmailAndPassword(email, pw),
        resetPassword: (email) => firebase.auth().sendPasswordResetEmail(email),
        signOut: () => firebase.auth().signOut(),
        async startCheckout() {
            const token = await this.getToken();
            if (!token) throw new Error('not_signed_in');
            const resp = await fetch('/api/create-checkout-session', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
            });
            const data = await resp.json();
            if (data.alreadyPaid) { await this.refresh(); return; }
            if (data.url) window.location.href = data.url;
            else throw new Error(data.error || 'checkout_failed');
        },
        // Fetch wrapper for gated endpoints: attaches token, surfaces 401/402 as typed errors.
        async authedFetch(url, options = {}) {
            const token = await this.getToken();
            const headers = Object.assign({}, options.headers || {});
            if (token) headers.Authorization = `Bearer ${token}`;
            const resp = await fetch(url, Object.assign({}, options, { headers }));
            if (resp.status === 401) throw Object.assign(new Error('auth_required'), { code: 'auth_required' });
            if (resp.status === 402) throw Object.assign(new Error('payment_required'), { code: 'payment_required' });
            return resp;
        },
    };
})();
```

**Step 3:** In `index.html` add before the existing inline `<script>` (find the first `<script>` after `<body>` content; place these at the end of `<head>` or just before it):
```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="/js/firebase-config.js"></script>
<script src="/js/auth.js"></script>
```

**Step 4: Verify** — boot server, load page, check DevTools console has no errors and `window.RMDAuth.isConfigured()` returns `false` (placeholder config). App must still fully work signed-out for free modes. (Use playwright/webapp-testing or curl for HTML presence: `curl -s localhost:3456/ | grep -c firebase-auth-compat` → 1.)

**Step 5:** Commit: `feat: add firebase client auth service and config placeholder`

---

### Task 7: Frontend — sidebar auth widget + upgrade modal + rebrand

**Files:**
- Modify: `index.html`

**Step 1: Rebrand.** Update `<title>` and main header to `RateMyDutch — A2 Inburgering Practice` (find current title/h1; keep the 🇳🇱 flavor).

**Step 2: Auth widget.** Add a fixed-position account area in the app header/top bar (NOT inside `#exam-sidebar`, which is re-rendered per-mode by module scripts). Signed-out: "Sign in" button. Signed-in: email, PRO badge if paid or "Upgrade €24" button, "Sign out". Driven by `RMDAuth.onChange`. When `!RMDAuth.isConfigured()`, hide the widget entirely (app works as before — important pre-Firebase-setup).

**Step 3: Auth modal.** Sign-in modal with: "Continue with Google" button, divider, email+password fields with Sign in / Create account / Forgot password. Wire to `RMDAuth` methods; show error messages from Firebase (`err.message`).

**Step 4: Upgrade modal.** Reusable `showUpgradeModal()`: what's included (AI writing grading, speech transcription + AI speaking grading, all practice exams), price €24 one-time, "Unlock with Stripe" button → `RMDAuth.startCheckout()`. If signed out, button opens the sign-in modal first. Style consistent with the app's existing modal/card CSS.

**Step 5: Checkout return handling.** On page load, check `location.search`:
- `?checkout=success` → poll `RMDAuth.refresh()` every 1.5s up to 10 times until `isPaid()` (webhook race), show success toast "You're in! AI grading unlocked 🎉", then `history.replaceState` to clean the URL.
- `?checkout=cancelled` → clean URL, no-op (optionally a subtle toast).

**Step 6: Lock badges.** Show a 🔒 on the Schrijven and Spreken mode buttons when `RMDAuth.isConfigured() && !RMDAuth.isPaid()`; update reactively via `onChange`. Clicking a locked mode still enters it (free browsing of exercises) — only grading is gated.

**Step 7: Verify** in browser (playwright or manual): app loads, no console errors, widget hidden with placeholder config. Temporarily set a fake real-looking config value to confirm the widget renders, then revert.

**Step 8:** Commit: `feat: add auth widget, upgrade modal, checkout return handling, RateMyDutch rebrand`

---

### Task 8: Frontend — attach tokens at the 3 AI call sites + 402 handling

**Files:**
- Modify: `index.html:2902` (grade-writing fetch, inside inline schrijven JS)
- Modify: `public/js/spreken.js:196` (transcribe-speech fetch)
- Modify: `public/js/spreken.js:220` (grade-speaking fetch)

**Step 1:** Replace each `fetch('/api/...', opts)` with `window.RMDAuth.authedFetch('/api/...', opts)` and wrap the call site so that a thrown `{code:'payment_required'}` → `showUpgradeModal()` and `{code:'auth_required'}` → sign-in modal, instead of the generic error path. Keep existing behavior for other errors. `spreken.js` is an ES module — reference `window.RMDAuth` (guard: if `!window.RMDAuth || !RMDAuth.isConfigured()`, fall back to plain `fetch` so local dev without Firebase still works).

**Step 2:** In spreken flow, gate before recording UX cost: on "get graded" action the 402 surfaces after transcription attempt — acceptable; server rejects at transcribe step already (first authedFetch).

**Step 3: Verify** — with server running WITHOUT Firebase env: free modes work; schrijven "Check my writing" triggers upgrade/sign-in path (server returns 401; with placeholder config client falls back to plain fetch → 401 → sign-in modal or graceful error message; confirm no unhandled promise rejections in console).

**Step 4:** Commit: `feat: attach auth tokens to AI grading calls with 402 upgrade flow`

---

### Task 9: Firestore rules + owner setup runbook + docs

**Files:**
- Create: `firestore.rules`
- Create: `docs/SETUP-PAYWALL.md`
- Modify: `CLAUDE.md` (env var table + architecture note)

**Step 1:** `firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entitlements/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false; // server-only via Admin SDK
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Step 2:** `docs/SETUP-PAYWALL.md` — step-by-step owner runbook:
1. Create Firebase project (console.firebase.google.com) → enable Auth providers Google + Email/Password → create Firestore (production mode, eur3) → paste `firestore.rules` → Project settings: add web app, copy config into `public/js/firebase-config.js` → Service accounts: generate private key, minify JSON to one line for `FIREBASE_SERVICE_ACCOUNT`.
2. Create Stripe account (stripe.com) → in TEST mode create Product "RateMyDutch — Lifetime access", one-time price €24 → copy price ID (`price_...`) → Developers > API keys: `sk_test_...`.
3. Local testing: `stripe listen --forward-to localhost:3456/api/stripe-webhook` (gives `whsec_...`), run server with all env vars, buy with card `4242 4242 4242 4242`, verify entitlement doc appears and grading unlocks.
4. Vercel: add env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `FIREBASE_SERVICE_ACCOUNT`, existing AI keys); add production webhook endpoint in Stripe dashboard pointing to `https://<domain>/api/stripe-webhook` (event: `checkout.session.completed`), use its signing secret.
5. Add the Vercel domain to Firebase Auth authorized domains.
6. Go live: complete Stripe KYC, switch to live keys + live price + live webhook secret in Vercel, redeploy.

**Step 3:** Update `CLAUDE.md` env table with the 4 new vars + one paragraph on the paywall architecture (lib/paywall.js, lib/stripe-webhook.js, lib/firebase.js, gated endpoints, free vs paid split).

**Step 4:** Commit: `docs: add firestore rules, paywall setup runbook, CLAUDE.md updates`

---

### Task 10: Final verification sweep

**Step 1:** `npm test` → all green.
**Step 2:** Boot server with no new env vars → app serves, free modes work end-to-end (load lezen/luisteren/knm data), gated endpoints return 401, webhook returns 500 stripe_not_configured, no console errors on page load.
**Step 3:** Grep for leaks: no secret values committed; `git diff main --stat` review.
**Step 4:** Update the design doc status line if anything diverged.
**Step 5:** Commit any fixes; branch ready for review/merge.

---

## Verification reference

| Check | Command | Expect |
|---|---|---|
| Unit tests | `npm test` | all pass |
| Free page | `curl -s -o /dev/null -w "%{http_code}" localhost:3456/` | 200 |
| Gated (anon) | `curl -s -X POST localhost:3456/api/grade-writing -H 'Content-Type: application/json' -d '{"userText":"x"}' -w "\n%{http_code}"` | 401 |
| Webhook unconfigured | `curl -s -X POST localhost:3456/api/stripe-webhook -d '{}' -w "\n%{http_code}"` | 500 |
| Static data | `curl -s -o /dev/null -w "%{http_code}" localhost:3456/data/knm-exercises.json` | 200 |
