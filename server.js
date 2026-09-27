const express = require('express');
const path = require('path');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const Stripe = require('stripe');
const firebase = require('./lib/firebase');
const { createPaywall } = require('./lib/paywall');
const { createWebhookHandler } = require('./lib/stripe-webhook');
const { createScorecardRouter } = require('./lib/scorecard');
const { createSessionAuth } = require('./lib/session-auth');
const { buildCheckoutSessionParams, prefillCountry } = require('./lib/checkout');
const { sendPurchaseEmail } = require('./lib/email');
const gp = require('./lib/grading-prompts');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const { requireAuth, requirePaid, requirePaidOrFreeGrade } = createPaywall({
    verifyIdToken: firebase.verifyIdToken,
    getEntitlement: firebase.getEntitlement,
    consumeFreeGrade: firebase.consumeFreeGrade,
});

const app = express();

// Post-payment side effects, deduped per session across Stripe's at-least-once
// delivery (completed + async_payment_succeeded + retries): the ONLY place
// product_activated is recorded (it means "paid", never "clicked a CTA"),
// plus the post-purchase email deep-linking the buyer's weak skill.
async function onEntitlementGranted(session) {
    if (!(await firebase.claimOnce('activations', session.id))) return;
    const md = session.metadata || {};
    try {
        const db = firebase.getDb();
        await db.collection('funnel_events').add({
            event_name: 'product_activated',
            subscriber_id: md.subscriberId || null,
            anon_id: md.anonId || null,
            properties: {
                session_id: session.id,
                focus: md.focus || null,
                currency: session.currency || null,
                amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
            },
            ts: firebase.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('product_activated event write failed:', err.message);
    }
    const buyerEmail = (session.customer_details && session.customer_details.email) || null;
    if (buyerEmail) {
        try {
            await sendPurchaseEmail({
                to: buyerEmail,
                focus: md.focus || null,
                origin: process.env.APP_ORIGIN || 'https://ratemydutch.com',
            });
        } catch (err) {
            console.error('post-purchase email failed:', err.message);
        }
    }
}

// Stripe webhook needs the raw body — MUST be registered before express.json()
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'stripe_not_configured' });
    }
    return createWebhookHandler({
        constructEvent: (rawBody, sig) => stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET),
        writeEntitlement: firebase.writeEntitlement,
        onEntitlementGranted,
    })(req, res);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html from root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Acquisition scorecard (landing page + API). See docs/acquisition/EVENTS-AND-BASELINE.md
app.get('/scorecard', (req, res) => {
    res.sendFile(path.join(__dirname, 'scorecard.html'));
});

// Search-intent guides (acquisition channel 1)
app.get('/guides/am-i-ready-inburgering-speaking-exam', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-speaking.html'));
});
app.get('/guides/two-weeks-before-inburgeringsexamen', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-two-weeks.html'));
});
app.get('/guides/inburgeringsexamen-schrijven-a2', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-schrijven-a2.html'));
});
app.get('/guides/knm-exam-practice', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-knm.html'));
});
app.get('/guides/inburgeringsexamen-lezen-a2', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-lezen-a2.html'));
});
app.get('/guides/inburgeringsexamen-luisteren-a2', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-luisteren-a2.html'));
});
app.get('/guides/b1-inburgering-exam-staatsexamen-nt2', (req, res) => {
    res.sendFile(path.join(__dirname, 'guide-b1-staatsexamen.html'));
});
app.get('/guides', (req, res) => {
    res.sendFile(path.join(__dirname, 'guides.html'));
});

// Privacy policy (required by ad platforms' app review / Live mode)
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy.html'));
});
app.use(createScorecardRouter());

// Nurture sequence runner — called daily by the n8n scheduler. Idempotent, so a
// duplicate trigger is harmless. `?dryRun=1` reports without sending.
app.post('/api/nurture/run', async (req, res) => {
    const secret = process.env.NURTURE_CRON_SECRET;
    const auth = req.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
    }
    try {
        const { runNurture } = require('./lib/nurture');
        const summary = await runNurture({ dryRun: req.query.dryRun === '1' });
        res.json({ success: true, ...summary });
    } catch (err) {
        console.error('nurture run failed:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Passwordless session from the scorecard email — kills the second signup
// gate before the free grade. Guardrails live in lib/session-auth.js.
app.post('/api/scorecard/session-auth', createSessionAuth({
    getSubscriberEmail: firebase.getSubscriberEmail,
    getUserByEmail: firebase.getUserByEmail,
    createAuthUser: firebase.createAuthUser,
    createCustomToken: firebase.createCustomToken,
    getEntitlement: firebase.getEntitlement,
}));

app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
    if (!stripe || !STRIPE_PRICE_ID) {
        return res.status(500).json({ success: false, error: 'stripe_not_configured' });
    }
    try {
        const existing = await firebase.getEntitlement(req.user.uid);
        if (existing && existing.paid === true) {
            return res.json({ success: true, alreadyPaid: true });
        }
        const origin = process.env.APP_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        // Optional whitelisted return path so the scorecard funnel can resume
        // where the user left off instead of dumping them on the app home.
        const body = req.body || {};
        const returnTo = ['/scorecard'].includes(body.returnTo) ? body.returnTo : '/';
        const str = (v, max = 64) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

        // Prefill the billing country for nearby-EU visitors via a pre-created
        // customer (Vercel provides the GeoIP header). Best effort only.
        const geoCountry = prefillCountry(req.headers['x-vercel-ip-country']);
        const buyerEmail = req.user.email || str(body.email, 254);
        let customerId;
        if (geoCountry && buyerEmail) {
            try {
                const customer = await stripe.customers.create({
                    email: buyerEmail, address: { country: geoCountry },
                });
                customerId = customer.id;
            } catch (err) {
                console.error('Customer prefill failed (continuing without):', err.message);
            }
        }

        const params = buildCheckoutSessionParams({
            priceId: STRIPE_PRICE_ID,
            uid: req.user.uid,
            email: buyerEmail,
            origin, returnTo,
            locale: str(body.locale, 8),
            customerId,
            subscriberId: str(body.subscriberId),
            anonId: str(body.anonId),
            focus: str(body.focus, 20),
        });
        const session = await stripe.checkout.sessions.create(params);

        // checkout_opened is the "a session actually exists" event — logged
        // server-side so it can't fire on a dead CTA tap. Best effort.
        try {
            const db = firebase.getDb();
            await db.collection('funnel_events').add({
                event_name: 'checkout_opened',
                subscriber_id: str(body.subscriberId) || null,
                anon_id: str(body.anonId) || null,
                properties: {
                    currency: session.currency || 'eur',
                    locale: params.locale,
                    country: geoCountry,
                    via: str(body.via, 20) || null,
                },
                ts: firebase.FieldValue.serverTimestamp(),
            });
        } catch (err) {
            console.error('checkout_opened event write failed:', err.message);
        }

        res.json({
            success: true, url: session.url,
            currency: session.currency || 'eur', locale: params.locale, country: geoCountry,
        });
    } catch (err) {
        console.error('Checkout session creation failed:', err);
        res.status(500).json({ success: false, error: 'checkout_failed' });
    }
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const entitlement = await firebase.getEntitlement(req.user.uid);
        res.json({ success: true, paid: !!(entitlement && entitlement.paid === true) });
    } catch (err) {
        console.error('Entitlement lookup failed:', err);
        res.status(500).json({ success: false, error: 'entitlement_check_failed' });
    }
});

// Perplexity API endpoint
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Grading rubric prompts (A2 + B1) live in lib/grading-prompts.js.

app.post('/api/grade-writing', requirePaidOrFreeGrade, async (req, res) => {
    const { userText, prompt, modelAnswer } = req.body;
    const level = gp.normalizeLevel(req.body.level);

    if (!userText || userText.trim().length === 0) {
        return res.json({
            success: false,
            error: 'Please write something first!'
        });
    }

    if (!PERPLEXITY_API_KEY) {
        return res.json({
            success: false,
            error: 'API key not configured. Please set PERPLEXITY_API_KEY environment variable.'
        });
    }

    try {
        const systemPrompt = gp.writingPrompt(level);

        const userMessage = `Grade this writing submission:

**TASK PROMPT:**
${prompt}

**CANDIDATE'S ANSWER:**
${userText}

**MODEL ANSWER (for comparison):**
${modelAnswer}

Evaluate using the official DUO rubric and respond with ONLY the JSON object.`;

        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.2,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Perplexity API error:', errorText);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        let feedback = data.choices[0].message.content;

        // Try to parse JSON from the response
        // Sometimes the model wraps it in markdown code blocks
        feedback = feedback.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const gradingResult = JSON.parse(feedback);

            // Enforce the execution = 0 rule
            if (gradingResult.scores.execution.score === 0) {
                gradingResult.scores.grammar.score = 0;
                gradingResult.scores.spelling.score = 0;
                gradingResult.scores.clearness.score = 0;
                gradingResult.scores.vocabulary.score = 0;
                gradingResult.total = 0;
            }

            res.json({
                success: true,
                grading: gradingResult,
                level
            });
        } catch (parseError) {
            // If JSON parsing fails, return the raw feedback
            console.error('Failed to parse grading JSON:', parseError);
            res.json({
                success: true,
                rawFeedback: feedback,
                parseError: true,
                level
            });
        }

    } catch (error) {
        console.error('Error grading writing:', error);
        res.json({
            success: false,
            error: 'Failed to grade your text. Please try again.'
        });
    }
});

// Keep the old endpoint for backwards compatibility
app.post('/api/check-grammar', async (req, res) => {
    // Redirect to new grading endpoint
    req.url = '/api/grade-writing';
    app.handle(req, res);
});

// Speech transcription endpoint (Whisper) - uses base64 JSON body, no multer
app.post('/api/transcribe-speech', requirePaid, async (req, res) => {
    if (!OPENAI_API_KEY) {
        return res.json({ success: false, error: 'OPENAI_API_KEY not configured.' });
    }

    const { audio, mimeType } = req.body;
    if (!audio) {
        return res.json({ success: false, error: 'No audio data received.' });
    }

    try {
        // Decode base64 to buffer
        const audioBuffer = Buffer.from(audio, 'base64');

        // Build multipart form manually for OpenAI Whisper API
        const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
        const ext = (mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';

        const formParts = [];
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.${ext}"\r\nContent-Type: ${mimeType || 'audio/webm'}\r\n\r\n`);
        formParts.push(audioBuffer);
        formParts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`);
        formParts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nnl`);
        formParts.push(`\r\n--${boundary}--\r\n`);

        const body = Buffer.concat(formParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

        const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: body,
        });

        if (!whisperResp.ok) {
            const errText = await whisperResp.text();
            console.error('Whisper API error:', whisperResp.status, errText);
            return res.json({ success: false, error: `Whisper API error ${whisperResp.status}: ${errText}` });
        }

        const result = await whisperResp.json();
        res.json({ success: true, transcription: result.text });
    } catch (error) {
        console.error('Transcription error:', error.message || error);
        res.json({ success: false, error: `Transcription failed: ${error.message || 'Unknown error'}` });
    }
});

// Speaking grading endpoint (rubric prompts in lib/grading-prompts.js)
app.post('/api/grade-speaking', requirePaid, async (req, res) => {
    const { transcription, prompt, partType } = req.body;
    const level = gp.normalizeLevel(req.body.level);
    const taskType = ['short', 'long'].includes(req.body.taskType) ? req.body.taskType : undefined;

    if (!transcription || transcription.trim().length === 0) {
        return res.json({ success: false, error: 'No transcription to grade.' });
    }
    if (!PERPLEXITY_API_KEY) {
        return res.json({ success: false, error: 'PERPLEXITY_API_KEY not configured.' });
    }

    try {
        const systemPrompt = gp.speakingPrompt(level, { taskType });

        const userMessage = `Grade this speaking response:

**TASK:** ${prompt}
**PART TYPE:** ${partType}
**CANDIDATE'S TRANSCRIBED RESPONSE:** ${transcription}

Evaluate and respond with ONLY the JSON object.`;

        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.2,
                max_tokens: 2000
            })
        });

        if (!response.ok) throw new Error(`API request failed: ${response.status}`);

        const data = await response.json();
        let feedback = data.choices[0].message.content;
        feedback = feedback.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const gradingResult = JSON.parse(feedback);
            res.json({ success: true, grading: gradingResult, level });
        } catch (parseError) {
            res.json({ success: true, rawFeedback: feedback, parseError: true, level });
        }
    } catch (error) {
        console.error('Speaking grading error:', error);
        res.json({ success: false, error: 'Failed to grade speaking.' });
    }
});

// Export for Vercel serverless
module.exports = app;

// Start server when running locally (not on Vercel)
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3456;
    app.listen(PORT, () => {
        console.log(`\n🇳🇱 Inburgeringsexamen Practice App running at http://localhost:${PORT}\n`);
        if (!PERPLEXITY_API_KEY) {
            console.log('⚠️  Warning: PERPLEXITY_API_KEY not set. AI grading will not work.');
            console.log('   Run with: PERPLEXITY_API_KEY=your_key npm start\n');
        } else {
            console.log('✅ Perplexity API key configured. AI grading enabled.\n');
        }
        if (!OPENAI_API_KEY) {
            console.log('⚠️  Warning: OPENAI_API_KEY not set. Speech transcription will not work.');
            console.log('   Run with: OPENAI_API_KEY=your_key npm start\n');
        } else {
            console.log('✅ OpenAI API key configured. Speech transcription enabled.\n');
        }
        if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
            console.log('⚠️  Warning: STRIPE_SECRET_KEY and/or STRIPE_PRICE_ID not set. Checkout will not work.');
            console.log('   Run with: STRIPE_SECRET_KEY=sk_... STRIPE_PRICE_ID=price_... npm start\n');
        } else {
            console.log('✅ Stripe configured. Checkout enabled.\n');
        }
        if (!STRIPE_WEBHOOK_SECRET) {
            console.log('⚠️  Warning: STRIPE_WEBHOOK_SECRET not set. Stripe webhooks will not work.\n');
        }
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
            console.log('⚠️  Warning: FIREBASE_SERVICE_ACCOUNT not set. Auth verification and entitlements will not work.\n');
        }
        if (!process.env.APP_ORIGIN) {
            console.log('⚠️  Warning: APP_ORIGIN not set. Checkout return URLs will be derived from request headers; set APP_ORIGIN in production.\n');
        }
    });
}
