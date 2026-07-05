# RateMyDutch Stripe Paywall — Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

Turn the personal inburgeringsexamen practice app into a shareable product
(**RateMyDutch**) with a paywall: free static practice as the funnel, a €24
one-time purchase unlocking the AI-graded features. Side effect: closes the
hole where the public URL burns the owner's Perplexity/OpenAI keys for anyone.

## Decisions

| Decision | Choice |
|---|---|
| Pricing model | One-time purchase, €24 EUR, lifetime access |
| Free tier | Lezen, Luisteren, KNM self-check (static content) |
| Paid tier | AI writing grading, speech transcription, AI speaking grading |
| Auth | Firebase Auth — Google sign-in + email/password |
| Entitlement store | Firestore `entitlements` collection, server-write-only |
| Stripe integration | Hand-rolled in the existing Express server (no Firebase extension) |
| Branding | Retitle app header to "RateMyDutch"; Stripe product name "RateMyDutch" |
| Landing page | Not in this pass |
| Mode | Build against Stripe **test mode**; flip to live keys after Stripe KYC |

## Architecture

```
Browser ──sign in──▶ Firebase Auth (client SDK)
   │
   ├─▶ POST /api/create-checkout-session ──▶ Stripe Checkout (hosted page)
   │                                              │ payment succeeds
   │                                              ▼
   │        Firestore ◀── write entitlement ── POST /api/stripe-webhook
   │
   └─▶ POST /api/grade-writing (+ transcribe-speech, grade-speaking)
              │  Authorization: Bearer <Firebase ID token>
              ├─ verify token (Admin SDK) + read entitlements/{uid}
              ├─ paid   ──▶ call Perplexity/OpenAI, return result
              └─ unpaid ──▶ 402 → frontend shows upgrade modal
```

## Components

### Firebase (new project, Spark/free plan)
- **Auth providers:** Google, Email/Password (Firebase-hosted password-reset emails).
- **Firestore `entitlements/{uid}`:** `{ uid, email, paid: true, stripeCustomerId,
  stripeSessionId, purchasedAt }`.
- **Security rules:** user may read own doc; no client writes. All writes go
  through the Admin SDK on the server (service account key in Vercel env).

### Express server (server.js) — new endpoints
- `POST /api/create-checkout-session` — requires valid Firebase ID token.
  Creates a Stripe Checkout session (`mode: payment`, price = `STRIPE_PRICE_ID`,
  currency EUR) with `uid` + `email` in metadata and `client_reference_id = uid`.
  Returns hosted checkout URL. If the user is already entitled, return 409-style
  "already paid" so the client just unlocks.
- `POST /api/stripe-webhook` — raw-body route (registered **before**
  `express.json()`), verifies signature with `STRIPE_WEBHOOK_SECRET`. On
  `checkout.session.completed`, writes `entitlements/{uid}` (idempotent —
  merge-set keyed by uid, safe under Stripe retries). Always 200 on handled
  events so Stripe stops retrying.
- `GET /api/me` — requires ID token; returns `{ paid: boolean }` so the client
  can render locked/unlocked state on load and after checkout redirect.

### Gating (server-side, the actual paywall)
`/api/grade-writing`, `/api/transcribe-speech`, `/api/grade-speaking` get an
`requirePaid` middleware: verify Firebase ID token → read entitlement →
402 `{ error: 'payment_required' }` when unpaid/anonymous. Static content
(exercise JSON, audio, images) stays public. `/api/check-grammar` (legacy
redirect) inherits the gate via grade-writing.

### Frontend
- Firebase client SDK (CDN, compat or modular) initialised with public config.
- Sidebar auth widget: signed-out → "Sign in" button (Google popup + email
  form); signed-in → email + paid badge or "Upgrade — €24" button; sign-out.
- All AI-endpoint fetches attach `Authorization: Bearer <idToken>` (helper in
  shared.js). On 402 → upgrade modal (what's included, one Checkout button).
- Checkout return: success URL `/?checkout=success` → poll `/api/me` briefly
  (webhook race) → unlock UI + toast. Cancel URL `/?checkout=cancelled`.
- Header/title → "RateMyDutch — A2 Inburgering Practice".

## Env vars (Vercel + local)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
`FIREBASE_SERVICE_ACCOUNT` (service-account JSON, stored as single-line env),
plus existing `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`.

## New dependencies
`stripe`, `firebase-admin` (server). Firebase client via CDN script tags.

## Owner-side tasks (Youssef, manual)
1. Create Stripe account (KYC + bank details) — build proceeds on test keys.
2. Create Firebase project; enable Google + Email/Password auth; create
   Firestore; download service-account key; paste web config into the app.
3. Add env vars to Vercel; point a Stripe webhook at
   `https://<domain>/api/stripe-webhook`.
4. Flip test → live keys once Stripe approves.

## Testing
- Local: Stripe CLI (`stripe listen --forward-to localhost:3456/api/stripe-webhook`)
  + test card `4242 4242 4242 4242`.
- Verify: unauthenticated AI call → 402; signed-in unpaid → 402 + modal;
  test purchase → entitlement doc appears → AI call succeeds; webhook replay
  is idempotent; static modes work signed-out.

## Out of scope (YAGNI)
Subscriptions, customer portal, refund automation, admin dashboard, usage
metering/free-grading credits, marketing landing page, custom receipt emails.

## Divergences during implementation
- **Already-paid checkout returns `200 {alreadyPaid:true}`** rather than a
  409-style conflict. The client treats it as a success signal (refresh
  entitlement, close modal) instead of an error path.
- **Webhook handles the async payment events too:** in addition to
  `checkout.session.completed`, the handler processes
  `checkout.session.async_payment_succeeded` and
  `checkout.session.async_payment_failed` for iDEAL-style delayed payments,
  where `completed` fires with payment still pending.
- **`APP_ORIGIN` env var added** to pin Stripe checkout return (success/cancel)
  URLs to a canonical origin, falling back to request headers only when unset.
