# RateMyDutch — Go-Live Checklist (test → real money)

Production URL: `https://inburgeringsexamen-practice.vercel.app`
Firebase project: `ratemydutch` · Vercel project: `inburgeringsexamen-practice`

> **STATUS 2026-07-18: LIVE.** Steps 0–4 completed. Stripe account activated
> (Hounat Advisory, KVK 42108620, eenmanszaak; ID verified; payouts → Revolut
> ••••8391, weekly Mon). Live objects: product `prod_UuLARyn7ljmzAp`
> ("RateMyDutch — Lifetime access", €24 one-time), price
> `price_1TuWUT8idYv8Gy5jC7xS9588`, webhook `we_1TuWd68idYv8Gy5jZxowUCgf`.
> Vercel prod envs swapped to live values + redeployed; smoke test passed
> (site 200, webhook 400 invalid_signature, checkout 401 auth_required).
> Remaining: step 5 real-card test; optional: delete old test-mode webhook.

The paywall is built, deployed, and verified in **Stripe test mode**. This
checklist flips it to accept real payments. Legend: 🧑 = you (dashboard/account),
🤖 = Claude can do via CLI once you provide values.

---

## 0. Prerequisite — make sign-in work (do first, blocks everything)
- [ ] 🧑 Firebase console → **Authentication → Settings → Authorized domains → Add domain**
      → `inburgeringsexamen-practice.vercel.app`
- [ ] 🧑 Sanity check in a browser: open the production URL, click **Sign in**,
      complete Google sign-in — you should land back signed in (still test mode).

## 1. Confirm the flow works on a test card (still test mode)
- [ ] 🧑 Signed in, click **Upgrade — €24** → pay with card `4242 4242 4242 4242`
      (any future expiry, any CVC, any postcode).
- [ ] 🧑 Confirm you get bounced back and AI grading (Schrijven/Spreken) unlocks.
- [ ] 🧑 (optional) Firebase console → Firestore → `entitlements` → your uid shows `paid: true`.

## 2. Activate the Stripe account (the real-money gate)
- [ ] 🧑 Stripe Dashboard → **Activate account** / complete the checklist:
      business or sole-trader details, address, and a **bank account** for payouts.
- [ ] 🧑 Wait for Stripe to approve (usually minutes–hours, sometimes a day).
      Live mode stays locked until this clears.

## 3. Recreate the objects in LIVE mode (test objects do NOT carry over)
Toggle the dashboard to **Live mode**, then:
- [ ] 🧑 **Products** → create "RateMyDutch — Lifetime access", one-time price **€24 EUR**
      → copy the **live price ID** (`price_…`).
- [ ] 🧑 **Developers → API keys** → copy the **live secret key** (`sk_live_…`).
- [ ] 🧑 **Developers → Webhooks → Add endpoint**
      → URL `https://inburgeringsexamen-practice.vercel.app/api/stripe-webhook`
      → events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
        `checkout.session.async_payment_failed`
      → copy the **live signing secret** (`whsec_…`).

## 4. Put the live values into Vercel + redeploy
- [ ] 🧑 Paste the three live values to Claude: `sk_live_…`, live `price_…`, `whsec_…`.
- [ ] 🤖 Update Vercel **production** env vars: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
      `STRIPE_WEBHOOK_SECRET` (leave `FIREBASE_SERVICE_ACCOUNT`, `APP_ORIGIN`,
      `PERPLEXITY_API_KEY`, `OPENAI_API_KEY` unchanged).
- [ ] 🤖 `vercel --prod` redeploy.

## 5. Final live smoke test
- [ ] 🧑 On the live site, buy once with a **real card** (real €24 charge).
- [ ] 🧑 Confirm access unlocks; check the charge appears in the Stripe **live** dashboard.
- [ ] 🧑 Refund yourself from the Stripe dashboard if you want the €24 back.
- [ ] ✅ You're taking real money.

---

## Notes / gotchas
- **iDEAL** (common in NL): if you enable it in Stripe, payment confirms via the
  async webhook events already configured in step 3 — no code change needed.
- Delete the old **test-mode** webhook endpoint (`we_1Tpqwt…`) once live, to avoid
  confusion — it points at the same URL but only fires for test events.
- `APP_ORIGIN` is already set to the production URL; if you later add a custom
  domain (e.g. ratemydutch.com), update `APP_ORIGIN` and re-add it to Firebase
  authorized domains + the Stripe webhook URL.
- Optional hygiene: re-enable the GCP org policy
  `iam.disableServiceAccountKeyCreation` for the `ratemydutch` project (your
  existing key keeps working). See conversation notes.
- Full background/runbook: `docs/SETUP-PAYWALL.md`.
