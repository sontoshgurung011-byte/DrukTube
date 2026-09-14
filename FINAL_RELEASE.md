# DrukTube — Development Complete Release 7.1.0 🇧🇹

This is the consolidated development package. Previous incremental builds are no longer required for normal development; keep them only as historical backups if desired.

## Included
All major platform systems built through the incremental releases are consolidated here: responsive PWA UI, authentication, creator tools, uploads, PostgreSQL runtime, media workers, FFmpeg/HLS processing, adaptive playback, storage/CDN adapters, search/discovery, social features, playlists/history, moderation/admin, privacy/security, and Docker deployment.

## Final development hardening
- Corrected Docker Compose service dependency structure
- Added Node.js engine requirement (20+)
- Normalized release version to 7.1.0
- Removed duplicated environment configuration
- Corrected server release/startup metadata
- Added consolidated setup and command documentation
- Verified Node.js syntax for core server, worker, database, processing, migration and smoke-test scripts

## What is not bundled as a fake promise
A real public launch still requires operator-owned infrastructure and secrets: domain/DNS, production server, PostgreSQL credentials, media storage/CDN credentials, TLS and any external email/analytics services. These cannot be activated inside a source ZIP without access to those accounts.
