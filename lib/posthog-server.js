// Server-side PostHog capture for purchase_completed, sent from the Stripe
// webhook hook (server.js onEntitlementGranted) — reliable where the browser
// isn't: iDEAL/Bancontact settle asynchronously and buyers often close the
// tab on Stripe's success page.
//
// Privacy (privacy.html): PostHog only receives data from visitors who
// accepted the analytics banner. The browser forwards its consent state and
// PostHog distinct id when it opens checkout (analytics.js checkoutContext);
// lib/checkout.js stores them in the session metadata (ph_consent,
// ph_distinct_id, ph_ft). Without ph_consent === '1' nothing is sent.
// Never email or Firebase uid — the distinct id is the PostHog id the browser
// already uses (the random subscriber id once identified).

const crypto = require('crypto');

// Public project key (same as public/js/analytics.js — safe to ship).
const DEFAULT_KEY = 'phc_5Tkl04nv0OFEPm0wZBywI3Z6ziWjfffk7aZ5KbZ7VmD';
const DEFAULT_HOST = 'https://eu.i.posthog.com';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

// Deterministic UUID per checkout session: PostHog dedupes identical event
// uuids, so a webhook retry that slips past claimOnce can't double count.
function uuidFromSession(sessionId) {
    const h = crypto.createHash('sha256').update(`purchase_completed:${sessionId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function parseFirstTouch(raw) {
    if (typeof raw !== 'string' || !raw) return {};
    try {
        const obj = JSON.parse(raw);
        const out = {};
        for (const k of UTM_KEYS) if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k];
        return out;
    } catch { return {}; }
}

// Returns the capture payload, or null when the buyer didn't consent.
function buildPurchaseEvent(session, { apiKey = DEFAULT_KEY, now = new Date() } = {}) {
    const md = (session && session.metadata) || {};
    if (md.ph_consent !== '1' || typeof md.ph_distinct_id !== 'string' || !md.ph_distinct_id) return null;
    return {
        api_key: apiKey,
        event: 'purchase_completed',
        distinct_id: md.ph_distinct_id,
        uuid: uuidFromSession(session.id),
        timestamp: now.toISOString(),
        properties: {
            ...parseFirstTouch(md.ph_ft),
            checkout_session_id: session.id,
            focus: md.focus || null,
            currency: session.currency || null,
            amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
            value: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
            payment_status: session.payment_status || null,
            source: 'stripe_webhook',
            $lib: 'rmd-server',
        },
    };
}

async function capturePurchase(session, {
    fetchImpl = globalThis.fetch,
    apiKey = process.env.POSTHOG_PROJECT_KEY || DEFAULT_KEY,
    host = process.env.POSTHOG_HOST || DEFAULT_HOST,
} = {}) {
    const payload = buildPurchaseEvent(session, { apiKey });
    if (!payload) return { sent: false, reason: 'no_consent' };
    const resp = await fetchImpl(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) throw new Error(`posthog capture failed: ${resp.status}`);
    return { sent: true };
}

module.exports = { buildPurchaseEvent, capturePurchase, uuidFromSession, parseFirstTouch };
