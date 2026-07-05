// RateMyDutch auth service. Requires firebase compat SDK + firebase-config.js loaded first.
(function () {
    const configured = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
    let currentUser = null;
    let paid = false;
    const listeners = [];

    function notify() { listeners.forEach((fn) => fn({ user: currentUser, paid })); }

    async function refreshEntitlement() {
        if (!currentUser) { paid = false; return; }
        try {
            const token = await currentUser.getIdToken();
            const resp = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
            const data = await resp.json();
            paid = !!data.paid;
        } catch (e) { paid = false; }
    }

    if (configured) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
        firebase.auth().onAuthStateChanged(async (user) => {
            currentUser = user;
            await refreshEntitlement();
            notify();
        });
    }

    window.RMDAuth = {
        isConfigured: () => configured,
        onChange(fn) { listeners.push(fn); fn({ user: currentUser, paid }); },
        getUser: () => currentUser,
        isPaid: () => paid,
        async getToken() { return currentUser ? currentUser.getIdToken() : null; },
        async refresh() { await refreshEntitlement(); notify(); },
        signInGoogle: () => firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()),
        signInEmail: (email, pw) => firebase.auth().signInWithEmailAndPassword(email, pw),
        signUpEmail: (email, pw) => firebase.auth().createUserWithEmailAndPassword(email, pw),
        resetPassword: (email) => firebase.auth().sendPasswordResetEmail(email),
        signOut: () => firebase.auth().signOut(),
        async startCheckout() {
            const token = await this.getToken();
            if (!token) throw new Error('not_signed_in');
            const resp = await fetch('/api/create-checkout-session', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
            });
            const data = await resp.json();
            if (data.alreadyPaid) { await this.refresh(); return; }
            if (data.url) window.location.href = data.url;
            else throw new Error(data.error || 'checkout_failed');
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
