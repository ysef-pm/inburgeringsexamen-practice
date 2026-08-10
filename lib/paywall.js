function createPaywall({ verifyIdToken, getEntitlement, consumeFreeGrade }) {
    async function authenticate(req, res) {
        const header = req.headers.authorization || '';
        const match = header.match(/^Bearer (.+)$/);
        if (!match) {
            res.status(401).json({ success: false, error: 'auth_required' });
            return null;
        }
        try {
            const decoded = await verifyIdToken(match[1]);
            if (!decoded || typeof decoded.uid !== 'string' || !decoded.uid) throw new Error('invalid_decoded_token');
            req.user = { uid: decoded.uid, email: decoded.email };
            return req.user;
        } catch (err) {
            res.status(401).json({ success: false, error: 'invalid_token' });
            return null;
        }
    }

    async function requireAuth(req, res, next) {
        const user = await authenticate(req, res);
        if (user) next();
    }

    async function requirePaid(req, res, next) {
        const user = await authenticate(req, res);
        if (!user) return;
        try {
            const entitlement = await getEntitlement(user.uid);
            if (!entitlement || entitlement.paid !== true) {
                return res.status(402).json({ success: false, error: 'payment_required' });
            }
            next();
        } catch (err) {
            console.error('Entitlement check failed:', err.message);
            res.status(500).json({ success: false, error: 'entitlement_check_failed' });
        }
    }

    // Like requirePaid, but unpaid users get exactly one grade on the house
    // (the scorecard inline-question funnel's aha moment). The allowance is
    // consumed atomically server-side, one per Firebase uid, ever.
    async function requirePaidOrFreeGrade(req, res, next) {
        const user = await authenticate(req, res);
        if (!user) return;
        try {
            const entitlement = await getEntitlement(user.uid);
            if (entitlement && entitlement.paid === true) return next();
            if (typeof consumeFreeGrade === 'function' && await consumeFreeGrade(user.uid)) {
                req.usedFreeGrade = true;
                return next();
            }
            return res.status(402).json({ success: false, error: 'payment_required' });
        } catch (err) {
            console.error('Entitlement check failed:', err.message);
            res.status(500).json({ success: false, error: 'entitlement_check_failed' });
        }
    }

    return { requireAuth, requirePaid, requirePaidOrFreeGrade };
}

module.exports = { createPaywall };
