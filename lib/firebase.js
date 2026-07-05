const admin = require('firebase-admin');

let initialized = false;
let initError = null;

function init() {
    if (initialized || initError) return;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        initError = new Error('FIREBASE_SERVICE_ACCOUNT not set');
        return;
    }
    try {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        initialized = true;
    } catch (err) {
        initError = err;
        console.error('Firebase Admin init failed:', err.message);
    }
}

function isConfigured() { init(); return initialized; }

async function verifyIdToken(token) {
    init();
    if (!initialized) throw initError;
    return admin.auth().verifyIdToken(token);
}

async function getEntitlement(uid) {
    init();
    if (!initialized) throw initError;
    const snap = await admin.firestore().collection('entitlements').doc(uid).get();
    return snap.exists ? snap.data() : null;
}

async function writeEntitlement({ uid, email, stripeCustomerId, stripeSessionId }) {
    init();
    if (!initialized) throw initError;
    await admin.firestore().collection('entitlements').doc(uid).set({
        uid, email, paid: true, stripeCustomerId, stripeSessionId,
        purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

module.exports = { isConfigured, verifyIdToken, getEntitlement, writeEntitlement };
