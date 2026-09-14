# DrukTube 🇧🇹 — Development Complete 7.1.0

DrukTube is a Bhutan-focused video platform/PWA. This package is the consolidated development release containing the platform UI, creator tools, social features, moderation, PostgreSQL runtime, media processing, adaptive HLS playback, background jobs, storage/CDN adapters, and production deployment configuration.

## Start locally
```bash
cp .env.example .env
npm install
npm start
```
Then open `http://localhost:3000`.

## Full production stack
```bash
cp .env.example .env
# Set a strong POSTGRES_PASSWORD and MEDIA_SIGNING_SECRET first.
docker compose up -d --build
```
The stack contains the web service, a dedicated media worker, and PostgreSQL with persistent volumes.

## Core capabilities
- Responsive mobile/PWA video experience
- Authentication, sessions, privacy and account security
- Creator profiles, verification and Creator Studio
- Video/image uploads with ownership controls
- FFmpeg probing and 360p/720p/1080p HLS processing
- Background job queue, progress, retries and creator job dashboard
- Adaptive HLS player with Auto/manual quality selection
- HTTP range streaming, signed media access, cache controls and optional CDN
- Local or S3-compatible object storage
- PostgreSQL runtime plus JSON compatibility/migration tooling
- Search, discovery, categories, hashtags and personalized feed
- Subscriptions, notifications, comments, reactions and community posts
- Playlists, Watch Later, history, Continue Watching, chapters and captions
- Reports, moderation, blocking and admin controls
- Docker deployment and health/smoke-test tooling

## Production configuration
Set real values in `.env` for:
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `MEDIA_SIGNING_SECRET`
- S3 variables when using cloud object storage
- `MEDIA_CDN_BASE_URL` when using a CDN

External infrastructure (domain, server, DNS, database credentials, S3/CDN account and certificates) must still be provisioned by the operator.

## Useful commands
```bash
npm run test:smoke
npm run check:postgres
npm run migrate:postgres
npm run worker
npm run process:video -- <input> [output-dir]
```

## Monetization
Build 7.3 includes a configurable creator monetization program with eligibility, applications, revenue ledger, tips, memberships, payout requests, and admin controls. See `MONETIZATION_POLICY.md`. Real payment collection/payout still requires connecting a payment provider.


### Bhutan-friendly monetization
Creator eligibility defaults: 100 followers + 500 public watch hours OR 100,000 Shorts views in 90 days. Revenue split: 60% creator / 40% DrukTube. Live gifts and donations use Bank of Bhutan (BoB) in BTN; earnings are credited only after a verified BoB webhook confirms payment. Real checkout activates only after official BoB merchant/gateway onboarding and credentials are supplied.
