// Transactional email via Resend's HTTP API (no SDK dependency). The provider
// is intentionally replaceable: everything provider-specific lives in send().
// Unconfigured (no RESEND_API_KEY) → emails are skipped and logged, the on-screen
// result remains the source of truth.
const RESEND_URL = 'https://api.resend.com/emails';

function isConfigured() {
    return !!process.env.RESEND_API_KEY;
}

async function send({ to, subject, html }) {
    if (!isConfigured()) {
        console.log(`[email skipped — RESEND_API_KEY not set] to=${to} subject="${subject}"`);
        return { skipped: true };
    }
    const from = process.env.EMAIL_FROM || 'RateMyDutch <scorecard@ratemydutch.com>';
    const resp = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Resend ${resp.status}: ${body.slice(0, 300)}`);
    }
    return resp.json();
}

const SKILL_LABELS = {
    speaking: 'Spreken (Speaking)', listening: 'Luisteren (Listening)',
    reading: 'Lezen (Reading)', writing: 'Schrijven (Writing)', knowledge: 'KNM (Dutch society)',
};

function bar(pct) {
    const filled = Math.round(pct / 10);
    return `<span style="color:#d4652a">${'&#9632;'.repeat(filled)}</span><span style="color:#ebe6df">${'&#9632;'.repeat(10 - filled)}</span>`;
}

// Email 0 — transactional delivery of the requested scorecard result.
function sendScorecardEmail({ to, overall, bandLabel, bandSummary, skills, plan, origin, unsubscribeUrl, disclaimer }) {
    const skillRows = Object.entries(skills).map(([skill, pct]) =>
        `<tr><td style="padding:4px 12px 4px 0">${SKILL_LABELS[skill]}</td><td style="padding:4px 12px 4px 0;font-family:monospace">${bar(pct)}</td><td style="padding:4px 0"><b>${pct}%</b></td></tr>`
    ).join('');

    const html = `
<div style="font-family:Georgia,'Times New Roman',serif;max-width:36rem;margin:0 auto;color:#1a2332">
  <h2 style="color:#d4652a">Your RateMyDutch exam-readiness scorecard</h2>
  <p>Your overall readiness: <b>${overall}% — ${bandLabel}</b></p>
  <p>${bandSummary}</p>
  <table style="border-collapse:collapse">${skillRows}</table>
  <h3 style="margin-top:24px">Your priority: ${plan.label}</h3>
  <p>${plan.why}</p>
  <p><b>This week, do these three things:</b></p>
  <ol>
    ${plan.exercises.map(e => `<li style="margin-bottom:6px">${e}</li>`).join('')}
  </ol>
  <p>${plan.appAction}</p>
  <p style="margin:24px 0">
    <a href="${origin}/?src=scorecard#${plan.appMode}" style="background:#d4652a;color:#fdfcfa;padding:12px 24px;text-decoration:none;border-radius:4px">Start practising on RateMyDutch</a>
  </p>
  <hr style="border:none;border-top:1px solid #ebe6df;margin:24px 0">
  <p style="font-size:13px;color:#6b7280">${disclaimer}</p>
  <p style="font-size:13px;color:#6b7280">You received this email because you requested your scorecard result.
  <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe from all marketing email</a>.</p>
</div>`;

    return send({ to, subject: `Your Dutch exam readiness: ${overall}% — ${bandLabel}`, html });
}

module.exports = { isConfigured, sendScorecardEmail };
