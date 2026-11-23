// RateMyDutch auth service. Requires firebase compat SDK + firebase-config.js loaded first.
(function () {
    const configured = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
    let currentUser = null;
    let paid = false;
    let ready = false; // true once Firebase has reported the restored session
    const listeners = [];

    function notify() {
        listeners.forEach((fn) => {
            try { fn({ user: currentUser, paid, ready }); } catch (e) { console.error('auth listener error:', e); }
        });
    }

    async function refreshEntitlement() {
        if (!currentUser) { paid = false; return; }
        try {
            const token = await currentUser.getIdToken();
            const resp = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
            const data = await resp.json();
            paid = !!data.paid;
        } catch (e) { paid = false; }
    }

    // Outcome of a Google signInWithRedirect that brought us back to this
    // page: the credential (or null), never rejecting — index.html tracks it.
    let redirectResult = Promise.resolve(null);

    if (configured) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
        redirectResult = firebase.auth().getRedirectResult()
            .then((cred) => (cred && cred.user ? cred : null))
            .catch((err) => { console.error('Google redirect sign-in failed:', err); return { error: err }; });
        firebase.auth().onAuthStateChanged(async (user) => {
            currentUser = user;
            ready = true;
            await refreshEntitlement();
            notify();
        });
    }

    window.RMDAuth = {
        isConfigured: () => configured,
        onChange(fn) {
            listeners.push(fn);
            try { fn({ user: currentUser, paid, ready }); } catch (e) { console.error('auth listener error:', e); }
        },
        getUser: () => currentUser,
        isPaid: () => paid,
        async getToken() { return currentUser ? currentUser.getIdToken() : null; },
        async refresh() { await refreshEntitlement(); notify(); },
        redirectResult: () => redirectResult,
        // Phones and in-app browsers: full-page redirect (popups open a new
        // tab on iOS and are blocked in Instagram/Facebook WebViews). Desktop:
        // popup, falling back to redirect. A pending €24 intent is marked on
        // the URL first so the checkout resumes after we come back.
        // Resolves to the credential, or null when the page is redirecting.
        async signInGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            const C = window.RMDCheckout;
            const redirect = async () => {
                const pending = C && C.peek();
                if (pending && !pending.fromUrl) C.markForRedirect(pending);
                await firebase.auth().signInWithRedirect(provider);
                return null;
            };
            if (C && C.prefersRedirect()) return redirect();
            try {
                return await firebase.auth().signInWithPopup(provider);
            } catch (err) {
                if (['auth/popup-blocked', 'auth/cancelled-popup-request',
                     'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
                    return redirect();
                }
                throw err;
            }
        },
        signInEmail: (email, pw) => firebase.auth().signInWithEmailAndPassword(email, pw),
        signUpEmail: (email, pw) => firebase.auth().createUserWithEmailAndPassword(email, pw),
        resetPassword: (email) => firebase.auth().sendPasswordResetEmail(email),
        signOut: () => firebase.auth().signOut(),
        // Creates the Checkout Session and navigates there (same tab).
        // Resolves 'redirected' or 'already_paid'; throws with .code on failure.
        async startCheckout({ via = 'upgrade_modal', afterSignIn = false, resumed = false } = {}) {
            const token = await this.getToken();
            if (!token) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });
            const ls = (k) => { try { return localStorage.getItem(k) || undefined; } catch (e) { return undefined; } };
            const resp = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({
                    // Same Dutch-checkout + funnel-join fields the scorecard sends.
                    locale: (navigator.language || '').toLowerCase().startsWith('nl') ? 'nl' : 'auto',
                    subscriberId: ls('rmd-scorecard-sid'),
                    anonId: ls('rmd-anon-id'),
                    via,
                },
                // Consent + PostHog id for the webhook's purchase_completed.
                (window.rmdAnalytics && window.rmdAnalytics.checkoutContext()) || {})),
            });
            const data = await resp.json().catch(() => ({}));
            if (data.alreadyPaid) { await this.refresh(); return 'already_paid'; }
            if (!data.url) {
                const code = data.error || 'checkout_failed';
                throw Object.assign(new Error(code), { code });
            }
            // PostHog mirror of the scorecard's checkout_opened (inline-practice.js).
            // BEACON: sent immediately, survives the navigation below.
            if (window.rmdAnalytics) {
                window.rmdAnalytics.capture('checkout_opened', {
                    surface: 'app', via,
                    currency: data.currency, locale: data.locale, country: data.country,
                    after_sign_in: afterSignIn, resumed,
                    in_app_browser: !!(window.RMDCheckout && window.RMDCheckout.inAppBrowser()),
                }, window.rmdAnalytics.BEACON);
            }
            window.location.href = data.url;
            return 'redirected';
        },
        // Fetch wrapper for gated endpoints: attaches token, surfaces 401/402 as typed errors.
        async authedFetch(url, options = {}) {
            const token = await this.getToken();
            const headers = Object.assign({}, options.headers || {});
            if (token) headers.Authorization = `Bearer ${token}`;
            const resp = await fetch(url, Object.assign({}, options, { headers }));
            if (resp.status === 401) throw Object.assign(new Error('auth_required'), { code: 'auth_required' });
            if (resp.status === 402) throw Object.assign(new Error('payment_required'), { code: 'payment_required' });
            return resp;
        },
    };
})();
