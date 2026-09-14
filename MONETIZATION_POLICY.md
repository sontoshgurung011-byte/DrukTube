# DrukTube Creator Monetization Policy

## Bhutan-friendly eligibility
- 100 followers.
- 500 public watch hours, or 100,000 Shorts views in the last 90 days.
- Creator verification approved.
- Account in good standing and not suspended.
- Content must comply with DrukTube Community Guidelines, copyright rules, and advertiser-safety requirements.

## Revenue split
- Creator: **60%**
- DrukTube: **40%**

The split is applied to eligible monetization revenue and live gifts/donations after a successful payment. The two shares must always total 100%.

## Live gifts and donations — Bank of Bhutan
- Payment provider: **Bank of Bhutan (BoB)**
- Currency: **BTN / Nu.**
- Live gifts: BTN 10–5,000 by default.
- Live donations: BTN 10–100,000 by default.
- Each transaction is created as `payment_pending` when a configured BoB checkout is available, or `awaiting_bob_gateway` when credentials are not configured.
- A creator earning is added to the ledger **only after a verified BoB webhook reports `paid`**.
- Duplicate `paid` webhooks are idempotent.
- Failed, cancelled, and refunded payments do not create creator earnings.
- Production use requires a BoB merchant/payment-gateway agreement, merchant credentials, checkout endpoint, and webhook secret/configuration. DrukTube does not fake or simulate bank charges.

BoB publicly documents e-payment gateway services and mBoB/QR payment capabilities. Exact production API/checkout parameters must come from the merchant integration package provided by BoB.

## Payouts
- Default minimum payout: **Nu. 500 BTN**.
- Payout requests are recorded for admin/payment-provider processing.
- Fraud, chargebacks, refunds, invalid traffic, copyright claims, or policy violations may delay or reverse earnings.

## Important implementation note
The codebase includes the payment adapter, order ledger, webhook handling, idempotency protection, and UI. Real-money collection and payout remain disabled until official BoB merchant credentials and integration details are supplied.
