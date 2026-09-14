# Build 69 — Bhutan Monetization + Bank of Bhutan Live Gifts

- Creator revenue split changed to 60% / 40%.
- Bhutan-friendly eligibility defaults: 100 followers, 500 watch hours or 100,000 Shorts views.
- Added live gift/donation order API with Bank of Bhutan payment-provider adapter.
- Added BTN live-gift limits and payment configuration fields.
- Added payment webhook endpoint with optional BOB_WEBHOOK_SECRET.
- Paid live gifts create creator earnings at the configured 60% share.
- Added Live UI messaging for BoB gifts/donations.
- No fake bank charges: real-money checkout requires a BoB merchant/gateway agreement and credentials.
