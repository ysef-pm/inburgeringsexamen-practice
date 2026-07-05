# Paywall Setup Runbook (Stripe + Firebase)

Owner runbook to take the RateMyDutch paywall from zero to live. Do the steps in order — each later step depends on values produced by the earlier ones.

## Environment variables reference

| Variable | Where you get it | Notes |
|----------|------------------|-------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard > Developers > API keys | `sk_test_...` for testing, `sk_live_...` for production |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen` output (local) or the webhook endpoint's signing secret (Stripe Dashboard) | `whsec_...` — different per endpoint/environment |
| `STRIPE_PRICE_ID` | Stripe Dashboard > Product catalog > your price | `price_...` — test and live modes have different IDs |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Console > Project settings > Service accounts > Generate new private key | The full JSON, minified to a single line |
| `APP_ORIGIN` | Your production URL, e.g. `https://ratemydutch.vercel.app` | Pins Stripe checkout success/cancel return URLs. **REQUIRED in production** — if unset the server falls back to deriving the origin from request headers, which is spoofable and breaks behind some proxies |

## 1. Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project (e.g. `ratemydutch`). Google Analytics is optional.
2. **Authentication** > Get started > enable the **Google** and **Email/Password** sign-in providers.
3. **Firestore Database** > Create database > **Production mode**, location `eur3` (europe-west multi-region).
4. Firestore > **Rules** tab: paste the contents of `firestore.rules` from the repo root and publish. This makes entitlements readable only by their owner and writable only by the Admin SDK (server).
5. Project settings (gear icon) > **General** > Your apps > **Add app** > Web. Register the app (no hosting needed). Copy the `firebaseConfig` object values into `public/js/firebase-config.js`.
6. Project settings > **Service accounts** > **Generate new private key**. Minify the downloaded JSON to one line, e.g.:
   ```bash
   node -e "console.log(JSON.stringify(require('./ratemydutch-firebase-adminsdk.json')))"
   ```
   That one-line string is the value for `FIREBASE_SERVICE_ACCOUNT`. Do not commit the JSON file.

## 2. Stripe product (test mode)

1. Create a Stripe account at [stripe.com](https://stripe.com) if you don't have one.
2. Make sure the dashboard is in **Test mode** (toggle top-right).
3. **Product catalog** > Add product: name `RateMyDutch — Lifetime access`, **one-time** price **€24**.
4. Copy the price ID (`price_...`) → `STRIPE_PRICE_ID`.
5. **Developers** > **API keys** > copy the secret key (`sk_test_...`) → `STRIPE_SECRET_KEY`.

## 3. Local end-to-end test

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and log in (`stripe login`).
2. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:3456/api/stripe-webhook
   ```
   The command prints a signing secret (`whsec_...`) → use it as `STRIPE_WEBHOOK_SECRET` locally.
3. Run the server with everything set:
   ```bash
   STRIPE_SECRET_KEY=sk_test_... \
   STRIPE_WEBHOOK_SECRET=whsec_... \
   STRIPE_PRICE_ID=price_... \
   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
   PERPLEXITY_API_KEY=... OPENAI_API_KEY=... \
   npm start
   ```
4. Open `http://localhost:3456`, sign in, click upgrade, and pay with the test card `4242 4242 4242 4242` (any future expiry, any CVC).
5. Verify:
   - The `stripe listen` terminal shows `checkout.session.completed` forwarded with a 200 response.
   - Firestore has a new document at `entitlements/<your-uid>`.
   - AI grading (schrijven/spreken) now works without a 402.

## 4. Vercel production config

1. In the Vercel project settings > Environment Variables, add:
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
   - `FIREBASE_SERVICE_ACCOUNT` (the one-line JSON)
   - `APP_ORIGIN` (e.g. `https://ratemydutch.vercel.app`)
   - the existing AI keys: `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`
2. In the Stripe Dashboard > **Developers** > **Webhooks** > Add endpoint:
   - URL: `https://<your-domain>/api/stripe-webhook`
   - **Select these events** (all three are required):
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
   - Copy this endpoint's signing secret and use it as `STRIPE_WEBHOOK_SECRET` in Vercel (it is different from the local `stripe listen` secret).

   > **Why the async events matter:** delayed payment methods — notably **iDEAL, the most common way Dutch buyers pay** — are supported. For those, `checkout.session.completed` arrives with payment still pending, and access is granted only when `checkout.session.async_payment_succeeded` fires. If that event isn't selected on the endpoint, iDEAL customers pay but never get access.
3. **Firebase authorized domains:** Firebase Console > Authentication > Settings > Authorized domains > add your Vercel domain(s) (e.g. `ratemydutch.vercel.app` and any preview domain you test on). Without this, Google sign-in fails on the deployed site.
4. **Node.js version:** In Vercel project settings > General > Node.js Version, confirm it is **20.x or newer** — `firebase-admin`'s transitive dependencies require Node ≥ 20 and fail on older runtimes.

## 5. Pre-launch verification (do not skip)

The webhook's raw-body signature verification **must be tested against a real Vercel deployment**, not just localhost. Serverless platforms can mangle or pre-parse request bodies in ways a local Express server never will — and a silent signature failure here means **customers pay but never get access**. Localhost cannot prove this; only a real deployment can.

1. Deploy a Vercel **preview** (any push to a branch) with all env vars set (Preview scope).
2. Test the deployed webhook with the Stripe CLI, either by forwarding:
   ```bash
   stripe listen --forward-to https://<preview-url>/api/stripe-webhook
   ```
   or by firing a synthetic event at your configured endpoint:
   ```bash
   stripe trigger checkout.session.completed
   ```
3. Confirm the endpoint returns **200** (check Stripe Dashboard > Webhooks > endpoint > recent deliveries, and Vercel function logs). A `400 invalid signature` on a genuine Stripe delivery means the raw body is being altered in transit — fix before launch.
4. Do one full test-mode purchase against the preview URL and confirm the entitlement doc is written and grading unlocks.

## 6. Go live

1. Complete Stripe account activation (KYC: business details, bank account).
2. In **Live mode**: recreate the product/price, copy the live price ID, live secret key, and create the live webhook endpoint (same URL, same three events) with its own signing secret.
3. Swap the Vercel Production env vars to the live values: `STRIPE_SECRET_KEY` (`sk_live_...`), `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
4. Redeploy production.
5. Optional sanity check: one real €24 purchase (you can refund it from the Stripe dashboard) to confirm the live path end-to-end.
