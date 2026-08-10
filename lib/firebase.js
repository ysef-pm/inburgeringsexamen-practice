// firebase-admin v14 uses the modular subpath API (admin.credential.* no longer exists).
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

let app = null;
let initError = null;

function init() {
    if (app || initError) return;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        initError = new Error('FIREBASE_SERVICE_ACCOUNT not set');
        return;
    }
    try {
        // Reuse an already-initialized default app (e.g. across serverless warm invocations).
        app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(JSON.parse(raw)) });
    } catch (err) {
        initError = err;
        console.error('Firebase Admin init failed:', err.message);
    }
}

function isConfigured() { init(); return !!app; }

async function verifyIdToken(token) {
    init();
    if (!app) throw initError;
    return getAuth(app).verifyIdToken(token);
}

async function getEntitlement(uid) {
    init();
    if (!app) throw initError;
    const snap = await getFirestore(app).collection('entitlements').doc(uid).get();
    return snap.exists ? snap.data() : null;
}

async function writeEntitlement({ uid, email, stripeCustomerId, stripeSessionId }) {
    init();
    if (!app) throw initError;
    await getFirestore(app).collection('entitlements').doc(uid).set({
        uid, email, paid: true, stripeCustomerId, stripeSessionId,
        purchasedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

function getDb() {
    init();
    if (!app) throw initError;
    return getFirestore(app);
}

// One free AI grade per uid, ever. create() is atomic: it throws
// ALREADY_EXISTS if the doc is there, so two concurrent requests can't both
// win. Returns true if this call claimed the allowance.
async function consumeFreeGrade(uid) {
    init();
    if (!app) throw initError;
    try {
        await getFirestore(app).collection('free_grades').doc(uid).create({
            uid, usedAt: FieldValue.serverTimestamp(),
        });
        return true;
    } catch (err) {
        if (err.code === 6 /* ALREADY_EXISTS */) return false;
        throw err;
    }
}

module.exports = { isConfigured, verifyIdToken, getEntitlement, writeEntitlement, getDb, FieldValue, consumeFreeGrade };
