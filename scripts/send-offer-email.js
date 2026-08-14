// One-off product-offer email ("offer1") to marketing-consented subscribers.
// Mirrors lib/nurture.js eligibility: marketing_consent, active, not paid.
// Idempotent via offer_sends/{sid}_offer1. Run: node scripts/send-offer-email.js [--send]
// Minimal .env loader (no dotenv dependency in this repo).
const fs = require('fs');
for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const firebase = require('../lib/firebase');
const { sendNurtureEmail } = require('../lib/email');
const { signSubscriber } = require('../lib/scorecard');
const rubric = require('../lib/scorecard-rubric.v1.json');

const SKILL_LABELS = {
    speaking: 'Spreken (Speaking)', listening: 'Luisteren (Listening)',
    reading: 'Lezen (Reading)', writing: 'Schrijven (Writing)', knowledge: 'KNM (Dutch society)',
};

async function hasPaid(db, email) {
    const snap = await db.collection('entitlements').where('email', '==', email).get();
    return snap.docs.some(d => d.data().paid === true);
}

async function latestAssessment(db, sid) {
    const snap = await db.collection('assessments').where('subscriber_id', '==', sid).get();
    let best = null;
    for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.completed_at) continue;
        if (!best || d.completed_at.toMillis() > best.completed_at.toMillis()) best = d;
    }
    return best;
}

function buildOfferEmail({ focus, origin, unsubscribeUrl }) {
    const label = SKILL_LABELS[focus] || SKILL_LABELS.listening;
    const shortLabel = label.split(' ')[0];
    const plan = rubric.skillPlans[focus] || rubric.skillPlans.listening;
    const appMode = plan.appMode || 'luisteren';
    const cta = `${origin}/?src=offer-email&utm_source=email&utm_medium=email&utm_campaign=offer1#${appMode}`;
    const subject = `Your scorecard said: start with ${shortLabel}. Here's the fastest way.`;
    const body = `
<p>Hi,</p>
<p>A short one. When you took the readiness scorecard, your priority skill came out as
<b>${label}</b> — so I wanted to make sure you know what RateMyDutch actually does beyond the score.</p>
<p>The practice app grades your <b>real writing and speaking with AI, against the official DUO
rubric</b> — the same categories the examiners score you on — and tells you specifically what to
fix. Listening, reading and KNM practice with real exam-style questions are free.</p>
<p><b>Your first AI grade is free</b>, so you can see exactly how the feedback works.
After that it's a one-time €24 for lifetime access — no subscription.</p>
<p style="margin:1.5em 0"><a href="${cta}"
style="background:#d4652a;color:#fdfcfa;padding:12px 22px;border-radius:5px;text-decoration:none;font-weight:600">
Try a ${shortLabel} exercise — free</a></p>
<p>Groetjes,<br>Youssef<br><span style="color:#6b7280">RateMyDutch</span></p>`;
    return { subject, body };
}

async function main() {
    const send = process.argv.includes('--send');
    const db = firebase.getDb();
    const origin = process.env.APP_ORIGIN || 'https://ratemydutch.com';
    const subs = await db.collection('subscribers').where('marketing_consent', '==', true).get();
    const summary = { eligible: 0, sent: [], skipped: [] };

    for (const doc of subs.docs) {
        const sub = doc.data();
        if (sub.subscriber_status !== 'active') { summary.skipped.push([doc.id, 'not_active']); continue; }
        if (await hasPaid(db, sub.email)) { summary.skipped.push([doc.id, 'paid']); continue; }
        const already = await db.collection('offer_sends').doc(`${doc.id}_offer1`).get();
        if (already.exists) { summary.skipped.push([doc.id, 'already_sent']); continue; }
        const assessment = await latestAssessment(db, doc.id);
        const focus = assessment?.recommended_focus || 'listening';
        summary.eligible++;

        const unsubscribeUrl = `${origin}/api/unsubscribe?sid=${doc.id}&sig=${signSubscriber(doc.id)}`;
        const email = buildOfferEmail({ focus, origin, unsubscribeUrl });

        if (!send) {
            summary.sent.push({ sid: doc.id, email: sub.email, focus, subject: email.subject, dryRun: true });
            continue;
        }
        await sendNurtureEmail({
            to: sub.email, subject: email.subject, body: email.body,
            unsubscribeUrl, disclaimer: rubric.disclaimer,
        });
        await db.collection('offer_sends').doc(`${doc.id}_offer1`).set({
            subscriber_id: doc.id, offer: 'offer1', status: 'sent',
            sent_at: firebase.FieldValue.serverTimestamp(),
        });
        summary.sent.push({ sid: doc.id, email: sub.email, focus });
    }
    console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
