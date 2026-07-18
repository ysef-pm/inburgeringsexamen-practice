# Acquisition Pilot — Baseline & Event Dictionary

Source plan: `second-brain/Projects/RateMy Dutch - Consent-First Acquisition System.md`
Pilot goal: **100 qualified opt-ins in 30 days.** Rubric version: `v1`.

## Baseline (2026-07-18, pilot day 0)

- Site live at https://ratemydutch.com (+ www, + inburgeringsexamen-practice.vercel.app).
- Paid conversions to date: 1 (owner smoke test). Weekly organic traffic: ~0 — no
  distribution has ever been done. Every metric effectively starts at zero.
- Existing Stripe success event: `checkout.session.completed` /
  `checkout.session.async_payment_succeeded` → Firestore `entitlements/{uid}`.
- Activation event definition: a visitor **starts any practice mode** on the main
  app having arrived via the scorecard (`?src=scorecard`).

## Event dictionary

All events land in Firestore `funnel_events` via `POST /api/events` (client) or
server-side writes. Common fields: `event_name`, `ts`, `anon_id` (random client id),
`subscriber_id` (once known), `source`, `utm_source|medium|campaign|content`,
`experiment_id`, `properties`.

| Event | Fired | Qualification |
|---|---|---|
| `landing_viewed` | Scorecard landing page load | Qualified when utm/referrer is an inburgering-related source |
| `consent_confirmed` | Server, on valid email + consent submit | Valid email + recorded choice |
| `scorecard_started` | First scored question answered | — |
| `scorecard_completed` | Server, on submit of all sections | All required sections present |
| `result_viewed` | Result screen rendered | — |
| `cta_clicked` | Result-screen CTA to the app | — |
| `product_activated` | Main app: mode started with `?src=scorecard` present | — |
| `purchase_completed` | Existing Stripe webhook (join on `entitlements`) | — |

**Qualified opt-in** (primary metric) = `consent_confirmed` where the subscriber's
`source`/UTM ties to an inburgering-related channel **and** the scorecard was started.

## Data entities (Firestore)

- `subscribers` — email (lowercased), created_at, exam_timeline_bucket, source, utm_*, subscriber_status (`active` | `unsubscribed`)
- `consent_events` — append-only ledger: subscriber_id, consent_type (`scorecard_delivery` | `marketing`), action (`granted` | `withdrawn`), notice_version, ts, source_page
- `assessments` — subscriber_id, started_at, completed_at, rubric_version, per-skill scores, overall_band, recommended_focus
- `funnel_events` — see dictionary above

## Privacy & retention (pilot rules)

- Marketing consent is a separate, un-pre-checked choice; notice version `2026-07-18.1`.
- Unsubscribe = HMAC-tokened link → consent_events `withdrawn` + subscriber_status
  `unsubscribed` (suppression). Withdrawn users are never re-added.
- No email addresses or individual answers are sent to any AI tool. Scoring is
  deterministic (`lib/scorecard.js` + `lib/scorecard-rubric.v1.json`).
- Retention: delete incomplete assessments after 90 days; subscribers inactive
  ≥12 months get deleted on review. (Manual job for the pilot — revisit before scale.)

## Experiment register

| ID | Hypothesis | Metric | Status |
|---|---|---|---|
| — | (none started — first review after soft launch) | — | — |

Backlog (from plan): headline framing; email before vs after first section; 4-min vs
2-min scorecard; skill breakdown vs single band; trial CTA vs 7-day plan CTA.
