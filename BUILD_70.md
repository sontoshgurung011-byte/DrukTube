# Build 70 — Monetization & Bank of Bhutan hardening

- Standardized package/release version to 7.3.0 / build 70.
- 60% creator / 40% DrukTube split.
- Bhutan-friendly eligibility: 100 followers + 500 public watch hours OR 100,000 Shorts views in 90 days.
- Shorts eligibility now uses recorded view events over a real 90-day window.
- Watch progress contributes creator watch time.
- Added live donation orders in BTN.
- Added live gift orders in BTN.
- BoB checkout remains pending until merchant checkout credentials exist.
- BoB webhook is required to mark payments paid and create creator earnings.
- Duplicate paid webhooks are idempotent.
- Failed/cancelled/refunded payments do not create earnings.
- Minimum payout default is Nu. 500.
- Updated docs and environment configuration.
