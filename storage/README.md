# DrukTube media storage adapter — Build 53

Build 53 separates media storage configuration from the application data layer.

- `STORAGE_DRIVER=local` keeps uploads under `/app/uploads` (the current safe default).
- `STORAGE_DRIVER=s3` reserves the production object-storage contract using `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_FORCE_PATH_STYLE`.
- Media metadata is represented by the PostgreSQL `media_objects` table.

No cloud credentials are bundled. S3-compatible upload wiring should only be enabled after credentials and bucket permissions are configured.
