// public/js/auth.js — the practice app's half of the one-tap upgrade:
// startCheckout() request/analytics/navigation contract and the
// redirect-vs-popup Google sign-in that carries a pending €24 intent.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AUTH = fs.readFileSync(path.join(__dirname, '../public/js/auth.js'), 'utf8');
const FLOW = fs.readFileSync(path.join(__dirname, '../public/js/checkout-flow.js'), 'utf8');
const MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function storage(init = {}) {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function load({ ua = DESKTOP, checkout = { success: true, url: 'https://checkout.stripe.com/x', currency: 'eur', locale: 'nl', country: 'NL' }, popupError = null } = {}) {
    const log = [];
    let href = 'https://ratemydutch.com/#schrijven';
    const authState = { cb: null, user: null };
    const auth = {
        onAuthStateChanged(cb) { authState.cb = cb; },
        getRedirectResult: async () => null,
        signInWithRedirect: async () => log.push(['redirect', href]),
        signInWithPopup: async () => { log.push(['popup']); if (popupError) throw popupError; return { user: {} }; },
    };
    const firebase = { initializeApp() {}, auth: () => auth };
    firebase.auth.GoogleAuthProvider = function () {};
    const ctx = {
        firebase, FIREBASE_CONFIG: { apiKey: 'k' },
        navigator: { userAgent: ua, language: 'nl-NL' },
        localStorage: storage({ 'rmd-scorecard-sid': 'sub-9', 'rmd-anon-id': 'a-9' }),
        sessionStorage: storage(),
        URL, URLSearchParams, JSON, Object, Promise, Date, console,
        setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
        history: { state: null, replaceState(_s, _t, next) { href = new URL(next, href).href; } },
        fetch: async (url, opts) => {
            log.push(['fetch', url, opts && opts.body ? JSON.parse(opts.body) : null]);
            if (url === '/api/me') return { json: async () => ({ paid: false }) };
            return { json: async () => checkout };
        },
        rmdAnalytics: {
            BEACON: { send_instantly: true, transport: 'sendBeacon' },
            capture: (n, p, o) => log.push(['capture', n, p, o]),
            checkoutContext: () => ({ analyticsConsent: true, phDistinctId: 'ph-9' }),
        },
    };
    Object.defineProperty(ctx, 'location', { value: {
        get href() { return href; }, set href(v) { log.push(['navigate', v]); },
        get search() { return new URL(href).search; }, get pathname() { return new URL(href).pathname; },
        get hash() { return new URL(href).hash; },
    } });
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(FLOW, ctx);
    vm.runInContext(AUTH, ctx);
    return { ctx, log, auth: ctx.RMDAuth, signIn: async (user) => { authState.user = user; await authState.cb(user); }, href: () => href };
}

test('startCheckout: funnel fields + consent context sent, checkout_opened beaconed before navigating', async () => {
    const { auth, log, signIn } = load();
    await signIn({ getIdToken: async () => 'tok' });
    const out = await auth.startCheckout({ via: 'header_button', afterSignIn: true, resumed: true });
    assert.equal(out, 'redirected');
    const steps = log.filter((e) => e[1] !== '/api/me').map((e) => e[0] === 'capture' ? e[1] : e[0]);
    assert.deepEqual(steps, ['fetch', 'checkout_opened', 'navigate']);
    const body = log.find((e) => e[1] === '/api/create-checkout-session')[2];
    assert.equal(body.via, 'header_button');
    assert.equal(body.locale, 'nl');
    assert.equal(body.subscriberId, 'sub-9');
    assert.equal(body.anonId, 'a-9');
    assert.equal(body.analyticsConsent, true);
    assert.equal(body.phDistinctId, 'ph-9');
    const cap = log.find((e) => e[1] === 'checkout_opened');
    assert.equal(cap[2].surface, 'app');
    assert.equal(cap[2].via, 'header_button');
    assert.equal(cap[2].resumed, true);
    assert.equal(cap[3].transport, 'sendBeacon');
});

test('startCheckout: already paid → no navigation; error → throws with the server code', async () => {
    let { auth, log, signIn } = load({ checkout: { success: true, alreadyPaid: true } });
    await signIn({ getIdToken: async () => 'tok' });
    assert.equal(await auth.startCheckout(), 'already_paid');
    assert.ok(!log.some((e) => e[0] === 'navigate'));

    ({ auth, log, signIn } = load({ checkout: { success: false, error: 'stripe_not_configured' } }));
    await signIn({ getIdToken: async () => 'tok' });
    await assert.rejects(auth.startCheckout(), (err) => err.code === 'stripe_not_configured');
    assert.ok(!log.some((e) => e[1] === 'checkout_opened'));
});

test('startCheckout while signed out throws not_signed_in without calling the API', async () => {
    const { auth, log } = load();
    await assert.rejects(auth.startCheckout(), (err) => err.code === 'not_signed_in');
    assert.ok(!log.some((e) => e[1] === '/api/create-checkout-session'));
});

test('signInGoogle on a phone: full-page redirect, pending €24 intent marked on the URL first', async () => {
    const { auth, ctx, log } = load({ ua: MOBILE });
    ctx.RMDCheckout.save({ surface: 'app', via: 'upgrade_modal' });
    assert.equal(await auth.signInGoogle(), null);
    const r = log.find((e) => e[0] === 'redirect');
    assert.ok(r);
    assert.ok(!log.some((e) => e[0] === 'popup'));
    const url = new URL(r[1]);
    assert.equal(url.searchParams.get('checkout_intent'), '1');
    assert.equal(url.hash, '#schrijven');
});

test('signInGoogle on desktop: popup; a blocked popup falls back to redirect', async () => {
    let { auth, log } = load();
    await auth.signInGoogle();
    assert.deepEqual(log.map((e) => e[0]), ['popup']);

    ({ auth, log } = load({ popupError: Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }) }));
    assert.equal(await auth.signInGoogle(), null);
    assert.deepEqual(log.map((e) => e[0]), ['popup', 'redirect']);
});
