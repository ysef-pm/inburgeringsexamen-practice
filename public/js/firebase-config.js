// Firebase web app config — public values, safe to expose.
window.FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCD9mRzTF71Dg96FBi3oBC0ZWd0dUkqkhQ',
    // Same-domain auth (proxied via vercel.json /__/auth route) — cross-domain
    // firebaseapp.com broke signInWithRedirect under 3P-storage partitioning.
    authDomain: 'ratemydutch.com',
    projectId: 'ratemydutch',
    storageBucket: 'ratemydutch.firebasestorage.app',
    messagingSenderId: '529276412561',
    appId: '1:529276412561:web:1b1952577571da48469530',
};
