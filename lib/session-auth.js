// One gate, not two. The visitor already typed their email at Q3 of the
// scorecard; forcing a Google/password signup before the free AI grade was
// killing 46 results → 6 signups. This endpoint turns the Q3 email into a
// Firebase session server-side: create (or reuse) a passwordless user for
// the subscriber's email and mint a custom token the client signs in with.
//
// Safety rule: a custom token is only minted when the email cannot belong to
// an account someone actively uses — an existing user with sign-in providers
// (Google/password) or a paid entitlement always gets `requiresSignIn`
// instead, so knowing an email address never takes over a real account.
function createSessionAuth({ getSubscriberEmail, getUserByEmail, createAuthUser, createCustomToken, getEntitlement }) {
    return async function sessionAuthHandler(req, res) {
        const { subscriberId } = req.body || {};
        if (typeof subscriberId !== 'string' || subscriberId.length === 0 || subscriberId.length > 64) {
            return res.status(400).json({ success: false, error: 'invalid_subscriber' });
        }
        try {
            const email = await getSubscriberEmail(subscriberId);
            if (!email) {
                return res.status(400).json({ success: false, error: 'unknown_subscriber' });
            }
            let user = null;
            try {
                user = await getUserByEmail(email);
            } catch (err) {
                if (err.code !== 'auth/user-not-found') throw err;
            }
            if (user) {
                const hasProviders = Array.isArray(user.providerData) && user.providerData.length > 0;
                const entitlement = await getEntitlement(user.uid);
                if (hasProviders || (entitlement && entitlement.paid === true)) {
                    return res.json({ success: true, requiresSignIn: true });
                }
            } else {
                user = await createAuthUser(email);
            }
            const token = await createCustomToken(user.uid);
            res.json({ success: true, token });
        } catch (err) {
            console.error('session-auth error:', err);
            res.status(500).json({ success: false, error: 'session_auth_failed' });
        }
    };
}

module.exports = { createSessionAuth };
