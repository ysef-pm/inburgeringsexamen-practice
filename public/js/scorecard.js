// Scorecard flow: landing → consent → questions → result → inline first
// question → Google sign-up → free AI feedback → checkout (flow v2).
// Events: landing_viewed, (consent_confirmed server-side), scorecard_started,
// result_viewed, cta_clicked + inline_* / signup_* / checkout_opened.
// See docs/acquisition/EVENTS-AND-BASELINE.md
import { renderInlinePractice, renderCheckoutReturn, initInlinePractice, loadState } from './inline-practice.js';

const app = document.getElementById('app');

const params = new URLSearchParams(location.search);
const utm = {};
for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    if (params.get(k)) utm[k] = params.get(k);
}
const source = params.get('src') || params.get('utm_source') || document.referrer || 'direct';

const anonId = (() => {
    let id = localStorage.getItem('rmd-anon-id');
    if (!id) {
        id = 'a-' + crypto.getRandomValues(new Uint32Array(2)).join('-');
        localStorage.setItem('rmd-anon-id', id);
    }
    return id;
})();

let questions = null;
let subscriberId = localStorage.getItem('rmd-scorecard-sid') || null;
const answers = {};
let steps = [];
let stepIndex = 0;
let startedAt = null;
let startedEventSent = false;

function track(event_name, properties) {
    // Mirror into PostHog (public/js/analytics.js) — Firestore below stays the
    // source of truth for the ads-agent.
    window.rmdAnalytics?.capture(event_name, { source, ...utm, ...properties });
    const payload = { event_name, anonId, subscriberId, source, ...utm, properties };
    // sendBeacon survives navigation; fetch is the fallback.
    const body = JSON.stringify(payload);
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' })))) {
        fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
    }
}

// ===== Views =====
function renderLanding() {
    app.innerHTML = `
        <h1>Am I ready for the inburgeringsexamen?</h1>
        <p class="lede">Find out in a few minutes. Answer ${'17'} short questions and get a practical
        readiness scorecard: your strongest and weakest skills, plus a focused plan for the next seven days.</p>
        <div class="card">
            <p><b>What you get:</b></p>
            <p>• A readiness band for Spreken, Luisteren, Lezen, Schrijven and KNM<br>
               • Your one priority skill to work on first<br>
               • Three concrete exercises for this week</p>
            <p class="muted" style="margin-top:.75rem">Takes about 4 minutes. Free.</p>
        </div>
        <button class="btn" id="start-btn">Start the scorecard</button>
        <p class="muted" style="margin-top:2.5rem">Preparation guides:
            <a href="/guides/am-i-ready-inburgering-speaking-exam">Am I ready for the speaking exam?</a> ·
            <a href="/guides/two-weeks-before-inburgeringsexamen">The last two weeks before the exam</a></p>
        <p class="muted" style="margin-top:1rem" id="disclaimer"></p>
    `;
    document.getElementById('start-btn').onclick = renderConsent;
    loadQuestions();
}

// Flow v3 landing: question 1 IS the landing. The email gate moves to after
// question 3 (renderStep interposes renderConsentGate) so visitors invest
// before we ask — attacks the ~97% landing→start bounce from paid traffic.
async function renderLandingV3() {
    app.innerHTML = `
        <h1>Am I ready for the inburgeringsexamen?</h1>
        <p class="lede">Loading your first question…</p>`;
    await loadQuestions();
    steps = [
        ...questions.context.map(q => ({ type: 'context', q })),
        ...questions.selfAssessment.items.map(q => ({ type: 'self', q })),
        ...questions.diagnostic.map(q => ({ type: 'diagnostic', q })),
    ];
    stepIndex = 0;
    startedAt = new Date().toISOString();
    renderStep();
}

// The email ask, reframed as progress instead of a toll booth.
function renderConsentGate() {
    const pct = Math.round((stepIndex / steps.length) * 100);
    app.innerHTML = `
        <p class="muted">Nice start — ${stepIndex} of ${steps.length} answered</p>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <h1 style="font-size:1.35rem">Your scorecard is building. Where should we send it?</h1>
        <div class="card">
            <form id="consent-form">
                <label for="email"><b>Email address</b></label>
                <input type="email" id="email" required autocomplete="email" placeholder="you@example.com">
                <label class="consent">
                    <input type="checkbox" checked disabled>
                    <span>Email me my RateMyDutch exam-readiness scorecard.</span>
                </label>
                <div class="error" id="consent-error"></div>
                <button class="btn" type="submit" id="consent-btn">Continue — ${steps.length - stepIndex} questions left</button>
            </form>
            <p class="muted" style="margin-top:1rem">You'll also see your result immediately on screen.
            We only use your email for the purposes above. Unsubscribing always works with one click.
            <span id="disclaimer-inline"></span></p>
        </div>
    `;
    if (questions) document.getElementById('disclaimer-inline').textContent = questions.disclaimer;
    track('consent_gate_shown');
    document.getElementById('consent-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('consent-btn');
        btn.disabled = true;
        document.getElementById('consent-error').textContent = '';
        try {
            const resp = await fetch('/api/scorecard/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('email').value,
                    anonId, source, ...utm,
                }),
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || 'Something went wrong.');
            subscriberId = data.subscriberId;
            localStorage.setItem('rmd-scorecard-sid', subscriberId);
            try { localStorage.setItem('rmd-email', document.getElementById('email').value); } catch {}
            window.rmdAnalytics?.identify(subscriberId);
            renderStep();
        } catch (err) {
            document.getElementById('consent-error').textContent = err.message;
            btn.disabled = false;
        }
    };
}

function renderConsent() {
    app.innerHTML = `
        <h1>Where should we send your scorecard?</h1>
        <p>You'll see your result immediately on screen — we also email it to you so you can keep it.</p>
        <div class="card">
            <form id="consent-form">
                <label for="email"><b>Email address</b></label>
                <input type="email" id="email" required autocomplete="email" placeholder="you@example.com">
                <label class="consent">
                    <input type="checkbox" checked disabled>
                    <span>Email me my RateMyDutch exam-readiness scorecard.</span>
                </label>
                <div class="error" id="consent-error"></div>
                <button class="btn" type="submit" id="consent-btn">Continue to the questions</button>
            </form>
            <p class="muted" style="margin-top:1rem">We only use your email for the purposes above.
            Unsubscribing always works with one click. <span id="disclaimer-inline"></span></p>
        </div>
    `;
    if (questions) document.getElementById('disclaimer-inline').textContent = questions.disclaimer;
    document.getElementById('consent-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('consent-btn');
        btn.disabled = true;
        document.getElementById('consent-error').textContent = '';
        try {
            const resp = await fetch('/api/scorecard/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('email').value,
                    anonId, source, ...utm,
                }),
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || 'Something went wrong.');
            subscriberId = data.subscriberId;
            localStorage.setItem('rmd-scorecard-sid', subscriberId);
            try { localStorage.setItem('rmd-email', document.getElementById('email').value); } catch {}
            window.rmdAnalytics?.identify(subscriberId);
            startQuestions();
        } catch (err) {
            document.getElementById('consent-error').textContent = err.message;
            btn.disabled = false;
        }
    };
}

async function loadQuestions() {
    if (questions) return questions;
    const resp = await fetch('/api/scorecard/questions');
    questions = await resp.json();
    const d = document.getElementById('disclaimer');
    if (d) d.textContent = questions.disclaimer;
    return questions;
}

async function startQuestions() {
    await loadQuestions();
    steps = [
        ...questions.context.map(q => ({ type: 'context', q })),
        ...questions.selfAssessment.items.map(q => ({ type: 'self', q })),
        ...questions.diagnostic.map(q => ({ type: 'diagnostic', q })),
    ];
    stepIndex = 0;
    startedAt = new Date().toISOString();
    renderStep();
}

function renderStep() {
    if (stepIndex >= steps.length) return submit();
    // Flow v3: the email ask sits after 3 answered questions, not before Q1.
    if (flowV2 && stepIndex === 3 && !subscriberId) return renderConsentGate();
    const { type, q } = steps[stepIndex];
    const options = type === 'self' ? questions.selfAssessment.scale : q.options;
    const pct = Math.round((stepIndex / steps.length) * 100);
    const sectionLabel = type === 'context' ? 'About your exam'
        : type === 'self' ? 'Self-assessment' : 'Quick check';
    const isLandingStep = flowV2 && stepIndex === 0 && !subscriberId;

    app.innerHTML = `
        ${isLandingStep ? `
        <h1>Am I ready for the inburgeringsexamen?</h1>
        <p class="lede">Answer ${steps.length} short questions and see your readiness score for every
        exam skill, plus a focused plan for the next seven days. Free — about 4 minutes.</p>` : ''}
        <p class="muted">${sectionLabel} — question ${stepIndex + 1} of ${steps.length}</p>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <h1 style="font-size:1.35rem">${q.text}</h1>
        <div id="options"></div>
        ${stepIndex > 0 ? '<button class="btn btn-ghost" id="back-btn" style="margin-top:1rem">Back</button>' : ''}
        ${isLandingStep ? `
        <p class="muted" style="margin-top:2.5rem">You'll get: a readiness band for Spreken, Luisteren,
        Lezen, Schrijven and KNM · your one priority skill · three concrete exercises for this week.</p>
        <p class="muted" style="margin-top:1rem" id="disclaimer"></p>` : ''}
    `;
    if (isLandingStep && questions.disclaimer) {
        document.getElementById('disclaimer').textContent = questions.disclaimer;
    }
    const box = document.getElementById('options');
    for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'option' + (answers[q.id] === opt.id ? ' selected' : '');
        btn.textContent = opt.text;
        btn.onclick = () => {
            answers[q.id] = opt.id;
            if (!startedEventSent) { startedEventSent = true; track('scorecard_started'); }
            stepIndex++;
            renderStep();
        };
        box.appendChild(btn);
    }
    const back = document.getElementById('back-btn');
    if (back) back.onclick = () => { stepIndex--; renderStep(); };
}

async function submit() {
    app.innerHTML = '<h1>Calculating your result…</h1>';
    try {
        const resp = await fetch('/api/scorecard/submit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriberId, answers, startedAt }),
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Something went wrong.');
        renderResult(data.result);
    } catch (err) {
        app.innerHTML = `
            <h1>Sorry — that didn't work</h1>
            <p class="error">${err.message}</p>
            <button class="btn" id="retry-btn">Try again</button>`;
        document.getElementById('retry-btn').onclick = submit;
    }
}

const SKILL_LABELS = {
    speaking: 'Spreken (Speaking)', listening: 'Luisteren (Listening)',
    reading: 'Lezen (Reading)', writing: 'Schrijven (Writing)', knowledge: 'KNM (Dutch society)',
};

// v2 funnel: inline question + Google sign-up + checkout on this page.
// Default-on (production-verified 2026-08-10); ?flow=v1 is the escape hatch.
const flowV2 = params.get('flow') !== 'v1';

function renderResult(r) {
    try { localStorage.setItem('rmd-last-result', JSON.stringify(r)); } catch {}
    const rows = Object.entries(r.skills).map(([skill, pct]) => `
        <div class="skill-row">
            <span class="name">${SKILL_LABELS[skill]}</span>
            <div class="bar"><div style="width:${pct}%"></div></div>
            <span class="pct">${pct}%</span>
        </div>`).join('');

    app.innerHTML = `
        <p class="muted">Your exam-readiness scorecard</p>
        <h1>${r.overall}% — ${r.band.label}</h1>
        <p class="lede">${r.band.summary}</p>
        <div class="card">${rows}</div>
        <div class="card">
            <h2>Start with: ${r.plan.label}</h2>
            <p>${r.plan.why}</p>
            <p style="margin-top:.75rem"><b>Your next seven days:</b></p>
            <ol class="plan">${r.plan.exercises.map(e => `<li>${e}</li>`).join('')}</ol>
            <p style="margin-top:.75rem">${r.plan.appAction}</p>
            <p style="margin-top:1rem">
                ${flowV2
                    ? `<a id="cta-btn" href="/?src=scorecard#${r.plan.appMode}">Browse all ${r.plan.label.split(' ')[0].toLowerCase()} exercises in the app</a>`
                    : `<a class="btn" id="cta-btn" href="/?src=scorecard#${r.plan.appMode}">Practise ${r.plan.label.split(' ')[0]} now — free</a>`}
            </p>
        </div>
        ${flowV2 ? '<div id="inline-practice"></div>' : ''}
        ${localStorage.getItem('rmd-marketing-optin') ? '' : `
        <div class="card" id="optin-card">
            <h2>Keep this plan on track</h2>
            <p>We'll email you your seven-day ${r.plan.label.split(' ')[0].toLowerCase()} plan, plus
            inburgering preparation tips and RateMyDutch product updates. Unsubscribe any time with one click.</p>
            <p style="margin-top:.75rem"><button class="btn" id="optin-btn">Email me my 7-day plan</button></p>
            <div class="error" id="optin-error"></div>
        </div>`}
        <p class="muted">We've also emailed this result to you (check spam the first time).</p>
        <p class="muted" style="margin-top:1.5rem">${r.disclaimer}</p>
    `;
    track('result_viewed', { band: r.band.id, focus: r.focus });
    document.getElementById('cta-btn').addEventListener('click', () => track('cta_clicked', { focus: r.focus }));
    if (flowV2) {
        renderInlinePractice(document.getElementById('inline-practice'), r.focus)
            .catch((err) => console.error('inline practice failed:', err));
    }
    const optinBtn = document.getElementById('optin-btn');
    if (optinBtn) optinBtn.onclick = async () => {
        optinBtn.disabled = true;
        try {
            const resp = await fetch('/api/scorecard/marketing-opt-in', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscriberId, anonId, source, ...utm }),
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || 'Something went wrong.');
            localStorage.setItem('rmd-marketing-optin', '1');
            document.getElementById('optin-card').innerHTML =
                '<h2>You\'re in</h2><p>Your first email arrives within a day or two. Tot snel!</p>';
        } catch (err) {
            document.getElementById('optin-error').textContent = err.message;
            optinBtn.disabled = false;
        }
    };
}

// ===== boot =====
initInlinePractice(track);
const checkoutParam = params.get('checkout');
const savedResult = (() => {
    try { return JSON.parse(localStorage.getItem('rmd-last-result')); } catch { return null; }
})();

if (checkoutParam === 'success' || checkoutParam === 'cancelled') {
    // Back from Stripe: resume the funnel, not the landing page.
    renderCheckoutReturn(app, checkoutParam === 'success');
    track(checkoutParam === 'success' ? 'checkout_returned_success' : 'checkout_returned_cancelled');
} else if (savedResult && (loadState().pendingRedirect || (flowV2 && loadState().stage))) {
    // Back from a Google auth redirect (or reload mid-funnel): re-render the
    // result screen so the inline flow can pick up where the tap left off.
    renderResult(savedResult);
} else {
    track('landing_viewed');
    if (flowV2) renderLandingV3(); else renderLanding();
}
