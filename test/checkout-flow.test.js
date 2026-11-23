// public/js/checkout-flow.js — pending-checkout intent, in-app browser
// detection, and the button busy/recover contract. Runs the real file in a vm.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/checkout-flow.js'), 'utf8');

const UA = {
    instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; nl_NL)',
    facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
    facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0;]',
    mobileSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

function storage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k), _m: m };
}

function load({ url = 'https://ratemydutch.com/scorecard', ua = UA.desktopChrome, now = 1_000_000 } = {}) {
    const listeners = {};
    const timers = [];
    const loc = new URL(url);
    const location = {
        get href() { return loc.href; }, get search() { return loc.search; },
        get pathname() { return loc.pathname; }, get hash() { return loc.hash; },
    };
    const history = { state: null, replaceState(_s, _t, next) { const u = new URL(next, loc.href); loc.href = u.href; } };
    const clock = { now };
    const ctx = {
        location, history, navigator: { userAgent: ua },
        localStorage: storage(), sessionStorage: storage(),
        URL, URLSearchParams, JSON, Object,
        Date: { now: () => clock.now },
        setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
        clearTimeout: (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { C: ctx.RMDCheckout, ctx, listeners, timers, clock, loc };
}

function button(text) {
    return { textContent: text, disabled: false, attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
}

test('in-app browser detection: Instagram/Facebook WebViews yes, Safari/Chrome no', () => {
    const { C } = load();
    assert.equal(C.inAppBrowser(UA.instagramIos), true);
    assert.equal(C.inAppBrowser(UA.facebookIos), true);
    assert.equal(C.inAppBrowser(UA.facebookAndroid), true);
    assert.equal(C.inAppBrowser(UA.mobileSafari), false);
    assert.equal(C.inAppBrowser(UA.desktopChrome), false);
});

test('redirect sign-in is preferred on phones and in WebViews, popup on desktop', () => {
    const { C } = load();
    assert.equal(C.prefersRedirect(UA.instagramIos), true);
    assert.equal(C.prefersRedirect(UA.mobileSafari), true);
    assert.equal(C.prefersRedirect(UA.facebookAndroid), true);
    assert.equal(C.prefersRedirect(UA.desktopChrome), false);
    // Defaults to the page's own user agent.
    assert.equal(load({ ua: UA.instagramIos }).C.prefersRedirect(), true);
});

test('intent round-trips through storage and consume() is read-once', () => {
    const { C, ctx } = load();
    assert.equal(C.peek(), null);
    C.save({ surface: 'scorecard', focus: 'writing', via: 'card', ignored: undefined });
    const rec = C.peek();
    assert.equal(rec.surface, 'scorecard');
    assert.equal(rec.focus, 'writing');
    assert.ok(!('ignored' in rec));
    // Written to both storages — a WebView may wipe one of them.
    assert.ok(ctx.localStorage.getItem(C.KEY));
    assert.ok(ctx.sessionStorage.getItem(C.KEY));
    assert.equal(C.consume().via, 'card');
    assert.equal(C.peek(), null);
    assert.equal(C.consume(), null);
});

test('a stale intent expires and never resumes a checkout', () => {
    const { C, clock } = load();
    C.save({ surface: 'scorecard' });
    clock.now += C.INTENT_TTL_MS + 1;
    assert.equal(C.peek(), null);
});

test('markForRedirect puts checkout_intent=1 on the URL (hash kept); consume strips it', () => {
    const { C, loc } = load({ url: 'https://ratemydutch.com/?src=scorecard#schrijven' });
    C.markForRedirect({ surface: 'app', via: 'upgrade_modal' });
    assert.equal(new URL(loc.href).searchParams.get('checkout_intent'), '1');
    assert.equal(new URL(loc.href).searchParams.get('src'), 'scorecard');
    assert.equal(new URL(loc.href).hash, '#schrijven');
    C.consume();
    assert.equal(new URL(loc.href).searchParams.get('checkout_intent'), null);
    assert.equal(new URL(loc.href).hash, '#schrijven');
});

test('a shared/bookmarked link with checkout_intent=1 does nothing when storage works', () => {
    const { C } = load({ url: 'https://ratemydutch.com/?checkout_intent=1' });
    assert.equal(C.peek(), null);
});

test('URL marker alone counts only when this browser cannot store anything', () => {
    const { C, ctx } = load({ url: 'https://ratemydutch.com/scorecard?checkout_intent=1' });
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    ctx.localStorage = blocked; ctx.sessionStorage = blocked;
    assert.deepEqual({ ...C.peek() }, { fromUrl: true });
    assert.deepEqual({ ...C.consume() }, { fromUrl: true });
    assert.equal(C.peek(), null);
});

test('busy(): label + disabled, restore() puts the button back', () => {
    const { C } = load();
    const btn = button('Unlock everything — €24 once');
    const restore = C.busy(btn);
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Opening secure checkout…');
    assert.equal(btn.attrs['aria-busy'], 'true');
    // A second busy() on the same button is the same handle, not a nested one
    // (that would "restore" to the busy label).
    assert.equal(C.busy(btn), restore);
    restore();
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Unlock everything — €24 once');
    assert.equal(btn.attrs['aria-busy'], undefined);
});

test('back/forward cache return (pageshow persisted) recovers a stuck button', () => {
    const { C, listeners } = load();
    const btn = button('Unlock — €24 once');
    C.busy(btn);
    listeners.pageshow.forEach((fn) => fn({ persisted: false }));
    assert.equal(btn.disabled, true, 'a normal pageshow leaves it alone');
    listeners.pageshow.forEach((fn) => fn({ persisted: true }));
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Unlock — €24 once');
});

test('a redirect that never leaves the page times out back to a tappable button', () => {
    const { C, timers } = load();
    const btn = button('Unlock — €24 once');
    C.busy(btn);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, C.BUSY_TIMEOUT_MS);
    timers[0].fn();
    assert.equal(btn.disabled, false);
});

test('friendlyError maps server codes and network errors to readable copy', () => {
    const { C } = load();
    assert.match(C.friendlyError({ code: 'checkout_failed' }), /secure checkout/);
    assert.match(C.friendlyError(new Error('stripe_not_configured')), /temporarily unavailable/);
    assert.match(C.friendlyError(Object.assign(new TypeError('Failed to fetch'))), /Connection problem/);
    assert.equal(C.friendlyError(new Error('Custom message')), 'Custom message');
});
