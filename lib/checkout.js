// Checkout Session parameters for the €24 one-time unlock — a Dutch checkout
// for a Dutch product. The funnel promises "€24 once · iDEAL"; the session
// must agree: EUR presentment only (Adaptive Pricing off — it was showing
// US visitors-by-geolocation $28.90 + a ~4% conversion fee), iDEAL first,
// no phone collection, same-tab return URLs. Pure builder so the contract
// is unit-testable without Stripe.

const SUPPORTED_LOCALES = new Set(['auto', 'nl', 'en', 'de', 'fr', 'es', 'it', 'pl', 'pt', 'tr']);
// Nearby countries whose visitors get their billing country prefilled via a
// pre-created Stripe Customer (Checkout has no direct country-prefill param).
const PREFILL_COUNTRIES = new Set(['NL', 'BE', 'DE']);

function normalizeLocale(locale) {
    return SUPPORTED_LOCALES.has(locale) ? locale : 'auto';
}

function prefillCountry(geoCountry) {
    const c = typeof geoCountry === 'string' ? geoCountry.toUpperCase() : '';
    return PREFILL_COUNTRIES.has(c) ? c : null;
}

// PostHog consent handoff for the webhook's purchase_completed
// (lib/posthog-server.js). Only written when the browser reports the visitor
// accepted the analytics banner; Stripe metadata values max out at 500 chars.
const FIRST_TOUCH_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
function analyticsMetadata(analytics) {
    if (!analytics || analytics.consent !== true) return {};
    const id = typeof analytics.distinctId === 'string' ? analytics.distinctId.slice(0, 200) : '';
    if (!id) return {};
    const md = { ph_consent: '1', ph_distinct_id: id };
    const ft = {};
    const src = analytics.firstTouch && typeof analytics.firstTouch === 'object' ? analytics.firstTouch : {};
    for (const k of FIRST_TOUCH_KEYS) {
        if (typeof src[k] === 'string' && src[k]) ft[k] = src[k].slice(0, 120);
    }
    let json = JSON.stringify(ft);
    // fbclid is the long one; drop it before truncating anything else.
    if (json.length > 500) { delete ft.fbclid; json = JSON.stringify(ft); }
    for (let cap = 100; json.length > 500 && cap >= 20; cap -= 20) {
        for (const k of Object.keys(ft)) ft[k] = ft[k].slice(0, cap);
        json = JSON.stringify(ft);
    }
    if (Object.keys(ft).length && json.length <= 500) md.ph_ft = json;
    return md;
}

function buildCheckoutSessionParams({
    priceId, uid, email, origin, returnTo = '/', locale, customerId,
    subscriberId, anonId, focus, analytics,
}) {
    const params = {
        mode: 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        // The price is a fixed EUR price; this stops Stripe from presenting a
        // converted USD amount (plus conversion fee) to non-eurozone IPs.
        adaptive_pricing: { enabled: false },
        locale: normalizeLocale(locale),
        // Explicit list: iDEAL above the fold for NL, Bancontact for BE,
        // card covers Apple Pay/Google Pay, Link for returning Stripe users.
        // No Amazon Pay, no US-centric wallets.
        payment_method_types: ['ideal', 'card', 'bancontact', 'link'],
        phone_number_collection: { enabled: false },
        client_reference_id: uid,
        metadata: {
            uid,
            ...(subscriberId ? { subscriberId } : {}),
            ...(anonId ? { anonId } : {}),
            ...(focus ? { focus } : {}),
            ...analyticsMetadata(analytics),
        },
        success_url: `${origin}${returnTo}?checkout=success`,
        cancel_url: `${origin}${returnTo}?checkout=cancelled`,
    };
    // A pre-created customer carries the GeoIP billing country; otherwise the
    // scorecard email is prefilled directly (the two params are exclusive).
    if (customerId) params.customer = customerId;
    else if (email) params.customer_email = email;
    return params;
}

module.exports = { buildCheckoutSessionParams, normalizeLocale, prefillCountry, analyticsMetadata };
