# DrukTube Build 54 deployment

1. Copy `.env.example` to `.env`.
2. Set a strong `POSTGRES_PASSWORD` in the Compose environment.
3. Set `DB_DRIVER=postgres` and the matching `DATABASE_URL`.
4. Run `docker compose up -d --build`.
5. Check `/api/health` and confirm `database: postgres`.
6. Check `/api/data-layer` and confirm `cutover: active`.
7. Run `npm run check:postgres` from the app container if needed.

The app keeps a JSON compatibility mirror for feature collections that have not yet been moved to relational tables. Do not delete `data/db.json` until the remaining feature-table migration is complete and backups have been verified.

## Build 62 media worker
Run `npm run worker`. Configure `JOB_POLL_MS`, `WORKER_CONCURRENCY`, and optional `MEDIA_PROCESS_COMMAND`.
