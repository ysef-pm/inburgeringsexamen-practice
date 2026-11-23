// Inline first-question funnel on the scorecard result screen.
// Flow (max 3 steps from answer to member):
//   answer -> Google sign-up sheet -> free AI feedback -> paywall -> Stripe Checkout.
// Design: docs/plans/2026-08-10-mobile-conversion-redesign.md
// State survives reloads/auth redirects via localStorage 'rmd-inline-state'.
// One-tap unlock (2026-11): a tap on "€24" ends on Stripe Checkout. Sign-in,
// when needed, is chained in between and the checkout resumes by itself —
// including after a full-page Google redirect (window.RMDCheckout intent,
// public/js/checkout-flow.js).

const STATE_KEY = 'rmd-inline-state';
let exercises = null;
let track = () => {};

function saveState(patch) {
    const s = { ...loadState(), ...patch };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
    return s;
}
export function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
}

async function loadExercises() {
    if (!exercises) exercises = await (await fetch('/data/scorecard-inline.json')).json();
    return exercises;
}

// auth.js does this on the app page; the scorecard page inits here instead.
function ensureFirebase() {
    if (!window.firebase || !window.FIREBASE_CONFIG) throw new Error('Sign-in is unavailable right now.');
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
}

function authReady() {
    ensureFirebase();
    return new Promise((resolve) => {
        const unsub = firebase.auth().onAuthStateChanged((u) => { unsub(); resolve(u); });
    });
}

const RC = () => window.RMDCheckout;

// Facebook/Instagram in-app browsers: Google blocks OAuth entirely
// (403 disallowed_useragent), so the Google button must not be offered there.
function inBlockedWebview() {
    return RC() ? RC().inAppBrowser() : /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger/i.test(navigator.userAgent);
}

// `checkoutIntent` (when the sign-in was started by a €24 tap) is persisted
// before any redirect so the checkout resumes on return without a second tap.
async function signInGoogle(checkoutIntent) {
    ensureFirebase();
    const provider = new firebase.auth.GoogleAuthProvider();
    const redirect = async () => {
        saveState({ pendingRedirect: true });
        if (checkoutIntent && RC()) RC().markForRedirect(checkoutIntent);
        await firebase.auth().signInWithRedirect(provider);
        return null; // page navigates away
    };
    // Phones and WebViews: straight to the full-page redirect — a popup there
    // opens a new tab (iOS) or is blocked outright.
    if (RC() && RC().prefersRedirect()) return redirect();
    try {
        const cred = await firebase.auth().signInWithPopup(provider);
        return cred.user;
    } catch (err) {
        // A closed popup during a €24 tap means "cancel", not "try redirect".
        const fallback = ['auth/popup-blocked', 'auth/cancelled-popup-request',
            'auth/operation-not-supported-in-this-environment'];
        if (!checkoutIntent) fallback.push('auth/popup-closed-by-user');
        if (fallback.includes(err.code)) return redirect();
        throw err;
    }
}

// Email works in every browser, including the ad-traffic webviews.
// Create-or-sign-in on one form: try create; fall back to sign-in.
async function signInEmail(email, password) {
    ensureFirebase();
    try {
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        return cred.user;
    } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
            const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
            return cred.user;
        }
        throw err;
    }
}

// One gate, not two: the Q3 email already identifies this person. Ask the
// server to mint a passwordless session for that subscriber; only fall back
// to the sign-in sheet when the email belongs to a real (Google/password or
// paid) account. Returns 'ok' | 'requiresSignIn' | 'failed'.
async function sessionAuth(sid) {
    try {
        const resp = await fetch('/api/scorecard/session-auth', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriberId: sid }),
        });
        const data = await resp.json();
        if (data.token) {
            ensureFirebase();
            await firebase.auth().signInWithCustomToken(data.token);
            return 'ok';
        }
        if (data.requiresSignIn) return 'requiresSignIn';
    } catch (err) {
        console.error('session-auth failed:', err);
    }
    return 'failed';
}

// Sheet copy per reason for signing in: the free feedback, or the €24 tap.
const SHEET_COPY = {
    feedback: {
        signInSubtitle: 'This email already has an account. Continue with Google or your password to see your feedback.',
        emailTitle: 'Where should your feedback go?',
        emailBody: 'Enter your email to see your graded answer — no password, no account form.',
        emailBtn: 'Show my feedback',
    },
    checkout: {
        signInSubtitle: 'This email already has an account. Sign in and we take you straight to secure checkout.',
        emailTitle: 'Which email should your access go to?',
        emailBody: 'Your €24 unlock is saved to this email — then straight on to secure checkout. No password.',
        emailBtn: 'Continue to checkout',
    },
};

// Get a signed-in user with as little friction as the situation allows:
// already signed in → session from the Q3 email → email-only sheet (no
// password) → full sign-in sheet only for existing accounts.
// opts: { purpose: 'feedback'|'checkout', intent, onSheet, onCancel } —
// onSheet fires when a visible sheet takes over (the caller resets its
// button), onCancel when the visitor dismisses it.
async function ensureAuthed(focus, onReady, opts = {}) {
    const copy = SHEET_COPY[opts.purpose] || SHEET_COPY.feedback;
    const shown = () => { if (typeof opts.onSheet === 'function') opts.onSheet(); };
    const user = await authReady();
    if (user) return onReady(user);
    const sid = localStorage.getItem('rmd-scorecard-sid');
    if (sid) {
        const outcome = await sessionAuth(sid);
        if (outcome === 'ok') {
            track('signup_completed', { focus, method: 'session', purpose: opts.purpose || 'feedback' });
            return onReady(firebase.auth().currentUser);
        }
        if (outcome === 'requiresSignIn') {
            shown();
            return requireSignIn({
                title: 'Welcome back — sign in',
                subtitle: copy.signInSubtitle,
                focus, onSignedIn: onReady, intent: opts.intent, onCancel: opts.onCancel,
            });
        }
    }
    shown();
    requireEmailOnly({ focus, onReady, copy, intent: opts.intent, onCancel: opts.onCancel });
}

// Email-only fallback when the scorecard subscriber id is missing (cleared
// storage, different device): one field, no password. Spec: "ask for email
// once, not email then password".
function requireEmailOnly({ focus, onReady, copy = SHEET_COPY.feedback, intent, onCancel }) {
    track('signup_sheet_shown', { focus, variant: 'email_only', purpose: intent ? 'checkout' : 'feedback' });
    const el = sheet(`
        <h2>${copy.emailTitle}</h2>
        <p>${copy.emailBody}</p>
        <form id="sheet-email-form">
            <input type="email" id="sheet-email" required autocomplete="email" placeholder="you@example.com"
                   value="${(localStorage.getItem('rmd-email') || '').replace(/"/g, '')}">
            <button class="btn" type="submit" id="sheet-email-btn" style="width:100%;margin-top:.5rem">${copy.emailBtn}</button>
        </form>
        <div class="error" id="sheet-error"></div>
        <button class="btn-ghost-link" id="sheet-close">Not now</button>
    `);
    el.querySelector('#sheet-email-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#sheet-email-btn');
        const errEl = el.querySelector('#sheet-error');
        errEl.textContent = '';
        btn.disabled = true;
        track('signup_email_tapped', { focus, variant: 'email_only' });
        try {
            const email = el.querySelector('#sheet-email').value;
            const resp = await fetch('/api/scorecard/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, anonId: localStorage.getItem('rmd-anon-id') }),
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || 'Something went wrong.');
            localStorage.setItem('rmd-scorecard-sid', data.subscriberId);
            try { localStorage.setItem('rmd-email', email); } catch {}
            window.rmdAnalytics?.identify(data.subscriberId);
            const outcome = await sessionAuth(data.subscriberId);
            if (outcome === 'ok') {
                track('signup_completed', { focus, method: 'session' });
                closeSheet();
                return onReady(firebase.auth().currentUser);
            }
            if (outcome === 'requiresSignIn') {
                return requireSignIn({
                    title: 'Welcome back — sign in',
                    subtitle: intent ? copy.signInSubtitle
                        : 'This email already has an account. Continue with Google or your password.',
                    focus, onSignedIn: onReady, intent, onCancel,
                });
            }
            throw new Error('Could not start your session, please try again.');
        } catch (err) {
            track('signup_failed', { focus, method: 'session', code: err.code || null });
            errEl.textContent = err.message || 'Something went wrong, please try again.';
            btn.disabled = false;
        }
    };
    bindDismiss(el, onCancel);
}

// "Not now" / backdrop: the €24 tap is abandoned, so its pending intent must
// not fire a checkout later.
function bindDismiss(el, onCancel) {
    const dismiss = () => {
        closeSheet();
        if (typeof onCancel === 'function') onCancel();
    };
    el.querySelector('#sheet-close').onclick = dismiss;
    el.querySelector('.sheet-backdrop').onclick = dismiss;
}

const AUTH_ERROR_COPY = {
    'auth/wrong-password': 'That email already has an account with a different password.',
    'auth/invalid-credential': 'That email already has an account with a different password.',
    'auth/weak-password': 'Please use at least 6 characters for the password.',
    'auth/invalid-email': 'That email address does not look right.',
};

function sheet(html) {
    document.getElementById('rmd-sheet')?.remove();
    const el = document.createElement('div');
    el.id = 'rmd-sheet';
    el.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet-panel">${html}</div>`;
    document.body.appendChild(el);
    return el;
}
function closeSheet() { document.getElementById('rmd-sheet')?.remove(); }

function requireSignIn({ title, subtitle, onSignedIn, focus, intent, onCancel }) {
    const webview = inBlockedWebview();
    track('signup_sheet_shown', { focus, webview, purpose: intent ? 'checkout' : 'feedback' });
    const googleBtn = `
        <button class="btn btn-google" id="sheet-google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.8c4.4-4.1 7.2-10.1 7.2-17.5z"/><path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.5l-7.4-5.8c-2 1.4-4.6 2.2-7.6 2.2-6.3 0-11.7-3.9-13.6-9.4l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
        </button>`;
    const emailForm = `
        <form id="sheet-email-form" ${webview ? '' : 'style="display:none"'}>
            <input type="email" id="sheet-email" required autocomplete="email" placeholder="you@example.com"
                   value="${(localStorage.getItem('rmd-email') || '').replace(/"/g, '')}">
            <input type="password" id="sheet-password" required autocomplete="new-password"
                   placeholder="Choose a password (6+ characters)" minlength="6"
                   style="width:100%;font-family:var(--font-body);font-size:1.05rem;padding:.7rem .9rem;border:1px solid var(--cream-dark);border-radius:5px;background:var(--warm-white);margin:.35rem 0 .75rem">
            <button class="btn" type="submit" id="sheet-email-btn" style="width:100%">${intent ? 'Sign in and continue to checkout' : 'Create my free account'}</button>
        </form>`;
    const el = sheet(`
        <h2>${title}</h2>
        <p>${subtitle}</p>
        ${webview ? emailForm : googleBtn + `
        <button class="btn-ghost-link" id="sheet-email-toggle" style="margin-top:.5rem">Or continue with email</button>
        ` + emailForm}
        <div class="error" id="sheet-error"></div>
        <p class="muted" style="margin-top:.75rem;font-size:.85rem">One account for feedback, progress and access on any device.</p>
        <button class="btn-ghost-link" id="sheet-close">Not now</button>
    `);
    const fail = (err, method) => {
        track('signup_failed', { focus, method, code: err.code || null });
        el.querySelector('#sheet-error').textContent =
            AUTH_ERROR_COPY[err.code] || err.message || 'Sign-in failed, please try again.';
    };
    const succeed = (user, method) => {
        track('signup_completed', { focus, method });
        closeSheet(); onSignedIn(user);
    };
    el.querySelector('#sheet-google')?.addEventListener('click', async () => {
        el.querySelector('#sheet-error').textContent = '';
        track('signup_google_tapped', { focus });
        try {
            const user = await signInGoogle(intent);
            if (user) succeed(user, 'google');
        } catch (err) { fail(err, 'google'); }
    });
    el.querySelector('#sheet-email-toggle')?.addEventListener('click', () => {
        el.querySelector('#sheet-email-form').style.display = '';
        el.querySelector('#sheet-email-toggle').style.display = 'none';
    });
    el.querySelector('#sheet-email-form').onsubmit = async (e) => {
        e.preventDefault();
        el.querySelector('#sheet-error').textContent = '';
        track('signup_email_tapped', { focus });
        const btn = el.querySelector('#sheet-email-btn');
        btn.disabled = true;
        try {
            const user = await signInEmail(
                el.querySelector('#sheet-email').value, el.querySelector('#sheet-password').value);
            succeed(user, 'email');
        } catch (err) { fail(err, 'email'); btn.disabled = false; }
    };
    bindDismiss(el, onCancel);
}

function checkoutError(err) {
    const msg = RC() ? RC().friendlyError(err) : (err.message || 'Checkout failed, please try again.');
    const el = document.getElementById('paywall-error');
    if (el && el.offsetParent !== null) {
        el.textContent = msg;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    } else {
        alert(msg);
    }
}

// THE €24 tap. One tap → Stripe Checkout: signed in → straight there; not
// signed in → silent session from the Q3 email → there; only an existing
// real account (or lost storage) sees a sheet, and finishing it continues
// into checkout on its own (also across a Google redirect).
async function unlock(focus, btn, via) {
    const restore = RC() ? RC().busy(btn) : () => {};
    const errEl = document.getElementById('paywall-error');
    if (errEl) errEl.textContent = '';
    let user = null;
    try {
        // Waits for Firebase to restore a saved session — a reload/back
        // navigation used to hit currentUser === null here and crash.
        user = await authReady();
    } catch (err) {
        restore();
        track('checkout_failed', { focus, via: via || 'card', code: 'auth_unavailable' });
        return checkoutError(err);
    }
    if (user) return openCheckout(focus, btn, via);
    const intent = { surface: 'scorecard', focus, via: via || 'card' };
    RC()?.save(intent);
    ensureAuthed(focus, () => openCheckout(focus, btn, via, { afterSignIn: true }), {
        purpose: 'checkout', intent,
        onSheet: restore,
        onCancel: () => { RC()?.clear(); restore(); },
    });
}

async function openCheckout(focus, btn, via, { afterSignIn = false, resumed = false } = {}) {
    RC()?.clear(); // the pending intent (if any) is being fulfilled right now
    const restore = RC() ? RC().busy(btn) : () => {};
    via = via || 'card';
    try {
        const user = firebase.auth().currentUser || await authReady();
        if (!user) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });
        const idToken = await user.getIdToken();
        const resp = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
                returnTo: '/scorecard',
                // Dutch checkout (P0): the server whitelists these.
                locale: (navigator.language || '').toLowerCase().startsWith('nl') ? 'nl' : 'auto',
                subscriberId: localStorage.getItem('rmd-scorecard-sid') || undefined,
                anonId: localStorage.getItem('rmd-anon-id') || undefined,
                focus,
                via,
                // Consent + PostHog id for the webhook's purchase_completed.
                ...(window.rmdAnalytics?.checkoutContext?.() || {}),
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (data.alreadyPaid) { location.href = '/?src=scorecard'; return; }
        if (!data.success || !data.url) {
            throw Object.assign(new Error(data.error || 'checkout_failed'), { code: data.error || 'checkout_failed' });
        }
        // Firestore checkout_opened is written server-side when the session is
        // actually created; this is only the PostHog mirror with the same props.
        // BEACON: sent immediately, survives the navigation below.
        window.rmdAnalytics?.capture('checkout_opened', {
            focus, via,
            currency: data.currency, locale: data.locale, country: data.country,
            after_sign_in: afterSignIn, resumed, in_app_browser: inBlockedWebview(),
        }, window.rmdAnalytics?.BEACON);
        saveState({ stage: 'checkout' });
        // Same-tab full-page navigation: Meta's in-app browsers kill new
        // tabs/popups. The button stays busy until we leave (or pageshow /
        // the timeout in checkout-flow.js recovers it).
        location.href = data.url;
    } catch (err) {
        restore();
        track('checkout_failed', { focus, via, code: err.code || null, after_sign_in: afterSignIn, resumed });
        checkoutError(err);
    }
}

// The exam-date answer from the scorecard drives the urgency line: a failed
// section is a paid retake plus months of waiting — that's what €24 is against.
function urgencyLine() {
    const t = (() => { try { return localStorage.getItem('rmd-exam-timeline'); } catch { return null; } })();
    if (t === '1m') return 'Your exam is within a month — every ungraded answer between now and then is a guess.';
    if (t === '3m') return 'Your exam is 1–3 months away — enough time to fix weak spots, if you can see them.';
    return 'A failed section means paying for a retake and waiting months for a new date.';
}

const SKILL_SHORT = {
    speaking: 'Spreken', listening: 'Luisteren', reading: 'Lezen',
    writing: 'Schrijven', knowledge: 'KNM',
};

// Real user feedback, pseudonymized first names (owner's call, 2026-08-30:
// quotes are genuine, names changed for privacy). Keep quotes real —
// never invent the feedback itself.
const TESTIMONIALS = [
    { text: 'I used RateMyDutch to prepare for my exam and passed first time.', who: 'Priya' },
    { text: "I've been using it for weeks — I couldn't continue without it.", who: 'Marco' },
];

// The offer block, rebuilt as a real paywall (P1): personalized weak-skill
// hook, what €24 buys as bullets, payment-method icons on the CTA, refund
// line under the button, real quotes. One filled orange button in view.
function paywallCard(container, focus, headline) {
    const result = (() => { try { return JSON.parse(localStorage.getItem('rmd-last-result')); } catch { return null; } })();
    const pct = result && result.skills ? result.skills[focus] : null;
    const short = SKILL_SHORT[focus] || 'Schrijven';
    const hook = typeof pct === 'number'
        ? `${short} ${pct}% — this is where the exam will fail you. Unlock graded speaking and writing until you pass.`
        : 'Unlock graded speaking and writing until you pass.';
    const quotes = TESTIMONIALS.length ? `
        <div class="paywall-quotes">${TESTIMONIALS.map((q) =>
            `<p class="quote">“${q.text}” <span class="muted">— ${q.who}</span></p>`).join('')}
        </div>` : '';
    container.insertAdjacentHTML('beforeend', `
        <div class="card inline-paywall">
            <h2>${headline}</h2>
            <p>${hook}</p>
            <p class="muted" style="margin-top:.35rem">${urgencyLine()}</p>
            <p style="margin-top:.75rem"><b>Your 7-day plan, with graded feedback — €24 once:</b></p>
            <ul class="plan">
                <li>Unlimited AI grades on Schrijven — the official DUO writing rubric categories (execution, grammar, spelling, clearness, vocabulary)</li>
                <li>Unlimited AI grades on Spreken — transcription plus the same rubric</li>
                <li>All exam sets for Lezen, Luisteren and KNM — those stay free, and stay yours</li>
                <li>Progress saved, on any device</li>
                <li>Yours until you pass — one payment, no subscription</li>
            </ul>
            <button class="btn" id="paywall-btn" style="margin-top:.75rem;width:100%">Unlock everything — €24 once</button>
            <div class="error" id="paywall-error" role="alert"></div>
            <p class="pay-methods"><span class="pay-chip ideal">iDEAL</span>
                <span class="pay-chip">Cards</span> <span class="pay-chip">Apple&nbsp;Pay</span>
                <span class="muted">via Stripe</span></p>
            <p class="muted" style="margin-top:.5rem;font-size:.9rem">7-day refund if the feedback isn't
            useful. Email support@ratemydutch.com — no questions asked.</p>
            ${quotes}
        </div>`);
    // Mirrored to PostHog by track(); the app's upgrade modal fires the same
    // paywall_viewed name with surface: 'app'.
    track('paywall_viewed', { focus, headline, surface: 'scorecard', trigger: 'inline_card' });
    document.getElementById('paywall-btn').onclick = (e) => unlock(focus, e.currentTarget);
    ensureStickyUnlock(container, focus);
}

// Once the free grade is consumed the unlock offer must survive scrolling:
// the one replayed user who saw their feedback scrolled back to the scorecard,
// never saw the paywall card again, and left.
function ensureStickyUnlock(container, focus) {
    if (document.getElementById('rmd-unlock-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'rmd-unlock-bar';
    bar.innerHTML = `
        <span class="bar-copy">Every answer graded until you pass</span>
        <button class="btn" id="unlock-bar-btn">Unlock — €24 once</button>`;
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '4.5rem';
    bar.querySelector('#unlock-bar-btn').onclick = (e) => unlock(focus, e.currentTarget, 'sticky');
    // Hide the bar while the full paywall card is on screen — one offer at a time.
    const card = container.querySelector('.inline-paywall');
    if (card && 'IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
            bar.style.display = entry.isIntersecting ? 'none' : '';
        }).observe(card);
    }
}

function feedbackHtml(g) {
    if (!g.scores) return `<p>${g.overallFeedback || 'Your answer was graded — open the app for details.'}</p>`;
    const rows = Object.entries({ execution: 3, grammar: 2, spelling: 2, clearness: 1, vocabulary: 2 })
        .map(([k, max]) => `
            <div class="skill-row">
                <span class="name" style="text-transform:capitalize">${k}</span>
                <div class="bar"><div style="width:${(g.scores[k].score / max) * 100}%"></div></div>
                <span class="pct">${g.scores[k].score}/${max}</span>
            </div>`).join('');
    const fixes = (g.grammarErrors || []).slice(0, 3).map((e) =>
        `<li><s>${e.error}</s> → <b>${e.correction}</b><br><span class="muted">${e.explanation || ''}</span></li>`).join('');
    return `
        <p class="muted">Your first AI feedback — graded on the official DUO writing rubric categories</p>
        <h2 style="margin-top:.25rem">${g.total}/10</h2>
        ${rows}
        ${fixes ? `<p style="margin-top:.75rem"><b>Fix these first:</b></p><ul class="plan">${fixes}</ul>` : ''}
        <p style="margin-top:.75rem">${g.overallFeedback || ''}</p>`;
}

async function gradeAnswer(container, ex, focus, answerText) {
    const area = container.querySelector('#inline-grade-area');
    area.innerHTML = '<p class="muted">Grading your answer against the official rubric…</p>';
    try {
        const idToken = await firebase.auth().currentUser.getIdToken();
        const resp = await fetch('/api/grade-writing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ userText: answerText, prompt: ex.prompt, modelAnswer: ex.modelAnswer }),
        });
        if (resp.status === 402) {
            area.innerHTML = '';
            saveState({ stage: 'paywalled' });
            paywallCard(container, focus, 'Your free feedback is used — keep going');
            return;
        }
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Grading failed.');
        const grading = data.grading || { overallFeedback: data.rawFeedback };
        saveState({ stage: 'graded', grading });
        area.innerHTML = feedbackHtml(grading);
        track('first_feedback_viewed', { focus, total: grading.total });
        paywallCard(container, focus, 'That was your free feedback — want it on every answer?');
    } catch (err) {
        area.innerHTML = `<p class="error">${err.message}</p>
            <button class="btn" id="grade-retry">Try again</button>`;
        container.querySelector('#grade-retry').onclick = () => gradeAnswer(container, ex, focus, answerText);
    }
}

function renderGraded(container, ex, focus, resumeAnswer) {
    container.innerHTML = `
        <div class="card">
            <p class="muted">Step 1 of your plan — try it right now</p>
            <h2>${ex.prompt}</h2>
            <ul class="plan">${ex.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
            <p class="muted" style="margin:.5rem 0 0;font-size:.9rem">Three or four short sentences is
            enough — most people finish in about 2 minutes. Mistakes are fine: they're what the feedback is for.</p>
            <textarea id="inline-answer" rows="5" placeholder="${ex.placeholder}"
                style="width:100%;font-family:inherit;font-size:1.05rem;padding:.7rem .9rem;border:1px solid var(--cream-dark);border-radius:5px;margin-top:.5rem">${resumeAnswer || ''}</textarea>
            <div class="error" id="inline-error"></div>
            <button class="btn" id="inline-submit" style="margin-top:.75rem">Get my AI feedback — free</button>
            <div id="inline-grade-area" style="margin-top:1rem"></div>
        </div>`;
    track('inline_question_shown', { focus, type: 'graded' });
    container.querySelector('#inline-submit').onclick = async () => {
        const text = container.querySelector('#inline-answer').value.trim();
        const errEl = container.querySelector('#inline-error');
        errEl.textContent = '';
        if (text.split(/\s+/).length < 5) { errEl.textContent = 'Write a few sentences first — the AI needs something to grade.'; return; }
        track('inline_answer_submitted', { focus, type: 'graded', words: text.split(/\s+/).length });
        saveState({ answer: text, stage: 'answered' });
        container.querySelector('#inline-submit').style.display = 'none';
        // No second gate: the Q3 email becomes the session server-side.
        // A sheet only appears for lost storage or existing real accounts.
        ensureAuthed(focus, () => gradeAnswer(container, ex, focus, text));
    };
}

function mcqScoreHtml(container, ex, score) {
    container.innerHTML = `
        <div class="card">
            <p class="muted">Your warm-up result</p>
            <h2>${score} of ${ex.questions.length} correct</h2>
            <p>${score === ex.questions.length ? 'Sterk! Now push your level with the full exam sets.'
                : 'Good start — the full exam sets train exactly these questions until they stick.'}</p>
        </div>`;
}

function renderMcq(container, ex, focus) {
    let idx = 0;
    const picks = [];
    track('inline_question_shown', { focus, type: 'mcq' });
    const showScore = () => {
        const score = picks.filter((p, i) => p === ex.questions[i].answer).length;
        saveState({ stage: 'graded', mcqScore: score });
        mcqScoreHtml(container, ex, score);
        track('first_feedback_viewed', { focus, total: score });
        paywallCard(container, focus, 'Keep practising where it counts');
    };
    const step = () => {
        const q = ex.questions[idx];
        container.innerHTML = `
            <div class="card">
                <p class="muted">Step 1 of your plan — try it right now (${idx + 1}/${ex.questions.length})</p>
                ${idx === 0 && ex.passage ? `<p style="background:var(--cream);padding:.75rem;border-radius:6px">${ex.passage}</p>` : ''}
                <h2>${q.q}</h2>
                <div id="inline-options"></div>
            </div>`;
        const box = container.querySelector('#inline-options');
        q.options.forEach((opt, i) => {
            const b = document.createElement('button');
            b.className = 'option';
            b.textContent = opt;
            b.onclick = async () => {
                picks[idx] = i;
                if (idx === 0) track('inline_answer_submitted', { focus, type: 'mcq' });
                idx += 1;
                if (idx < ex.questions.length) return step();
                saveState({ stage: 'answered', picks });
                // The score is never gated — account creation happens silently
                // from the Q3 email when possible, and the score shows anyway.
                const user = await authReady();
                if (!user) {
                    const sid = localStorage.getItem('rmd-scorecard-sid');
                    if (sid) await sessionAuth(sid);
                }
                showScore();
            };
            box.appendChild(b);
        });
    };
    step();
}

// Entry point. `focus` is the scorecard focus skill id (writing/speaking/reading/listening/knowledge).
export async function renderInlinePractice(container, focus) {
    const ex = (await loadExercises())[focus] || (await loadExercises()).writing;
    // A focus change (retaken scorecard, different result) must not leak a
    // previous exercise's answer into this one's textarea.
    const prior = loadState();
    if (prior.focus && prior.focus !== focus) {
        saveState({ focus, answer: null, stage: null, grading: null, picks: null });
    } else {
        saveState({ focus });
    }
    const state = loadState();

    // Resume after Google auth redirect: finish what the tap started.
    let redirectError = null;
    if (state.pendingRedirect) {
        saveState({ pendingRedirect: false });
        try {
            ensureFirebase();
            const cred = await firebase.auth().getRedirectResult();
            if (cred && cred.user) track('signup_completed', { focus, method: 'google', redirect: true });
        } catch (err) {
            redirectError = err;
            track('signup_failed', { focus, method: 'google', redirect: true, code: err.code || null });
        }
    }

    if (state.stage === 'graded' && state.grading) {
        container.innerHTML = '<div class="card"><div id="inline-grade-area"></div></div>';
        container.querySelector('#inline-grade-area').innerHTML = feedbackHtml(state.grading);
        paywallCard(container, focus, 'That was your free feedback — want it on every answer?');
        return resumePendingCheckout(focus, redirectError);
    }
    // MCQ warm-up already scored (reload, or back from a Google redirect that
    // a €24 tap started): show the score + paywall, never restart the quiz.
    if (state.stage === 'graded' && typeof state.mcqScore === 'number' && ex.type === 'mcq') {
        mcqScoreHtml(container, ex, state.mcqScore);
        paywallCard(container, focus, 'Keep practising where it counts');
        return resumePendingCheckout(focus, redirectError);
    }
    // Bounced off Stripe (back button, closed tab): the paywall must come
    // back, never a dead "Opening secure checkout…" screen.
    if (state.stage === 'checkout') {
        if (state.grading) {
            container.innerHTML = '<div class="card"><div id="inline-grade-area"></div></div>';
            container.querySelector('#inline-grade-area').innerHTML = feedbackHtml(state.grading);
        }
        paywallCard(container, focus, 'Finish unlocking — you were almost there');
        return resumePendingCheckout(focus, redirectError);
    }
    if (state.stage === 'paywalled') {
        paywallCard(container, focus, 'Pick up where you left off');
        return resumePendingCheckout(focus, redirectError);
    }
    // A pending scorecard €24 intent without a paywall stage to resume into
    // is stale (an app-surface intent is the app's business).
    const stale = RC()?.peek();
    if (stale && (!stale.surface || stale.surface === 'scorecard')) RC().clear();
    if (ex.type === 'mcq') return renderMcq(container, ex, focus);
    const resume = state.stage === 'answered' ? state.answer : '';
    renderGraded(container, ex, focus, resume);
    // If we came back from an auth redirect with an answer waiting, grade it now.
    if (resume && await authReady()) {
        container.querySelector('#inline-submit').click();
    }
}

// Back on the page with a pending €24 intent (Google redirect, or a reload
// mid sign-in): signed in now → continue into checkout with no second tap.
// Not signed in (redirect cancelled/failed) → drop the intent, keep the
// paywall, and say why.
async function resumePendingCheckout(focus, redirectError, fallbackBtnId = 'paywall-btn') {
    const intent = RC()?.peek();
    if (!intent) return;
    if (intent.surface && intent.surface !== 'scorecard') return;
    const user = await authReady().catch(() => null);
    if (!user) {
        RC().clear();
        if (redirectError) checkoutError({ message: 'Sign-in did not finish — tap the button to try again.' });
        return;
    }
    const btn = (intent.via === 'sticky' && document.getElementById('unlock-bar-btn'))
        || document.getElementById(fallbackBtnId);
    return openCheckout(intent.focus || focus, btn, intent.via || 'card', { afterSignIn: true, resumed: true });
}

// Post-checkout continuation rendered instead of the landing page.
export function renderCheckoutReturn(app, ok) {
    const st = loadState();
    const mode = { writing: 'schrijven', speaking: 'spreken', reading: 'lezen', listening: 'luisteren', knowledge: 'knm' }[st.focus] || 'schrijven';
    if (ok) {
        try { localStorage.removeItem(STATE_KEY); } catch {}
        const skillLabel = SKILL_SHORT[st.focus] || 'Schrijven';
        const target = `/?src=scorecard#${mode}`;
        app.innerHTML = `
            <h1>You're in 🎉</h1>
            <p class="lede">Everything is unlocked: unlimited AI feedback, all exam sets, every skill.</p>
            <div class="card">
                <h2>Start with ${skillLabel}</h2>
                <p>Your scorecard says that's the skill to fix first — taking you straight to those exercises…</p>
                <p style="margin-top:.75rem"><a class="btn" href="${target}">Start ${skillLabel} now</a></p>
            </div>`;
        // Straight into the weak-skill exercises, not a generic homepage.
        setTimeout(() => { location.href = target; }, 2000);
    } else {
        app.innerHTML = `
            <h1>Checkout cancelled</h1>
            <p class="lede">No problem — your answer and feedback are saved.</p>
            <div class="card">
                <p style="margin-top:.25rem"><button class="btn" id="retry-checkout">Back to checkout — €24 once</button></p>
                <p class="muted" style="margin-top:.5rem"><a href="/?src=scorecard#${mode}">Or keep using the free exercises</a></p>
            </div>`;
        document.getElementById('retry-checkout').onclick = (e) => unlock(st.focus, e.currentTarget, 'retry');
        // Back here from a Google redirect that the retry tap started.
        if (st.pendingRedirect) saveState({ pendingRedirect: false });
        resumePendingCheckout(st.focus, null, 'retry-checkout').catch(() => {});
    }
}

export function initInlinePractice(trackFn) { track = trackFn; }
