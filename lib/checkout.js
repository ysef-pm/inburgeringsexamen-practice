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

function buildCheckoutSessionParams({
    priceId, uid, email, origin, returnTo = '/', locale, customerId,
    subscriberId, anonId, focus,
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

module.exports = { buildCheckoutSessionParams, normalizeLocale, prefillCountry };
