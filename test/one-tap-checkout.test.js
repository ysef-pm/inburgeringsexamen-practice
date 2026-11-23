// One-tap €24 upgrade on the scorecard (public/js/inline-practice.js): the
// real ES module runs against a minimal fake DOM + fake Firebase, through its
// public entry point renderInlinePractice() and real button clicks.
// node --test runs each file in its own process, so these globals are local.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const EXERCISES = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/scorecard-inline.json'), 'utf8'));
const MOBILE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const STRIPE_URL = 'https://checkout.stripe.com/c/pay/cs_test_123';

// ---------- minimal fake DOM ----------
// Elements with an id/class in an HTML string become flat children of the
// element the HTML was written into; enough for getElementById/querySelector.
class El {
    constructor(tag = 'div', attrs = {}) {
        this.tagName = tag.toUpperCase();
        this.id = attrs.id || '';
        this.className = attrs.class || '';
        this.value = attrs.value || '';
        this._text = attrs.text || '';
        this._html = '';
        this.children = [];
        this.parent = null;
        this.style = {};
        this.attrs = {};
        this.disabled = false;
        this.offsetParent = {};
        this.listeners = {};
        this.onclick = null;
        this.onsubmit = null;
    }
    get textContent() { return this._text; }
    set textContent(t) { this._text = String(t); }
    get innerHTML() { return this._html; }
    set innerHTML(h) { this._html = h; this.children.forEach((c) => { c.parent = null; }); this.children = []; this._adopt(parse(h)); }
    insertAdjacentHTML(_pos, h) { this._html += h; this._adopt(parse(h)); }
    _adopt(list) { list.forEach((c) => { c.parent = this; this.children.push(c); }); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; this.removed = true; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
    querySelector(sel) {
        for (const el of this.walk()) {
            if (sel.startsWith('#') && el.id === sel.slice(1)) return el;
            if (sel.startsWith('.') && el.className.split(/\s+/).includes(sel.slice(1))) return el;
        }
        return null;
    }
    click() {
        const ev = { target: this, currentTarget: this, preventDefault() {} };
        if (this.onclick) return this.onclick(ev);
        (this.listeners.click || []).forEach((fn) => fn(ev));
    }
    submit() { return this.onsubmit && this.onsubmit({ preventDefault() {} }); }
}
function parse(html) {
    const out = [];
    const re = /<(\w+)([^>]*)>([^<]*)/g;
    let m;
    while ((m = re.exec(html))) {
        const attr = (n) => { const a = m[2].match(new RegExp(`\\b${n}="([^"]*)"`)); return a ? a[1] : ''; };
        if (!attr('id') && !attr('class')) continue;
        out.push(new El(m[1], { id: attr('id'), class: attr('class'), value: attr('value'), text: m[3].trim() }));
    }
    return out;
}

// ---------- environment ----------
const env = {};
function storage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k), clear: () => m.clear(), _m: m };
}
function define(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function makeFirebase() {
    const auth = {
        currentUser: null,
        redirectResult: null,
        redirectError: null,
        onAuthStateChanged(cb) { Promise.resolve().then(() => cb(auth.currentUser)); return () => {}; },
        async signInWithCustomToken(token) { env.log.push(['customToken', token]); auth.currentUser = fakeUser('u-session'); },
        async signInWithRedirect() { env.log.push(['signInWithRedirect', location.href]); },
        async signInWithPopup() { env.log.push(['signInWithPopup']); auth.currentUser = fakeUser('u-popup'); return { user: auth.currentUser }; },
        async getRedirectResult() {
            if (auth.redirectError) throw auth.redirectError;
            return auth.redirectResult;
        },
        async createUserWithEmailAndPassword() { auth.currentUser = fakeUser('u-email'); return { user: auth.currentUser }; },
        async signInWithEmailAndPassword() { auth.currentUser = fakeUser('u-email'); return { user: auth.currentUser }; },
    };
    const fb = { apps: [], initializeApp() { fb.apps.push({}); }, auth: () => auth };
    fb.auth.GoogleAuthProvider = class {};
    return fb;
}
function fakeUser(uid) { return { uid, getIdToken: async () => `tok-${uid}` }; }

function setup({ ua = MOBILE_SAFARI, url = 'https://ratemydutch.com/scorecard', signedIn = false,
    sid = 'sub-1', sessionAuth = { token: 'custom-1' }, checkout = { success: true, url: STRIPE_URL, currency: 'eur', locale: 'auto', country: 'NL' } } = {}) {
    env.log = [];
    env.navigatedTo = undefined;
    env.tracked = [];
    env.alerts = [];
    env.fetches = [];
    env.loc = new URL(url);
    env.checkoutResponse = checkout;
    env.sessionAuthResponse = sessionAuth;

    const body = new El('body');
    const document = {
        body,
        getElementById: (id) => { for (const el of body.walk()) if (el.id === id) return el; return null; },
        createElement: (tag) => new El(tag),
    };
    define('document', document);
    define('navigator', { userAgent: ua, language: 'en-US' });
    define('localStorage', storage());
    define('sessionStorage', storage());
    define('location', {
        get href() { return env.loc.href; },
        set href(v) { env.log.push(['navigate', v]); env.navigatedTo = v; },
        get search() { return env.loc.search; }, get pathname() { return env.loc.pathname; }, get hash() { return env.loc.hash; },
    });
    define('history', { state: null, replaceState(_s, _t, next) { env.loc = new URL(next, env.loc.href); } });
    define('alert', (m) => env.alerts.push(m));
    define('firebase', makeFirebase());
    define('FIREBASE_CONFIG', { apiKey: 'test' });
    if (signedIn) firebase.auth().currentUser = fakeUser('u-1');
    if (sid) localStorage.setItem('rmd-scorecard-sid', sid);
    localStorage.setItem('rmd-anon-id', 'a-1');

    define('fetch', async (url, opts = {}) => {
        env.fetches.push({ url, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
        const json = (data) => ({ ok: true, status: 200, json: async () => data });
        if (url === '/data/scorecard-inline.json') return json(EXERCISES);
        if (url === '/api/scorecard/session-auth') return json(env.sessionAuthResponse);
        if (url === '/api/create-checkout-session') {
            env.log.push(['create-checkout-session']);
            return json(env.checkoutResponse);
        }
        if (url === '/api/scorecard/subscribe') return json({ success: true, subscriberId: 'sub-new' });
        throw new Error('unexpected fetch ' + url);
    });
    window.rmdAnalytics = {
        BEACON: { send_instantly: true, transport: 'sendBeacon' },
        capture: (name, props, options) => env.log.push(['capture', name, props, options]),
        checkoutContext: () => ({ analyticsConsent: true, phDistinctId: 'ph-1', firstTouch: { utm_source: 'instagram' } }),
        identify() {},
    };
    // The real helper, loaded fresh against these globals.
    delete require.cache[require.resolve('../public/js/checkout-flow.js')];
    require('../public/js/checkout-flow.js');
    mod.initInlinePractice((name, props) => env.tracked.push([name, props]));
    const container = new El('div', { id: 'inline-practice' });
    body.appendChild(container);
    return { container, body };
}

const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }
const tracked = (name) => env.tracked.filter(([n]) => n === name).map(([, p]) => p);
const captured = (name) => env.log.filter((e) => e[0] === 'capture' && e[1] === name);

let mod;
define('window', globalThis);
define('addEventListener', () => {});
beforeEach(async () => {
    if (!mod) mod = await import(pathToFileURL(path.join(ROOT, 'public/js/inline-practice.js')).href);
});

function paywalledState(extra = {}) {
    localStorage.setItem('rmd-inline-state', JSON.stringify({ focus: 'writing', stage: 'paywalled', ...extra }));
}

test('signed in: one tap on €24 → create session → checkout_opened (beacon) → Stripe, button stays busy', async () => {
    const { container } = setup({ signedIn: true });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    const btn = document.getElementById('paywall-btn');
    assert.ok(btn, 'paywall rendered');
    assert.equal(tracked('paywall_viewed').length, 1);

    btn.click();
    await settle();

    const order = env.log.map((e) => (e[0] === 'capture' ? `capture:${e[1]}` : e[0]));
    assert.deepEqual(order, ['create-checkout-session', 'capture:checkout_opened', 'navigate']);
    assert.equal(env.navigatedTo, STRIPE_URL);
    const [, , props, options] = captured('checkout_opened')[0];
    assert.equal(props.via, 'card');
    assert.equal(props.focus, 'writing');
    assert.equal(props.resumed, false);
    assert.deepEqual(options, window.rmdAnalytics.BEACON, 'sent with the sendBeacon transport');
    // Checkout context (consent + PostHog id) reaches the server for purchase_completed.
    const req = env.fetches.find((f) => f.url === '/api/create-checkout-session');
    assert.equal(req.body.analyticsConsent, true);
    assert.equal(req.body.phDistinctId, 'ph-1');
    assert.equal(req.body.returnTo, '/scorecard');
    assert.equal(req.headers.Authorization, 'Bearer tok-u-1');
    // No modal/sheet, and the button is not re-enabled mid-redirect.
    assert.equal(document.getElementById('rmd-sheet'), null);
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Opening secure checkout…');
    assert.equal(JSON.parse(localStorage.getItem('rmd-inline-state')).stage, 'checkout');
});

test('signed out with the Q3 email: silent session, then straight to Stripe — still one tap, no sheet', async () => {
    const { container } = setup({ signedIn: false, ua: INSTAGRAM });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    document.getElementById('paywall-btn').click();
    await settle();

    assert.equal(document.getElementById('rmd-sheet'), null, 'no sign-in sheet');
    assert.deepEqual(env.log.map((e) => e[0] === 'capture' ? e[1] : e[0]),
        ['customToken', 'create-checkout-session', 'checkout_opened', 'navigate']);
    assert.equal(env.navigatedTo, STRIPE_URL);
    assert.equal(captured('checkout_opened')[0][2].after_sign_in, true);
    assert.equal(captured('checkout_opened')[0][2].in_app_browser, true);
    assert.equal(tracked('signup_completed')[0].method, 'session');
    assert.equal(tracked('signup_completed')[0].purpose, 'checkout');
    assert.equal(window.RMDCheckout.peek(), null, 'intent fulfilled and cleared');
});

test('sticky bar tap goes the same one-tap way with via=sticky', async () => {
    const { container } = setup({ signedIn: true });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    document.getElementById('unlock-bar-btn').click();
    await settle();
    assert.equal(env.navigatedTo, STRIPE_URL);
    assert.equal(captured('checkout_opened')[0][2].via, 'sticky');
    assert.equal(env.fetches.find((f) => f.url === '/api/create-checkout-session').body.via, 'sticky');
});

test('existing account on mobile Safari: sheet → Google redirect carries the intent → back signed in → checkout with no second tap', async () => {
    // Leg 1: the €24 tap.
    let { container } = setup({ signedIn: false, sessionAuth: { success: true, requiresSignIn: true } });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    const btn = document.getElementById('paywall-btn');
    btn.click();
    await settle();

    const sheetEl = document.getElementById('rmd-sheet');
    assert.ok(sheetEl, 'sign-in sheet shown for an existing account');
    assert.equal(btn.disabled, false, 'button recovers while the sheet is up');
    assert.equal(tracked('signup_sheet_shown')[0].purpose, 'checkout');
    assert.equal(window.RMDCheckout.peek().surface, 'scorecard');

    sheetEl.querySelector('#sheet-google').click();
    await settle();
    const redirect = env.log.find((e) => e[0] === 'signInWithRedirect');
    assert.ok(redirect, 'mobile goes straight to the full-page redirect, no popup');
    assert.ok(!env.log.some((e) => e[0] === 'signInWithPopup'));
    assert.equal(new URL(redirect[1]).searchParams.get('checkout_intent'), '1', 'URL marked before leaving');
    assert.equal(JSON.parse(localStorage.getItem('rmd-inline-state')).pendingRedirect, true);
    assert.ok(!env.log.some((e) => e[0] === 'create-checkout-session'));

    // Leg 2: Google sends the visitor back to the marked URL, now signed in.
    const keepLocal = localStorage; const keepSession = sessionStorage; const backUrl = redirect[1];
    ({ container } = setup({ signedIn: false, url: backUrl, sid: null }));
    define('localStorage', keepLocal); define('sessionStorage', keepSession);
    firebase.auth().currentUser = fakeUser('u-google');
    firebase.auth().redirectResult = { user: firebase.auth().currentUser };
    await mod.renderInlinePractice(container, 'writing');
    await settle();

    assert.equal(env.navigatedTo, STRIPE_URL, 'checkout resumed by itself');
    const opened = captured('checkout_opened');
    assert.equal(opened.length, 1);
    assert.equal(opened[0][2].resumed, true);
    assert.equal(opened[0][2].after_sign_in, true);
    assert.deepEqual(tracked('signup_completed')[0], { focus: 'writing', method: 'google', redirect: true });
    assert.equal(window.RMDCheckout.peek(), null, 'intent consumed');
    assert.equal(new URL(location.href).searchParams.get('checkout_intent'), null, 'URL cleaned');
});

test('existing account on desktop: popup sign-in continues straight into checkout', async () => {
    const { container } = setup({ ua: DESKTOP, signedIn: false, sessionAuth: { success: true, requiresSignIn: true } });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    document.getElementById('paywall-btn').click();
    await settle();
    document.getElementById('rmd-sheet').querySelector('#sheet-google').click();
    await settle();
    assert.ok(env.log.some((e) => e[0] === 'signInWithPopup'));
    assert.equal(document.getElementById('rmd-sheet'), null, 'sheet closed');
    assert.equal(env.navigatedTo, STRIPE_URL);
});

test('Instagram WebView + existing account: no Google button, email sign-in continues into checkout', async () => {
    const { container } = setup({ ua: INSTAGRAM, signedIn: false, sessionAuth: { success: true, requiresSignIn: true } });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    document.getElementById('paywall-btn').click();
    await settle();
    const sheetEl = document.getElementById('rmd-sheet');
    assert.equal(sheetEl.querySelector('#sheet-google'), null, 'Google is blocked in WebViews');
    assert.equal(sheetEl.querySelector('#sheet-email-btn').textContent, 'Sign in and continue to checkout');
    await sheetEl.querySelector('#sheet-email-form').submit();
    await settle();
    assert.equal(env.navigatedTo, STRIPE_URL);
    assert.equal(captured('checkout_opened')[0][2].after_sign_in, true);
});

test('"Not now" on the sheet drops the intent: a later sign-in does not open checkout', async () => {
    const { container } = setup({ signedIn: false, sessionAuth: { success: true, requiresSignIn: true } });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    const btn = document.getElementById('paywall-btn');
    btn.click();
    await settle();
    document.getElementById('rmd-sheet').querySelector('#sheet-close').click();
    assert.equal(document.getElementById('rmd-sheet'), null);
    assert.equal(window.RMDCheckout.peek(), null);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Unlock everything — €24 once');
});

test('back from a cancelled/failed Google redirect: no checkout, intent dropped, paywall stays', async () => {
    const { container } = setup({ signedIn: false, url: 'https://ratemydutch.com/scorecard?checkout_intent=1', sid: null });
    paywalledState({ pendingRedirect: true });
    window.RMDCheckout.save({ surface: 'scorecard', focus: 'writing', via: 'card' });
    firebase.auth().redirectError = Object.assign(new Error('cancelled'), { code: 'auth/user-cancelled' });
    await mod.renderInlinePractice(container, 'writing');
    await settle();
    assert.ok(!env.log.some((e) => e[0] === 'create-checkout-session'));
    assert.equal(window.RMDCheckout.peek(), null);
    assert.ok(document.getElementById('paywall-btn'));
    assert.match(document.getElementById('paywall-error').textContent, /Sign-in did not finish/);
    assert.equal(tracked('signup_failed')[0].redirect, true);
});

test('checkout API failure: button recovers, inline error, checkout_failed tracked, no navigation', async () => {
    const { container } = setup({ signedIn: true, checkout: { success: false, error: 'checkout_failed' } });
    paywalledState();
    await mod.renderInlinePractice(container, 'writing');
    const btn = document.getElementById('paywall-btn');
    btn.click();
    await settle();
    assert.equal(env.navigatedTo, undefined);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Unlock everything — €24 once');
    assert.match(document.getElementById('paywall-error').textContent, /Could not open secure checkout/);
    assert.equal(tracked('checkout_failed')[0].code, 'checkout_failed');
    assert.equal(captured('checkout_opened').length, 0, 'checkout_opened only fires once a session exists');
    assert.equal(env.alerts.length, 0);
});

test('reload after an MCQ warm-up shows the score + paywall, not question 1 again', async () => {
    const { container } = setup({ signedIn: true });
    localStorage.setItem('rmd-inline-state', JSON.stringify({ focus: 'reading', stage: 'graded', mcqScore: 2 }));
    await mod.renderInlinePractice(container, 'reading');
    assert.ok(container.querySelector('#paywall-btn'), 'paywall shown');
    assert.equal(container.querySelector('#inline-options'), null, 'quiz not restarted');
    assert.equal(tracked('inline_question_shown').length, 0);
});

test('desktop: closing the Google popup during a €24 tap cancels — no redirect, no checkout', async () => {
    const { container } = setup({ ua: DESKTOP, signedIn: false, sessionAuth: { success: true, requiresSignIn: true } });
    paywalledState();
    firebase.auth().signInWithPopup = async () => {
        throw Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    };
    await mod.renderInlinePractice(container, 'writing');
    document.getElementById('paywall-btn').click();
    await settle();
    document.getElementById('rmd-sheet').querySelector('#sheet-google').click();
    await settle();
    assert.ok(!env.log.some((e) => e[0] === 'signInWithRedirect'));
    assert.ok(!env.log.some((e) => e[0] === 'create-checkout-session'));
});

test('the scorecard leaves an app-surface intent alone on a fresh exercise', async () => {
    const { container } = setup({ signedIn: true });
    window.RMDCheckout.save({ surface: 'app', via: 'upgrade_modal' });
    await mod.renderInlinePractice(container, 'writing');
    assert.equal(window.RMDCheckout.peek().surface, 'app');
});

test('a stale intent from another surface never fires on the scorecard', async () => {
    const { container } = setup({ signedIn: true });
    paywalledState();
    window.RMDCheckout.save({ surface: 'app', via: 'upgrade_modal' });
    await mod.renderInlinePractice(container, 'writing');
    await settle();
    assert.ok(!env.log.some((e) => e[0] === 'create-checkout-session'));
});
