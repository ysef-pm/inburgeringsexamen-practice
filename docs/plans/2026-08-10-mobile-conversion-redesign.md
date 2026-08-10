# Mobile Conversion Redesign — Design (2026-08-10)

## Why

PostHog device data (first 2 days): **~72% of visitors are mobile** (18 mobile /
5 desktop / 2 tablet uniques). Session replays show long engaged scorecard
sessions but 12–22s zero-click bounces after the app handoff.

Production mobile audit (390×844, real site) found the handoff is broken:

1. The scorecard result CTA (`/?src=scorecard#<mode>`) lands on a full-screen
   marketing hero; the started exercise renders **below ~8 screens** of stacked
   exercise-list links. Nobody finds it.
2. **The AI Grade button is untappable on mobile** — the desktop
   `#exam-sidebar` overlays the exercise card at phone widths and intercepts
   every pointer event (verified with Playwright: 30s of retried taps, all
   swallowed by the sidebar).
3. Even on desktop the paid path is ~8 steps with two dead ends
   (grade → auth modal → grade again → upgrade modal → checkout).

The scorecard funnel itself (landing → consent → questions → result) is
mobile-clean and converting; everything after it is not.

## Decisions (validated with owner)

- **First AI feedback is free after Google sign-up**; the paywall hits at
  question 2. Honors the "free" promise in ads + result CTA; user tastes the
  aha moment before paying.
- **One gate for all focus skills**: MCQ-focus users (reading/listening/KNM)
  answer ~3 inline questions, then the same sign-up sheet ("unlock all 5 exam
  sets + AI writing/speaking feedback"). Writing/speaking-focus users answer 1
  and the gate is the feedback itself.
- **Full mobile-first redesign of the practice app** (not just triage), but
  sequenced AFTER the funnel fix ships.
- Max 3 steps from "tried the question" to member:
  answer → Google sign-up sheet → (feedback) → Stripe Checkout.

## Phase 1 — Conversion funnel on the scorecard surface (ship first)

The scorecard result screen gains an **inline first-question card** directly
under the "Start with:" plan card:

- Focus skill = writing/speaking → one real exercise prompt with a textarea
  (speaking: text-input fallback v1; no recorder on this surface yet) and a
  **"Get my AI feedback"** button.
- Focus skill = MCQ mode → 3 real questions answered inline, then the gate.
- Tap gate → bottom sheet: "Create your free account to see your feedback" →
  **Continue with Google** (Firebase `signInWithRedirect` on mobile,
  popup on desktop) + small email fallback link.
- After auth: first feedback renders (writing/speaking) or exam-set teaser
  (MCQ). One question later: paywall sheet → `/api/create-checkout-session`
  → Stripe Checkout (iDEAL/cards; Checkout is already mobile-ready).
- Post-payment return lands back on a `?upgraded=1` continuation that resumes
  practice, not the app home.
- New funnel events (Firestore + PostHog mirror): `inline_question_shown`,
  `inline_answer_submitted`, `signup_sheet_shown`, `signup_completed`,
  `first_feedback_viewed`, `checkout_opened`, `purchase_completed` (existing
  Stripe webhook).

Server: reuse `/api/grade-writing` (requirePaid) — needs a
**one-free-grade allowance** per authenticated uid: new
`free_grades/{uid}` doc (or field on entitlement) checked by a
`requireAuthWithFreeGrade` middleware variant; consumed atomically on first
grade. Keeps abuse bounded (1 per Google account).

## Phase 2 — Mobile-first practice app redesign

Replace the desktop sidebar-wall IA with a one-question-at-a-time flow on all
modes (the pattern the scorecard already proves):

- `?src=scorecard#<mode>` skips the hero entirely and opens the practice view.
- Practice view: question card front and center; progress ("3 of 25"); Next /
  Back; exercise picker becomes a bottom-sheet drawer (replaces
  `#exam-sidebar`); AI feedback renders under the answer, never overlapped.
- Hero/marketing sections only render for organic root visits.
- Sticky bottom action bar (Grade / Next) sized for thumbs; 16px+ inputs to
  kill iOS zoom-on-focus.
- Desktop keeps a two-pane layout via media queries; mobile gets the stacked
  flow. Shared JS state, CSS grid swap.
- index.html is a 3,789-line monolith with inline schrijven/lezen JS —
  refactor risk is real. Approach: extract the practice-view shell into
  `public/js/practice-ui.js` + CSS, leave grading logic in place, migrate
  mode-by-mode (schrijven first — it's the money mode — then lezen, then the
  module modes which already render into a shared area).

## Sequencing & verification

1. Phase 1 behind `?flow=v2` param first, verified on real devices via
   Playwright mobile viewport + manual phone test, then flipped default.
2. Watch PostHog funnel (new events) + replays for a few days.
3. Phase 2 mode-by-mode, each mode verified at 390px before the next.
4. Success metric: scorecard-completer → checkout-opened rate, and
   `product_activated` no longer the funnel graveyard.
