// public/js/analytics.js — consent-aware buffer + first-touch attribution.
// Runs the real file in a vm against a fake PostHog SDK (the snippet sees
// window.posthog.__SV and leaves it alone, so init() hits the fake).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/analytics.js'), 'utf8');

function storage(initial = {}) {
    const m = new Map(Object.entries(initial));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k), _m: m };
}

function fakeDom() {
    const els = {};
    return {
        readyState: 'complete',
        addEventListener() {},
        createElement() {
            const el = { setAttribute() {}, remove() { el.removed = true; } };
            Object.defineProperty(el, 'innerHTML', { set() {
                els['rmd-consent-accept'] = { onclick: null };
                els['rmd-consent-decline'] = { onclick: null };
            } });
            return el;
        },
        getElementById: (id) => els[id] || null,
        body: { appendChild() {} },
        els,
    };
}

function load({ url = 'https://ratemydutch.com/', consent = 'pending', local = {}, autoLoad = true } = {}) {
    const calls = [];
    const u = new URL(url);
    let initConfig;
    const sdk = {
        __SV: 1,
        _consent: consent,
        init(key, cfg) { initConfig = cfg; },
        capture: (...a) => calls.push(['capture', ...a]),
        identify: (id) => calls.push(['identify', id]),
        register: (p) => calls.push(['register', p]),
        get_explicit_consent_status: () => sdk._consent,
        opt_in_capturing: () => { sdk._consent = 'granted'; calls.push(['opt_in']); },
        opt_out_capturing: () => { sdk._consent = 'denied'; calls.push(['opt_out']); },
        startSessionRecording: () => {},
        get_distinct_id: () => 'ph-distinct-1',
    };
    const document = fakeDom();
    const window = { posthog: sdk };
    const ctx = {
        window, document, posthog: sdk,
        location: { search: u.search, hostname: u.hostname },
        localStorage: storage(local), sessionStorage: storage(),
        URLSearchParams, JSON, Date, Object,
    };
    window.window = window;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    const boot = () => initConfig.loaded(sdk);
    if (autoLoad) boot();
    return { sdk, calls, api: window.rmdAnalytics, document, ctx, initConfig, boot };
}

const captures = (calls) => calls.filter((c) => c[0] === 'capture');

test('consent pending: events are buffered, not sent (SDK would discard them)', () => {
    const { api, calls } = load();
    api.capture('scorecard_started', { a: 1 });
    assert.equal(captures(calls).length, 0);
});

test('accepting the banner flushes buffered events with original timestamps + identify', () => {
    const { api, calls, document } = load({
        url: 'https://ratemydutch.com/scorecard?utm_source=facebook&utm_campaign=c1&fbclid=FB1',
        local: { 'rmd-scorecard-sid': 'sid-42' },
    });
    api.capture('landing_viewed', {});
    api.capture('checkout_opened', { via: 'card' }, api.BEACON);
    api.identify('sid-42');
    document.els['rmd-consent-accept'].onclick();
    const sent = captures(calls);
    assert.deepEqual(sent.map((c) => c[1]), ['landing_viewed', 'checkout_opened']);
    assert.equal(sent[0][2].utm_source, 'facebook');
    assert.equal(sent[0][2].fbclid, 'FB1');
    assert.ok(sent[0][3].timestamp instanceof Date);
    assert.equal(sent[1][3].transport, 'sendBeacon');
    assert.ok(calls.some((c) => c[0] === 'identify' && c[1] === 'sid-42'));
    assert.ok(calls.some((c) => c[0] === 'register' && c[1].utm_campaign === 'c1'));
    // After consent, events go straight through.
    api.capture('paywall_viewed', { surface: 'app' });
    assert.equal(captures(calls).length, 3);
});

test('declining drops the buffer and nothing is ever sent', () => {
    const { api, calls, document } = load();
    api.capture('landing_viewed', {});
    api.identify('sid-1');
    document.els['rmd-consent-decline'].onclick();
    api.capture('scorecard_started', {});
    assert.equal(captures(calls).length, 0);
    assert.ok(!calls.some((c) => c[0] === 'identify'));
});

test('returning consented visitor: captures before SDK load are flushed on load', () => {
    const { api, calls, boot } = load({ consent: 'granted', autoLoad: false });
    api.capture('signup_completed', { method: 'google' });
    assert.equal(captures(calls).length, 0);
    boot();
    assert.deepEqual(captures(calls).map((c) => c[1]), ['signup_completed']);
    api.capture('checkout_opened', {});
    assert.equal(captures(calls).length, 2);
});

test('first touch is not stored before consent, and removed on decline', () => {
    const v = load({ url: 'https://ratemydutch.com/?utm_source=facebook&fbclid=F' });
    assert.equal(v.ctx.localStorage.getItem('rmd-first-touch'), null);
    const d = load({ url: 'https://ratemydutch.com/?utm_source=facebook', local: { 'rmd-first-touch': '{"utm_source":"x"}' } });
    d.document.els['rmd-consent-decline'].onclick();
    assert.equal(d.ctx.localStorage.getItem('rmd-first-touch'), null);
});

test('first touch is persisted on consent and never overwritten by a later campaign', () => {
    const first = load({ url: 'https://ratemydutch.com/?utm_source=facebook&utm_medium=paid&utm_term=t' });
    first.document.els['rmd-consent-accept'].onclick();
    const stored = first.ctx.localStorage.getItem('rmd-first-touch');
    assert.deepEqual(JSON.parse(stored), { utm_source: 'facebook', utm_medium: 'paid', utm_term: 't' });
    const later = load({
        url: 'https://ratemydutch.com/scorecard?utm_source=google',
        consent: 'granted', local: { 'rmd-first-touch': stored },
    });
    later.api.capture('scorecard_started', {});
    assert.equal(captures(later.calls)[0][2].utm_source, 'facebook');
    assert.equal(captures(later.calls)[0][2].utm_term, 't');
});

test('explicit event props win over first-touch attribution', () => {
    const { api, calls } = load({ url: 'https://ratemydutch.com/?utm_source=fb', consent: 'granted' });
    api.capture('x', { utm_source: 'override', focus: 'writing' });
    assert.equal(captures(calls)[0][2].utm_source, 'override');
    assert.equal(captures(calls)[0][2].focus, 'writing');
});

test('checkoutContext reports consent + distinct id only when granted', () => {
    assert.deepEqual(load().api.checkoutContext(), { analyticsConsent: false });
    const ctx = load({ url: 'https://ratemydutch.com/?utm_source=fb', consent: 'granted' }).api.checkoutContext();
    assert.equal(ctx.analyticsConsent, true);
    assert.equal(ctx.phDistinctId, 'ph-distinct-1');
    assert.equal(ctx.firstTouch.utm_source, 'fb');
});

test('production uses the first-party /ingest proxy; localhost talks to PostHog EU directly', () => {
    assert.equal(load().initConfig.api_host, '/ingest');
    assert.equal(load({ url: 'http://localhost:3456/' }).initConfig.api_host, 'https://eu.i.posthog.com');
    assert.equal(load().initConfig.opt_out_capturing_by_default, true);
});
