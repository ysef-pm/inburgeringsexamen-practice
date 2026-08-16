// Inline first-question funnel on the scorecard result screen.
// Flow (max 3 steps from answer to member):
//   answer -> Google sign-up sheet -> free AI feedback -> paywall -> Stripe Checkout.
// Design: docs/plans/2026-08-10-mobile-conversion-redesign.md
// State survives reloads/auth redirects via localStorage 'rmd-inline-state'.

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

// Facebook/Instagram in-app browsers: Google blocks OAuth entirely
// (403 disallowed_useragent), so the Google button must not be offered there.
function inBlockedWebview() {
    return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger/i.test(navigator.userAgent);
}

async function signInGoogle() {
    ensureFirebase();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const cred = await firebase.auth().signInWithPopup(provider);
        return cred.user;
    } catch (err) {
        if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request',
             'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
            saveState({ pendingRedirect: true });
            await firebase.auth().signInWithRedirect(provider);
            return null; // page navigates away
        }
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

function requireSignIn({ title, subtitle, onSignedIn, focus }) {
    const webview = inBlockedWebview();
    track('signup_sheet_shown', { focus, webview });
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
            <button class="btn" type="submit" id="sheet-email-btn" style="width:100%">Create my free account</button>
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
            const user = await signInGoogle();
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
    el.querySelector('#sheet-close').onclick = closeSheet;
    el.querySelector('.sheet-backdrop').onclick = closeSheet;
}

async function openCheckout(focus, btn) {
    track('checkout_opened', { focus });
    if (btn) { btn.disabled = true; btn.textContent = 'Opening secure checkout…'; }
    try {
        const idToken = await firebase.auth().currentUser.getIdToken();
        const resp = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ returnTo: '/scorecard' }),
        });
        const data = await resp.json();
        if (data.alreadyPaid) { location.href = '/?src=scorecard'; return; }
        if (!data.success || !data.url) throw new Error(data.error || 'Could not start checkout.');
        saveState({ stage: 'checkout' });
        location.href = data.url;
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Unlock everything — €24 once'; }
        alert(err.message || 'Checkout failed, please try again.');
    }
}

function paywallCard(container, focus, headline) {
    container.insertAdjacentHTML('beforeend', `
        <div class="card inline-paywall">
            <h2>${headline}</h2>
            <p>Unlimited AI feedback on writing and speaking, all exam sets for every skill,
            and your progress saved. One payment, lifetime access.</p>
            <button class="btn" id="paywall-btn" style="margin-top:.75rem">Unlock everything — €24 once</button>
            <p class="muted" style="margin-top:.5rem;font-size:.85rem">Secure payment via Stripe · iDEAL, cards and more</p>
        </div>`);
    document.getElementById('paywall-btn').onclick = (e) => openCheckout(focus, e.target);
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
        <p class="muted">Your first AI feedback — official DUO rubric</p>
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
        const go = () => gradeAnswer(container, ex, focus, text);
        const user = await authReady();
        if (user) go();
        else requireSignIn({
            title: 'See your AI feedback',
            subtitle: 'Create your free account to unlock your graded answer — takes one tap.',
            focus, onSignedIn: go,
        });
    };
}

function renderMcq(container, ex, focus) {
    let idx = 0;
    const picks = [];
    track('inline_question_shown', { focus, type: 'mcq' });
    const showScore = () => {
        const score = picks.filter((p, i) => p === ex.questions[i].answer).length;
        saveState({ stage: 'graded', mcqScore: score });
        container.innerHTML = `
            <div class="card">
                <p class="muted">Your warm-up result</p>
                <h2>${score} of ${ex.questions.length} correct</h2>
                <p>${score === ex.questions.length ? 'Sterk! Now push your level with the full exam sets.'
                    : 'Good start — the full exam sets train exactly these questions until they stick.'}</p>
            </div>`;
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
                const user = await authReady();
                if (user) showScore();
                else requireSignIn({
                    title: 'See your score',
                    subtitle: 'Create your free account to see how you did — takes one tap.',
                    focus, onSignedIn: showScore,
                });
            };
            box.appendChild(b);
        });
    };
    step();
}

// Entry point. `focus` is the scorecard focus skill id (writing/speaking/reading/listening/knowledge).
export async function renderInlinePractice(container, focus) {
    const ex = (await loadExercises())[focus] || (await loadExercises()).writing;
    saveState({ focus });
    const state = loadState();

    // Resume after Google auth redirect: finish what the tap started.
    if (state.pendingRedirect) {
        saveState({ pendingRedirect: false });
        try { ensureFirebase(); await firebase.auth().getRedirectResult(); } catch {}
    }

    if (state.stage === 'graded' && state.grading) {
        container.innerHTML = '<div class="card"><div id="inline-grade-area"></div></div>';
        container.querySelector('#inline-grade-area').innerHTML = feedbackHtml(state.grading);
        paywallCard(container, focus, 'That was your free feedback — want it on every answer?');
        return;
    }
    if (state.stage === 'paywalled') {
        paywallCard(container, focus, 'Pick up where you left off');
        return;
    }
    if (ex.type === 'mcq') return renderMcq(container, ex, focus);
    const resume = state.stage === 'answered' ? state.answer : '';
    renderGraded(container, ex, focus, resume);
    // If we came back from an auth redirect with an answer waiting, grade it now.
    if (resume && await authReady()) {
        container.querySelector('#inline-submit').click();
    }
}

// Post-checkout continuation rendered instead of the landing page.
export function renderCheckoutReturn(app, ok) {
    const st = loadState();
    const mode = { writing: 'schrijven', speaking: 'spreken', reading: 'lezen', listening: 'luisteren', knowledge: 'knm' }[st.focus] || 'schrijven';
    if (ok) {
        try { localStorage.removeItem(STATE_KEY); } catch {}
        app.innerHTML = `
            <h1>You're in 🎉</h1>
            <p class="lede">Everything is unlocked: unlimited AI feedback, all exam sets, every skill.</p>
            <div class="card">
                <h2>Carry on with your plan</h2>
                <p>Your focus skill is waiting in the practice app.</p>
                <p style="margin-top:.75rem"><a class="btn" href="/?src=scorecard#${mode}">Continue practising</a></p>
            </div>`;
    } else {
        app.innerHTML = `
            <h1>Checkout cancelled</h1>
            <p class="lede">No problem — your answer and feedback are saved.</p>
            <div class="card">
                <p style="margin-top:.25rem"><button class="btn" id="retry-checkout">Back to checkout — €24 once</button></p>
                <p class="muted" style="margin-top:.5rem"><a href="/?src=scorecard#${mode}">Or keep using the free exercises</a></p>
            </div>`;
        document.getElementById('retry-checkout').onclick = async (e) => {
            const user = await authReady();
            if (user) openCheckout(st.focus, e.target);
            else requireSignIn({ title: 'Sign in to continue', subtitle: 'One tap and you are back at checkout.', focus: st.focus, onSignedIn: () => openCheckout(st.focus, e.target) });
        };
    }
}

export function initInlinePractice(trackFn) { track = trackFn; }
