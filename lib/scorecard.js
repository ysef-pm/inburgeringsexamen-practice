// Consent-first acquisition scorecard: questions, deterministic scoring,
// subscriber/consent/assessment persistence, funnel events, unsubscribe.
// Design doc: docs/acquisition/EVENTS-AND-BASELINE.md
const crypto = require('crypto');
const express = require('express');
const firebase = require('./firebase');
const rubric = require('./scorecard-rubric.v1.json');
const { sendScorecardEmail } = require('./email');

const NOTICE_VERSION = '2026-07-18.1';
const EVENT_NAMES = new Set([
    'landing_viewed', 'consent_confirmed', 'scorecard_started',
    'scorecard_completed', 'result_viewed', 'cta_clicked', 'product_activated',
]);

// Unsubscribe links are signed so status can be flipped without auth. Falls back
// to a secret derived from the (stable) service account so no new env var is
// strictly required for the pilot.
function unsubSecret() {
    if (process.env.SCORECARD_SECRET) return process.env.SCORECARD_SECRET;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || 'dev-secret';
    return crypto.createHash('sha256').update('scorecard:' + raw).digest('hex');
}

function signSubscriber(sid) {
    return crypto.createHmac('sha256', unsubSecret()).update(sid).digest('hex').slice(0, 32);
}

function appOrigin(req) {
    return process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

function cleanUtm(body) {
    const out = {};
    for (const k of ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
        if (typeof body[k] === 'string' && body[k].length <= 200) out[k] = body[k];
    }
    return out;
}

async function logEvent(db, fields) {
    await db.collection('funnel_events').add({
        ...fields,
        ts: firebase.FieldValue.serverTimestamp(),
    });
}

// ===== Deterministic scoring =====
function scoreAnswers(answers) {
    const max = {};
    const got = {};
    for (const skill of rubric.skills) { max[skill] = 0; got[skill] = 0; }

    for (const item of rubric.selfAssessment.items) {
        max[item.skill] += 2;
        const choice = rubric.selfAssessment.scale.find(s => s.id === answers[item.id]);
        got[item.skill] += choice ? choice.points : 0;
    }
    for (const q of rubric.diagnostic) {
        max[q.skill] += q.points;
        if (answers[q.id] === q.correct) got[q.skill] += q.points;
    }

    const skills = {};
    let sum = 0;
    for (const skill of rubric.skills) {
        const pct = Math.round((got[skill] / max[skill]) * 100);
        skills[skill] = pct;
        sum += pct;
    }
    const overall = Math.round(sum / rubric.skills.length);
    const band = rubric.bands.find(b => overall >= b.min && overall <= b.max) || rubric.bands[0];

    // Weakest skill wins; the user's own "hardest part" answer breaks ties.
    let focus = rubric.skills[0];
    for (const skill of rubric.skills) {
        if (skills[skill] < skills[focus]) focus = skill;
        else if (skills[skill] === skills[focus] && answers.ctx_hardest === skill) focus = skill;
    }
    return { skills, overall, band, focus };
}

function createScorecardRouter() {
    const router = express.Router();

    // Questions only — correct answers and points stay server-side.
    router.get('/api/scorecard/questions', (req, res) => {
        res.json({
            version: rubric.version,
            context: rubric.context,
            selfAssessment: {
                scale: rubric.selfAssessment.scale.map(({ id, text }) => ({ id, text })),
                items: rubric.selfAssessment.items.map(({ id, text }) => ({ id, text })),
            },
            diagnostic: rubric.diagnostic.map(({ id, text, options }) => ({ id, text, options })),
            disclaimer: rubric.disclaimer,
        });
    });

    // Opt-in: create/refresh subscriber + append consent events.
    router.post('/api/scorecard/subscribe', async (req, res) => {
        const { email, marketingConsent, anonId, examTimeline } = req.body || {};
        if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
            return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
        }
        try {
            const db = firebase.getDb();
            const normalized = email.trim().toLowerCase();
            const utm = cleanUtm(req.body || {});

            const existing = await db.collection('subscribers')
                .where('email', '==', normalized).limit(1).get();

            let sid;
            if (!existing.empty) {
                sid = existing.docs[0].id;
                const status = existing.docs[0].data().subscriber_status;
                // A withdrawn user must actively opt in again; this request is that action.
                if (status === 'unsubscribed' && !marketingConsent) {
                    // Scorecard delivery is still fine — it's a direct request, not marketing.
                }
            } else {
                const doc = await db.collection('subscribers').add({
                    email: normalized,
                    created_at: firebase.FieldValue.serverTimestamp(),
                    exam_timeline_bucket: typeof examTimeline === 'string' ? examTimeline.slice(0, 40) : null,
                    subscriber_status: 'active',
                    ...utm,
                });
                sid = doc.id;
            }

            const consents = db.collection('consent_events');
            await consents.add({
                subscriber_id: sid, consent_type: 'scorecard_delivery', action: 'granted',
                notice_version: NOTICE_VERSION, source_page: '/scorecard',
                ts: firebase.FieldValue.serverTimestamp(),
            });
            if (marketingConsent === true) {
                await consents.add({
                    subscriber_id: sid, consent_type: 'marketing', action: 'granted',
                    notice_version: NOTICE_VERSION, source_page: '/scorecard',
                    ts: firebase.FieldValue.serverTimestamp(),
                });
                await db.collection('subscribers').doc(sid).set(
                    { subscriber_status: 'active', marketing_consent: true }, { merge: true });
            }

            await logEvent(db, {
                event_name: 'consent_confirmed', subscriber_id: sid,
                anon_id: typeof anonId === 'string' ? anonId.slice(0, 64) : null, ...utm,
            });
            res.json({ success: true, subscriberId: sid });
        } catch (err) {
            console.error('scorecard subscribe error:', err);
            res.status(500).json({ success: false, error: 'Could not save your details. Please try again.' });
        }
    });

    // Submit answers: score, persist, email the result.
    router.post('/api/scorecard/submit', async (req, res) => {
        const { subscriberId, answers, startedAt } = req.body || {};
        if (!subscriberId || typeof answers !== 'object' || answers === null) {
            return res.status(400).json({ success: false, error: 'Missing answers.' });
        }
        const requiredIds = [
            ...rubric.selfAssessment.items.map(i => i.id),
            ...rubric.diagnostic.map(q => q.id),
        ];
        const missing = requiredIds.filter(id => typeof answers[id] !== 'string');
        if (missing.length > 0) {
            return res.status(400).json({ success: false, error: 'Please answer all questions.', missing });
        }
        try {
            const db = firebase.getDb();
            const subSnap = await db.collection('subscribers').doc(String(subscriberId)).get();
            if (!subSnap.exists) return res.status(400).json({ success: false, error: 'Unknown subscriber.' });

            const { skills, overall, band, focus } = scoreAnswers(answers);
            const plan = rubric.skillPlans[focus];

            await db.collection('assessments').add({
                subscriber_id: subSnap.id,
                started_at: typeof startedAt === 'string' ? startedAt : null,
                completed_at: firebase.FieldValue.serverTimestamp(),
                rubric_version: rubric.version,
                speaking_score: skills.speaking, listening_score: skills.listening,
                reading_score: skills.reading, writing_score: skills.writing,
                knowledge_score: skills.knowledge,
                overall_band: band.id, recommended_focus: focus,
                context: {
                    route: answers.ctx_route || null,
                    timeline: answers.ctx_timeline || null,
                    hardest: answers.ctx_hardest || null,
                },
            });
            await logEvent(db, { event_name: 'scorecard_completed', subscriber_id: subSnap.id });

            const origin = appOrigin(req);
            const unsubscribeUrl = `${origin}/api/unsubscribe?sid=${subSnap.id}&sig=${signSubscriber(subSnap.id)}`;
            // Transactional delivery of the requested result; never blocks the response.
            sendScorecardEmail({
                to: subSnap.data().email,
                overall, bandLabel: band.label, bandSummary: band.summary,
                skills, plan, origin, unsubscribeUrl,
                disclaimer: rubric.disclaimer,
            }).catch(err => console.error('scorecard email failed:', err.message));

            res.json({
                success: true,
                result: {
                    overall, band: { id: band.id, label: band.label, summary: band.summary },
                    skills, focus, plan, disclaimer: rubric.disclaimer,
                },
            });
        } catch (err) {
            console.error('scorecard submit error:', err);
            res.status(500).json({ success: false, error: 'Could not calculate your result. Please try again.' });
        }
    });

    // Client-side funnel events (whitelisted names only).
    router.post('/api/events', async (req, res) => {
        const { event_name, anonId, subscriberId, properties } = req.body || {};
        if (!EVENT_NAMES.has(event_name)) return res.status(400).json({ success: false });
        try {
            const db = firebase.getDb();
            await logEvent(db, {
                event_name,
                anon_id: typeof anonId === 'string' ? anonId.slice(0, 64) : null,
                subscriber_id: typeof subscriberId === 'string' ? subscriberId.slice(0, 64) : null,
                ...cleanUtm(req.body || {}),
                properties: (properties && typeof properties === 'object') ? properties : null,
            });
            res.json({ success: true });
        } catch (err) {
            // Analytics must never break the user experience.
            res.json({ success: true });
        }
    });

    // Signed one-click unsubscribe → suppression.
    router.get('/api/unsubscribe', async (req, res) => {
        const { sid, sig } = req.query;
        if (!sid || sig !== signSubscriber(String(sid))) {
            return res.status(400).send('Invalid unsubscribe link.');
        }
        try {
            const db = firebase.getDb();
            await db.collection('subscribers').doc(String(sid)).set(
                { subscriber_status: 'unsubscribed', marketing_consent: false }, { merge: true });
            await db.collection('consent_events').add({
                subscriber_id: String(sid), consent_type: 'marketing', action: 'withdrawn',
                notice_version: NOTICE_VERSION, source_page: '/api/unsubscribe',
                ts: firebase.FieldValue.serverTimestamp(),
            });
            res.send('<html><body style="font-family:Georgia,serif;max-width:32rem;margin:4rem auto;text-align:center"><h2>You are unsubscribed</h2><p>You will not receive further marketing emails from RateMyDutch.</p></body></html>');
        } catch (err) {
            console.error('unsubscribe error:', err);
            res.status(500).send('Something went wrong. Email us and we will remove you manually.');
        }
    });

    return router;
}

module.exports = { createScorecardRouter, scoreAnswers };
