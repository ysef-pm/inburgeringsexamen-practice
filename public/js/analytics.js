// RateMyDutch analytics — PostHog EU Cloud behind an opt-in consent banner.
// Firestore /api/events (lib/scorecard.js) stays the source of truth for the
// ads-agent kill guard; page scripts mirror the same named events here via
// window.rmdAnalytics for funnels, session replay and device breakdown.
// Design: docs/plans/2026-08-09-posthog-analytics-design.md
!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="an ln init xn Cn Br kn In capture Fn nn calculateEventProperties On register register_once register_for_session unregister unregister_for_session Ln getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Dn identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty An Rn createPersonProfile setInternalOrTestUser $n yn jn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Tn debug Ur Rt getPageViewId captureTraceFeedback captureTraceMetric pn".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

var PH_KEY = 'phc_5Tkl04nv0OFEPm0wZBywI3Z6ziWjfffk7aZ5KbZ7VmD';
// /ingest only exists on Vercel (vercel.json); local `npm start` talks to PostHog directly.
var PROXIED = /(^|\.)ratemydutch\.com$|\.vercel\.app$/.test(location.hostname);

// ===== First-touch attribution =====
// The landing URL's campaign params, kept for the whole visitor lifetime so a
// checkout three pages (or three days) later is still attributed to the ad
// that brought the visitor. Held in memory until the visitor accepts the
// banner; only then persisted (localStorage) and sent to PostHog as super
// properties + on every rmdAnalytics event. Decline removes it (privacy.html).
var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
var FIRST_TOUCH_KEY = 'rmd-first-touch';

function readFirstTouch() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(FIRST_TOUCH_KEY) || 'null'); } catch (e) {}
    if (stored && typeof stored === 'object') return stored;
    var touch = {};
    try {
        var params = new URLSearchParams(location.search);
        UTM_KEYS.forEach(function (k) {
            var v = params.get(k);
            if (v) touch[k] = v.slice(0, 200);
        });
    } catch (e) {}
    // Only a campaign landing becomes the first touch; a direct visit leaves
    // the slot open for a later tagged one.
    return touch;
}
function persistFirstTouch() {
    try {
        if (Object.keys(firstTouch).length && !localStorage.getItem(FIRST_TOUCH_KEY)) {
            localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(firstTouch));
        }
    } catch (e) {}
}
function forgetFirstTouch() {
    try { localStorage.removeItem(FIRST_TOUCH_KEY); } catch (e) {}
}
var firstTouch = readFirstTouch();

// ===== Consent-aware event buffer =====
// Root cause of the missing funnel events (2026-11): the SDK boots opted-out
// and DISCARDS every capture made while consent is still pending. The funnel
// events fire exactly then — landing_viewed on load, scorecard_started on
// question 1 (which is the landing since flow v3), the paywall and checkout
// while the banner still covers the bottom of the screen — so they were lost
// even for visitors who accepted a moment later. Now: pending → buffer in
// memory (nothing leaves the browser, nothing is stored), accept → flush with
// the original timestamps, decline → drop.
var MAX_BUFFER = 100;
var buffer = [];
var pendingIdentify = null;
var sdkLoaded = false;
var phInstance = null; // the real SDK instance, set in `loaded`

function ph() { return phInstance || window.posthog; }

function consentStatus() {
    if (!sdkLoaded || !ph() || !ph().get_explicit_consent_status) return 'pending';
    try { return ph().get_explicit_consent_status(); } catch (e) { return 'pending'; }
}

function withAttribution(props) {
    var out = {};
    for (var k in firstTouch) out[k] = firstTouch[k];
    if (props) for (var p in props) if (props[p] !== undefined) out[p] = props[p];
    return out;
}

function sendNow(name, props, options) {
    try { ph().capture(name, props, options); } catch (e) {}
}

function applyConsentGranted(sdk) {
    persistFirstTouch();
    try { if (Object.keys(firstTouch).length) sdk.register(firstTouch); } catch (e) {}
    identifySubscriber(sdk);
    if (pendingIdentify) { try { sdk.identify(pendingIdentify); } catch (e) {} pendingIdentify = null; }
    var queued = buffer;
    buffer = [];
    queued.forEach(function (ev) {
        var opts = {};
        if (ev.options) for (var k in ev.options) opts[k] = ev.options[k];
        // Flushed later than it happened (same page) — keep the real time.
        opts.timestamp = new Date(ev.ts);
        sendNow(ev.name, ev.props, opts);
    });
}

posthog.init(PH_KEY, {
    // First-party proxy (vercel.json /ingest → eu.i.posthog.com): ad blockers
    // drop requests to *.posthog.com, which silently loses funnel events.
    api_host: PROXIED ? '/ingest' : 'https://eu.i.posthog.com',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    // Nothing is captured and no cookie is set until the visitor accepts the banner.
    opt_out_capturing_by_default: true,
    loaded: function (sdk) {
        phInstance = sdk;
        sdkLoaded = true;
        var status = consentStatus();
        if (status === 'granted') {
            applyConsentGranted(sdk);
            // Recording doesn't reliably auto-start when the SDK boots opted-out,
            // so kick it explicitly once consent is known (respects project controls).
            try { sdk.startSessionRecording(); } catch (e) {}
        } else if (status === 'denied') {
            forgetFirstTouch();
            buffer = [];
            pendingIdentify = null;
        } else {
            whenDomReady(function () { showConsentBanner(sdk); });
        }
    },
});

// Pseudonymous join key to Firestore `subscribers` — never the email itself.
function identifySubscriber(sdk) {
    try {
        var sid = localStorage.getItem('rmd-scorecard-sid');
        if (sid) sdk.identify(sid);
    } catch (e) { /* storage blocked */ }
}

// Events fired right before `location.href = <Stripe>` are lost from the batch
// queue; BEACON sends them immediately and survives the navigation.
var BEACON = { send_instantly: true, transport: 'sendBeacon' };

window.rmdAnalytics = {
    BEACON: BEACON,
    firstTouch: function () { return withAttribution(null); },
    capture: function (name, props, options) {
        try {
            if (!window.posthog || !name) return;
            var status = consentStatus();
            if (status === 'denied') return;
            var full = withAttribution(props);
            if (status === 'granted') return sendNow(name, full, options);
            if (buffer.length < MAX_BUFFER) buffer.push({ name: name, props: full, options: options, ts: Date.now() });
        } catch (e) {}
    },
    identify: function (id) {
        try {
            if (!id || !window.posthog) return;
            var status = consentStatus();
            if (status === 'granted') ph().identify(String(id));
            else if (status === 'pending') pendingIdentify = String(id);
        } catch (e) {}
    },
    // Login/signup on the practice app: same subscriber-id join key, if this
    // browser has one. Never the Firebase email.
    identifyStored: function () {
        try {
            var sid = localStorage.getItem('rmd-scorecard-sid');
            if (sid) window.rmdAnalytics.identify(sid);
        } catch (e) {}
    },
    // Forwarded to checkout so the server-side purchase_completed (Stripe
    // webhook) is only sent for consenting visitors, on their PostHog person.
    checkoutContext: function () {
        try {
            if (consentStatus() !== 'granted') return { analyticsConsent: false };
            return { analyticsConsent: true, phDistinctId: ph().get_distinct_id(), firstTouch: withAttribution(null) };
        } catch (e) { return { analyticsConsent: false }; }
    },
};

function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
}

function showConsentBanner(sdk) {
    var bar = document.createElement('div');
    bar.id = 'rmd-consent-banner';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
        '<style>' +
        '#rmd-consent-banner { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;' +
        '  background: #1a2332; color: #fdfcfa; font-family: Georgia, serif; font-size: .95rem;' +
        '  padding: .85rem 1.25rem; display: flex; flex-wrap: wrap; gap: .75rem; align-items: center;' +
        '  justify-content: center; box-shadow: 0 -2px 12px rgba(26,35,50,.35); }' +
        '#rmd-consent-banner p { margin: 0; max-width: 34rem; line-height: 1.45; }' +
        '#rmd-consent-banner a { color: #c9a962; }' +
        '#rmd-consent-banner button { font-family: inherit; font-size: .95rem; border-radius: 5px;' +
        '  padding: .5rem 1.1rem; cursor: pointer; }' +
        '#rmd-consent-accept { background: #d4652a; color: #fdfcfa; border: none; font-weight: 700; }' +
        '#rmd-consent-decline { background: transparent; color: #fdfcfa; border: 1px solid #6b7280; }' +
        '</style>' +
        '<p>We use optional analytics cookies to understand how people use RateMyDutch and improve it' +
        ' — nothing is tracked unless you accept. <a href="/privacy">Privacy policy</a></p>' +
        '<button id="rmd-consent-accept" type="button">Accept</button>' +
        '<button id="rmd-consent-decline" type="button">Decline</button>';
    document.body.appendChild(bar);
    document.getElementById('rmd-consent-accept').onclick = function () {
        sdk.opt_in_capturing();
        try { sdk.startSessionRecording(); } catch (e) {}
        applyConsentGranted(sdk);
        bar.remove();
    };
    document.getElementById('rmd-consent-decline').onclick = function () {
        sdk.opt_out_capturing();
        forgetFirstTouch();
        buffer = [];
        pendingIdentify = null;
        bar.remove();
    };
}
