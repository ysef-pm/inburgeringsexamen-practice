function createWebhookHandler({ constructEvent, writeEntitlement }) {
    return async function handleWebhook(req, res) {
        let event;
        try {
            event = constructEvent(req.body, req.headers['stripe-signature']);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: 'invalid_signature' });
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (session.payment_status === 'paid') {
                const uid = session.client_reference_id || (session.metadata && session.metadata.uid);
                if (!uid) {
                    console.error('checkout.session.completed with no uid:', session.id);
                    return res.status(200).json({ received: true, warning: 'missing_uid' });
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
                    return res.status(500).json({ error: 'entitlement_write_failed' });
                }
            }
        }
        res.status(200).json({ received: true });
    };
}

module.exports = { createWebhookHandler };
