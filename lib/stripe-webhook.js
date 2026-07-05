// uid must be a safe Firestore document id: alphanumeric, underscore, hyphen
// (excludes '/' and other path separators). Firestore also reserves ids of
// the form __.*__, so those are rejected explicitly.
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const FIRESTORE_RESERVED = /^__.*__$/;

function isValidUid(uid) {
    return UID_PATTERN.test(uid) && !FIRESTORE_RESERVED.test(uid);
}

function createWebhookHandler({ constructEvent, writeEntitlement }) {
    // Stripe delivers webhook events at-least-once, so the same event (or the
    // same session via completed + async_payment_succeeded) can grant twice.
    // writeEntitlement must therefore stay idempotent — it is a merge-set
    // keyed by uid in lib/firebase.js.
    return async function handleWebhook(req, res) {
        let event;
        try {
            event = constructEvent(req.body, req.headers['stripe-signature']);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: 'invalid_signature' });
        }

        try {
            // Grant on both synchronous success (card) and delayed success
            // (iDEAL and other async methods, where checkout.session.completed
            // arrives with payment_status 'unpaid' and the actual success is
            // signalled later via checkout.session.async_payment_succeeded).
            if (event.type === 'checkout.session.completed' ||
                event.type === 'checkout.session.async_payment_succeeded') {
                const outcome = await grantEntitlementForSession(event.data.object, writeEntitlement);
                if (outcome) {
                    return res.status(outcome.status).json(outcome.body);
                }
            } else if (event.type === 'checkout.session.async_payment_failed') {
                console.warn('Async payment failed for session:', event.data.object && event.data.object.id);
            }
            res.status(200).json({ received: true });
        } catch (err) {
            console.error('Unexpected webhook handler error:', err);
            res.status(500).json({ error: 'webhook_handler_error' });
        }
    };
}

// Returns { status, body } when the default 200 {received:true} should be
// overridden, or null/undefined otherwise. Throws only for retryable errors.
async function grantEntitlementForSession(session, writeEntitlement) {
    if (session.payment_status !== 'paid') return null;

    const uid = session.client_reference_id || (session.metadata && session.metadata.uid);
    if (!uid) {
        console.error('Paid checkout session with no uid:', session.id);
        return { status: 200, body: { received: true, warning: 'missing_uid' } };
    }
    if (!isValidUid(uid)) {
        // Data problem — Stripe retries can't fix a malformed uid, so ack with 200.
        console.error('Paid checkout session with invalid uid:', session.id, uid);
        return { status: 200, body: { received: true, warning: 'invalid_uid' } };
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
        return { status: 500, body: { error: 'entitlement_write_failed' } };
    }
    return null;
}

module.exports = { createWebhookHandler };
