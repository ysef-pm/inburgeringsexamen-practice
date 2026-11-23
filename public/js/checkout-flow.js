// One-tap €24 upgrade helpers, shared by the scorecard (inline-practice.js)
// and the practice app (index.html + auth.js). Classic script so both the
// ES-module scorecard and the inline app scripts can use window.RMDCheckout.
//
// The tap that says "€24" must end on Stripe Checkout. When a visible sign-in
// has to happen first, the tap's intent is persisted here so the checkout
// resumes on its own after sign-in, including after a full-page Google
// redirect (popups die in Instagram/Facebook WebViews and are flaky on iOS).
//
// Intent storage: localStorage AND sessionStorage (either can be blocked or
// wiped in WebViews), plus a `checkout_intent=1` URL param put on the current
// URL right before an auth redirect, so the page we come back to knows even
// when storage did not survive. Intents expire after INTENT_TTL_MS so a stale
// one can never throw someone into checkout days later.
(function (root) {
    var KEY = 'rmd-pending-checkout';
    var PARAM = 'checkout_intent';
    var INTENT_TTL_MS = 15 * 60 * 1000;
    // Restore a "Opening secure checkout…" button if we are somehow still on
    // the page this long after starting the redirect (slow WebView, a
    // navigation the browser swallowed): the visitor must be able to retry.
    var BUSY_TIMEOUT_MS = 30000;

    function win() { return root; }
    function stores() {
        var out = [];
        try { if (win().localStorage) out.push(win().localStorage); } catch (e) {}
        try { if (win().sessionStorage) out.push(win().sessionStorage); } catch (e) {}
        return out;
    }
    function now() { return Date.now(); }

    function ua() {
        try { return (win().navigator && win().navigator.userAgent) || ''; } catch (e) { return ''; }
    }

    // Facebook/Instagram/etc. in-app browsers. Google refuses OAuth inside
    // them (403 disallowed_useragent), so no Google button there.
    function inAppBrowser(agent) {
        return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger/i.test(agent == null ? ua() : agent);
    }

    // Phones/tablets and WebViews get the full-page redirect sign-in straight
    // away: popups there open a new tab (iOS) or get blocked after an await.
    function prefersRedirect(agent) {
        var a = agent == null ? ua() : agent;
        return inAppBrowser(a) || /iPhone|iPad|iPod|Android|Mobile/i.test(a);
    }

    function urlHasIntent() {
        try { return new URLSearchParams(win().location.search).get(PARAM) === '1'; } catch (e) { return false; }
    }

    function setUrlIntent(on) {
        try {
            var loc = win().location;
            var url = new URL(loc.href);
            if (on) url.searchParams.set(PARAM, '1'); else url.searchParams.delete(PARAM);
            var next = url.pathname + (url.search || '') + (url.hash || '');
            if (next !== loc.pathname + loc.search + loc.hash) {
                win().history.replaceState(win().history.state, '', next);
            }
        } catch (e) {}
    }

    function save(intent) {
        var rec = {};
        var src = intent || {};
        for (var k in src) if (src[k] !== undefined) rec[k] = src[k];
        rec.ts = now();
        var json = JSON.stringify(rec);
        stores().forEach(function (s) { try { s.setItem(KEY, json); } catch (e) {} });
        return rec;
    }

    function readStored() {
        var list = stores();
        for (var i = 0; i < list.length; i++) {
            try {
                var rec = JSON.parse(list[i].getItem(KEY) || 'null');
                if (rec && typeof rec === 'object' && typeof rec.ts === 'number') return rec;
            } catch (e) {}
        }
        return null;
    }

    // Can this page actually persist an intent? (Blocked storage throws.)
    function storageWorks() {
        var list = stores();
        for (var i = 0; i < list.length; i++) {
            try { list[i].setItem(KEY + '-probe', '1'); list[i].removeItem(KEY + '-probe'); return true; } catch (e) {}
        }
        return false;
    }

    // The pending intent, or null. The bare URL marker only counts when this
    // browser cannot store anything at all — otherwise a shared or bookmarked
    // link carrying checkout_intent=1 would throw a signed-in visitor into
    // Stripe without a tap.
    function peek() {
        var rec = readStored();
        if (rec && now() - rec.ts <= INTENT_TTL_MS && rec.ts <= now() + 60000) return rec;
        if (urlHasIntent() && !storageWorks()) return { fromUrl: true };
        return null;
    }

    function clear() {
        stores().forEach(function (s) { try { s.removeItem(KEY); } catch (e) {} });
        if (urlHasIntent()) setUrlIntent(false);
    }

    // Read-once: whoever resumes the checkout clears the intent first, so a
    // reload or a second auth event can never open checkout twice.
    function consume() {
        var rec = peek();
        clear();
        return rec;
    }

    // Call right before a full-page auth redirect.
    function markForRedirect(intent) {
        var rec = save(intent);
        setUrlIntent(true);
        return rec;
    }

    // ---- Button state ----
    var busyButtons = [];

    function restore(entry) {
        var i = busyButtons.indexOf(entry);
        if (i !== -1) busyButtons.splice(i, 1);
        if (entry.timer) clearTimeout(entry.timer);
        try {
            entry.btn.disabled = false;
            entry.btn.textContent = entry.label;
            entry.btn.removeAttribute('aria-busy');
        } catch (e) {}
    }

    // Puts a button into "Opening secure checkout…" and returns restore().
    // The button is NOT restored on a successful redirect (the page is going
    // away; restoring would invite a double tap) — instead the pageshow
    // handler below and the timeout recover it if the visitor comes back.
    function busy(btn, busyLabel) {
        if (!btn) return function () {};
        for (var i = 0; i < busyButtons.length; i++) {
            if (busyButtons[i].btn === btn) return busyButtons[i].restore;
        }
        var entry = { btn: btn, label: btn.textContent };
        entry.restore = function () { restore(entry); };
        btn.disabled = true;
        btn.textContent = busyLabel || 'Opening secure checkout…';
        try { btn.setAttribute('aria-busy', 'true'); } catch (e) {}
        entry.timer = setTimeout(entry.restore, BUSY_TIMEOUT_MS);
        if (entry.timer && entry.timer.unref) entry.timer.unref(); // Node tests only
        busyButtons.push(entry);
        return entry.restore;
    }

    function restoreAll() {
        busyButtons.slice().forEach(restore);
    }

    // Back from Stripe via the back button / swipe: the bfcache restores the
    // page exactly as we left it — button disabled mid-redirect. Recover it.
    try {
        if (win().addEventListener) {
            win().addEventListener('pageshow', function (e) { if (e && e.persisted) restoreAll(); });
        }
    } catch (e) {}

    // Server error codes → copy a visitor can act on.
    var ERROR_COPY = {
        not_signed_in: 'Please sign in first, then try again.',
        auth_required: 'Please sign in first, then try again.',
        invalid_token: 'Your session expired — please try again.',
        stripe_not_configured: 'Checkout is temporarily unavailable. Please try again later.',
        checkout_failed: 'Could not open secure checkout — please try again.',
    };
    function friendlyError(err) {
        var code = err && (err.code || err.message);
        if (code && ERROR_COPY[code]) return ERROR_COPY[code];
        if (err && err.name === 'TypeError') return 'Connection problem — please check your internet and try again.';
        return (err && err.message) || 'Could not open secure checkout — please try again.';
    }

    var api = {
        KEY: KEY, PARAM: PARAM, INTENT_TTL_MS: INTENT_TTL_MS, BUSY_TIMEOUT_MS: BUSY_TIMEOUT_MS,
        inAppBrowser: inAppBrowser,
        prefersRedirect: prefersRedirect,
        urlHasIntent: urlHasIntent,
        save: save, peek: peek, consume: consume, clear: clear, markForRedirect: markForRedirect,
        busy: busy, restoreAll: restoreAll,
        friendlyError: friendlyError,
    };
    root.RMDCheckout = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
