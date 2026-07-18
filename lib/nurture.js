// Nurture sequence (emails 1-5, day 1/3/6/10/14) from the acquisition plan.
// All consent, suppression, and paid-stop logic lives here — the external
// scheduler (n8n) only calls POST /api/nurture/run daily with the shared secret.
// Idempotent: sends are recorded in `nurture_sends`, one email max per
// subscriber per run, and a late/backlogged subscriber gets only the latest
// due email (earlier ones are marked skipped, never burst-sent).
const firebase = require('./firebase');
const rubric = require('./scorecard-rubric.v1.json');
const { sendNurtureEmail } = require('./email');

const SEQUENCE = [
    { no: 1, day: 1 },
    { no: 2, day: 3 },
    { no: 3, day: 6 },
    { no: 4, day: 10 },
    { no: 5, day: 14 },
];

function buildEmail({ no, plan, band, origin, unsubscribeUrl }) {
    const cta = (label, path) =>
        `<p style="margin:24px 0"><a href="${origin}${path}" style="background:#d4652a;color:#fdfcfa;padding:12px 24px;text-decoration:none;border-radius:4px">${label}</a></p>`;
    const skill = plan.label;

    switch (no) {
        case 1: return {
            subject: `Why ${skill} feels hard — and what actually helps`,
            body: `
<p>Yesterday your scorecard pointed at <b>${skill}</b> as the skill to work on first. Here's why that's normal:</p>
<p>${plan.why}</p>
<p><b>One exercise for today (10 minutes):</b></p>
<p>${plan.exercises[0]}</p>
<p>${plan.appAction}</p>
${cta(`Practise ${skill.split(' ')[0]} now`, `/?src=nurture1#${plan.appMode}`)}`,
        };
        case 2: return {
            subject: `Your 7-day plan for ${skill}`,
            body: `
<p>Three short sessions this week beat one long one. Here's your plan, built from your scorecard result:</p>
<ol>${plan.exercises.map(e => `<li style="margin-bottom:8px">${e}</li>`).join('')}</ol>
<p>Each takes 10–15 minutes. Tick one off today.</p>
${cta('Do session 1 on RateMyDutch', `/?src=nurture2#${plan.appMode}`)}`,
        };
        case 3: return {
            subject: `How do you know your Dutch is improving?`,
            body: `
<p>The honest answer: measure it the way the exam does.</p>
<p>Pick one task you did on day 1 — for ${skill}, that was: <i>${plan.exercises[0]}</i> — and do it again today. Compare: fewer pauses? Fewer lookups? That gap is your progress, and it's usually bigger than it feels.</p>
<p>On RateMyDutch every practice section uses the real exam format, so your practice scores translate directly.</p>
${cta('Check your progress', `/?src=nurture3#${plan.appMode}`)}`,
        };
        case 4: return {
            subject: `Everything RateMyDutch does for your ${skill} — €24, once`,
            body: `
<p>You've seen the free practice sections. The full version adds what self-study can't give you: <b>graded feedback</b>.</p>
<p>For ${skill}: ${plan.appAction}</p>
<p>Lifetime access is a one-time <b>€24</b> — no subscription. It covers AI grading for writing on the official DUO rubric, and speech transcription + grading for speaking. Everything else stays free either way.</p>
${cta('Unlock full access — €24 once', '/?src=nurture4')}`,
        };
        case 5: return {
            subject: `Last one from us — your ${skill} checklist`,
            body: `
<p>This is the final email in your scorecard series. Before we go, a checklist worth keeping:</p>
<ol>
<li>Practise your weakest skill (${skill}) first, not your favourite.</li>
<li>Always practise in exam format — timed, one attempt, no dictionary.</li>
<li>${plan.exercises[1]}</li>
<li>Book the exam when you're scoring comfortably in practice — a date focuses the mind.</li>
</ol>
<p>You can retake your readiness scorecard any time to see how far you've come.</p>
${cta('Retake the scorecard', '/scorecard?src=nurture5')}
<p>Veel succes met je examen! 🇳🇱</p>`,
        };
        default: return null;
    }
}

async function hasPaid(db, email) {
    const snap = await db.collection('entitlements').where('email', '==', email).get();
    return snap.docs.some(d => d.data().paid === true);
}

// Returns the plan/copy inputs from the subscriber's latest completed assessment.
async function latestAssessment(db, sid) {
    const snap = await db.collection('assessments')
        .where('subscriber_id', '==', sid).get();
    let best = null;
    for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.completed_at) continue;
        if (!best || d.completed_at.toMillis() > best.completed_at.toMillis()) best = d;
    }
    return best;
}

async function runNurture({ dryRun = false, now = Date.now() } = {}) {
    const db = firebase.getDb();
    const summary = { checked: 0, sent: [], skipped: [], errors: [] };

    const subs = await db.collection('subscribers')
        .where('marketing_consent', '==', true).get();

    for (const doc of subs.docs) {
        const sub = doc.data();
        summary.checked++;
        if (sub.subscriber_status !== 'active') continue;

        try {
            if (await hasPaid(db, sub.email)) {
                summary.skipped.push({ sid: doc.id, reason: 'paid' });
                continue;
            }
            const assessment = await latestAssessment(db, doc.id);
            if (!assessment) { summary.skipped.push({ sid: doc.id, reason: 'no_assessment' }); continue; }

            const days = Math.floor((now - assessment.completed_at.toMillis()) / 86400000);
            const due = SEQUENCE.filter(s => days >= s.day);
            if (due.length === 0) continue;

            const sendsSnap = await db.collection('nurture_sends')
                .where('subscriber_id', '==', doc.id).get();
            const done = new Set(sendsSnap.docs.map(d => d.data().email_no));
            const pending = due.filter(s => !done.has(s.no));
            if (pending.length === 0) continue;

            // Latest due email wins; older unsent ones are retired as skipped.
            const target = pending[pending.length - 1];
            const stale = pending.slice(0, -1);

            if (dryRun) {
                summary.sent.push({ sid: doc.id, email: sub.email, email_no: target.no, dryRun: true });
                continue;
            }

            const focus = assessment.recommended_focus || 'listening';
            const plan = rubric.skillPlans[focus] || rubric.skillPlans.listening;
            const origin = process.env.APP_ORIGIN || 'https://ratemydutch.com';
            const { signSubscriber } = require('./scorecard');
            const unsubscribeUrl = `${origin}/api/unsubscribe?sid=${doc.id}&sig=${signSubscriber(doc.id)}`;
            const email = buildEmail({ no: target.no, plan, band: assessment.overall_band, origin, unsubscribeUrl });

            await sendNurtureEmail({
                to: sub.email, subject: email.subject, body: email.body,
                unsubscribeUrl, disclaimer: rubric.disclaimer,
            });
            const batch = db.batch();
            batch.set(db.collection('nurture_sends').doc(`${doc.id}_${target.no}`), {
                subscriber_id: doc.id, email_no: target.no, status: 'sent',
                sent_at: firebase.FieldValue.serverTimestamp(),
            });
            for (const s of stale) {
                batch.set(db.collection('nurture_sends').doc(`${doc.id}_${s.no}`), {
                    subscriber_id: doc.id, email_no: s.no, status: 'skipped_stale',
                    sent_at: firebase.FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            summary.sent.push({ sid: doc.id, email: sub.email, email_no: target.no });
        } catch (err) {
            console.error(`nurture error for ${doc.id}:`, err.message);
            summary.errors.push({ sid: doc.id, error: err.message });
        }
    }
    return summary;
}

module.exports = { runNurture, buildEmail, SEQUENCE };
