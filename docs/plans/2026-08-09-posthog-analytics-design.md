# PostHog Behavioural Analytics — Design (2026-08-09)

## Why

The acquisition pilot gets ad click-throughs but the aha moment isn't landing.
We need to *see* how visitors move through the scorecard signup funnel and the
main app: session replays, click tracking, and a mobile-vs-desktop split
(the site is suspected to work poorly on mobile, where most ad traffic lands).

## Decisions (validated with owner)

- **PostHog EU Cloud** (`https://eu.i.posthog.com`) — free tier (1M events,
  5k recordings/mo) far exceeds current traffic; data stays in the EU.
- **Cookies + consent banner**: nothing is captured and no cookie is set until
  the visitor accepts. `opt_out_capturing_by_default: true`; Accept →
  `posthog.opt_in_capturing()`, Decline → `opt_out_capturing()`. Choice
  persists; banner never reappears.
- **Whole site**: snippet on `index.html`, `scorecard.html`, `privacy.html`,
  `guide-speaking.html`, `guide-two-weeks.html`.
- **Pseudonymous identity**: `posthog.identify(subscriberId)` after the consent
  gate (and on return visits via `rmd-scorecard-sid` in localStorage). No email
  ever sent to PostHog. Replay input masking stays at the default (all inputs
  masked).
- **Mirror, don't migrate**: the Firestore `funnel_events` pipeline
  (`/api/events` → ads-agent kill guard) is untouched. The same named events
  are additionally sent to PostHog via `posthog.capture`.
- **No reverse proxy in v1**: `vercel.json` uses the legacy `routes`/`builds`
  format which can't be mixed with modern `rewrites`. Revisit only if PostHog
  counts fall visibly short of Firestore counts (ad-blocker loss).
- **No server-side events, no surveys in v1**: purchases remain a
  Firestore/Stripe join; surveys/onboarding flows are a later phase.

## Architecture

New `public/js/analytics.js` (classic script, loaded in `<head>` of all five
pages):

1. Official PostHog snippet + `posthog.init(<public project token>, {
   api_host: 'https://eu.i.posthog.com', defaults: <from onboarding>,
   opt_out_capturing_by_default: true })`. The project token is a public
   client key — committed directly, no env vars, no server changes.
2. Consent banner rendered when consent status is pending, styled with the
   site's existing cream/navy/orange palette, fixed to the bottom.
3. Exposes `window.rmdAnalytics = { capture(name, props), identify(id) }`
   as a safe no-throw wrapper used by page scripts.

## Event mirroring

- `track()` in `public/js/scorecard.js`: one added line calling
  `window.rmdAnalytics.capture(event_name, props)` — covers `landing_viewed`,
  `scorecard_started`, `result_viewed`, `cta_clicked` (+ props).
- `product_activated` fetch in `index.html` (~line 3770): same mirror line —
  this is the aha-moment step.
- `identify(subscriberId)` after successful `/api/scorecard/subscribe` and on
  page load when `rmd-scorecard-sid` exists.
- Device split needs no code: PostHog auto-captures `$device_type`.

## Privacy page

New section in `privacy.html`: analytics cookies are opt-in only; PostHog EU
listed as processor; recordings mask typed input; withdraw by declining or
clearing cookies.

## PostHog UI setup (after deploy)

- Funnel insight: `landing_viewed → consent_confirmed(server: use client steps
  instead) → scorecard_started → scorecard_completed(client: submit) →
  result_viewed → cta_clicked → product_activated`, broken down by
  `$device_type`; pinned to a dashboard.
- Session replay enabled in project settings; watch replays filtered by
  funnel drop-off step.

## Rollout

Implement → `npm test` + local click-through (`npm start`) → commit → push to
main (Vercel auto-deploy) → verify events/replay from a real phone via an ad
path.
