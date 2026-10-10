# RAG backend

Express and TypeScript backend for study documents, notebooks, courses, chat sessions, flashcards, and tests. It uses Supabase Auth, PostgreSQL with pgvector, Cloudflare R2, Redis/BullMQ, Groq, OpenRouter, and Sentry.

The HTTP server and document worker run as separate processes. Document ingestion and retrieval are still under development: ingestion helpers currently throw `not implemented` errors, retrieval contains placeholders, and several controllers are empty stubs. Starting the services does not yet enable the complete RAG workflow.

## Prerequisites

- Node.js and npm. The current CI workflow uses Node 20.
- A Supabase project with authentication configured.
- A PostgreSQL database with pgvector available; the Supabase project database can be used.
- Redis reachable by both the API and worker.
- A Cloudflare R2 bucket and credentials with access to that bucket.
- Groq and OpenRouter API keys.
- A Sentry project DSN.
- Docker, if using the local Redis example below.

Run all commands in this README from the `backend` directory.

## 1. Install dependencies

```sh
cd backend
npm ci
```

If your terminal is already in `backend`, skip `cd backend`.

## 2. Configure environment variables

```sh
cp .env.example .env
```

```dotenv
NODE_ENV=development

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
SUPABASE_JWKS_URL=https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
FRONTEND_URL=http://localhost:5173

R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=YOUR_R2_BUCKET_NAME

GROQ_API_KEY=YOUR_GROQ_API_KEY
GROQ_MODEL=YOUR_GROQ_MODEL_ID
OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY

REDIS_URL=redis://localhost:6379
PROCESS_DOCUMENT_QUEUE=process-document

SENTRY_DSN=https://YOUR_PUBLIC_KEY@YOUR_SENTRY_HOST/YOUR_PROJECT_ID
```

Replace the uppercase placeholders. `.env` is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`; defaults to `development`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Key used by the Supabase client to verify user access tokens. |
| `SUPABASE_SECRET_KEY` | Required by environment validation; the current auth client uses the publishable key. |
| `SUPABASE_JWKS_URL` | Required URL; the current middleware verifies tokens through `supabase.auth.getUser()`. |
| `DATABASE_URL` | PostgreSQL connection string for Drizzle and migrations. URL-encode special characters in credentials. |
| `FRONTEND_URL` | Allowed browser origin for API CORS; defaults to `http://localhost:5173`. |
| `R2_ENDPOINT` | R2 S3 API endpoint. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API credentials. |
| `R2_BUCKET_NAME` | Bucket used for document uploads. |
| `GROQ_API_KEY` / `GROQ_MODEL` | Groq credentials and model ID used by `groqAI.ts`. |
| `OPENROUTER_API_KEY` | OpenRouter credentials; the model is currently selected in `openRouterAI.ts`. |
| `REDIS_URL` | Redis connection URL for queue producers and workers. |
| `PROCESS_DOCUMENT_QUEUE` | Name of the submitted job, despite the variable's name. The actual BullMQ queue is hardcoded as `document-processing` in both producer and worker. |
| `SENTRY_DSN` | Sentry error reporting and tracing destination. Must be a valid URL. |

`src/config/env.ts` validates environment variables when imported. All variables above except `NODE_ENV` and `FRONTEND_URL` are required, including when running migrations. Empty required values prevent startup. CI dummy values satisfy validation for mocked tests; real service operations require working credentials.

## 3. Set up PostgreSQL and run migrations

Set `DATABASE_URL` to the target database connection string. The runtime disables prepared statements for compatibility with Supabase's transaction pooler. Use the connection details supplied by your database provider, including any required SSL parameters.

Apply the committed migration history:

```sh
npx drizzle-kit migrate
```

The migrations create the application tables and include `CREATE EXTENSION IF NOT EXISTS vector`. The database must have pgvector installed and the migration user must be able to enable it. Chunk embeddings use 1,536 dimensions.

If extension creation fails due to permissions, enable `vector` with an administrative account in the target database before retrying:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

For subsequent schema changes, edit `src/db/schema.ts`, generate a migration, review its SQL, then apply it:

```sh
npx drizzle-kit generate
npx drizzle-kit migrate
```

Optional database browser:

```sh
npx drizzle-kit studio
```

## 4. Start Redis

Use an existing Redis service or start a local instance with Docker:

```sh
docker run --name rag-redis -p 6379:6379 -d redis:7-alpine
docker exec rag-redis redis-cli ping
```

The ping should return `PONG`. For later sessions, restart the existing container with `docker start rag-redis`. Set `REDIS_URL` to match your instance.

## 5. Configure Supabase and R2

Enable your intended Supabase sign-in method and configure the frontend to authenticate against the same project. Protected API routes expect the signed-in user's access token:

```http
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
```

The middleware verifies the token with Supabase and attaches the user to the request. A Supabase API key is not a substitute for the user's access token.

Create an R2 bucket and configure its credentials in `.env`. For browser uploads, configure bucket CORS to allow your `FRONTEND_URL`, the `PUT` method, and the `Content-Type` header used by the upload. API CORS and bucket CORS are separate settings.

The document upload flow is:

1. Request a URL from `POST /api/documents/presign` with `fileName`, `contentType`, and `size`.
2. Upload the file bytes to the returned `uploadUrl` with an HTTP `PUT`, using the same content type.
3. Call `POST /api/documents/confirm` with the upload metadata, including the returned key as `r2Key`.
4. The backend stores document metadata and submits a BullMQ job.

Presigned URLs expire after one hour. The presign handler rejects files larger than 20 MiB. Processing currently fails at the ingestion stubs until they are implemented.

## 6. Run the API and worker

In one terminal:

```sh
npm run dev
```

In a second terminal, also in `backend`:

```sh
npm run worker
```

The API listens on `http://localhost:3000`. Port 3000 is currently hardcoded in `src/server.ts`; setting `PORT` does not change it. The worker consumes `document-processing` jobs with concurrency 2.

Check that the HTTP server responds:

```sh
curl http://localhost:3000/
```

Expected response:

```json
{"message":"Server is running"}
```

This verifies the HTTP server only; it does not check database, Redis, storage, or AI connectivity.

Example authenticated request:

```sh
curl http://localhost:3000/api/courses \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

## Tests and validation

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Jest runs tests under `src` and excludes compiled tests in `dist`. Its relative `.js` import mapping resolves TypeScript source files. Unit tests mock Supabase authentication but still need valid environment configuration for other imported modules.

Run the OpenRouter integration script separately:

```sh
npx tsx src/tests/openRouter.integration.ts
```

This script makes a real API request and requires working OpenRouter credentials and an available model. It is not a Jest unit test.

`npm run format` formats the whole backend. `npm run commit` runs formatting, tests, lint, type checking, and a build; it does not create a Git commit.

## Run compiled services

```sh
npm run build
npm start
```

Run the compiled worker in a separate process:

```sh
node dist/workers/document.worker.js
```

Provide environment variables to both processes, or keep `.env` in their working directory. Build output is written to `dist`.

## Project layout

| Path | Contents |
| --- | --- |
| `src/server.ts` | Express startup, middleware, and route registration. |
| `src/config/` | Validated environment and external service clients. |
| `src/routes/` / `src/controllers/` | HTTP routes and handlers. |
| `src/middleware/protectRoute.ts` | Supabase access-token verification. |
| `src/db/` | Drizzle client, schema, and inferred database types. |
| `drizzle/` | SQL migrations and migration metadata. |
| `src/queue/` / `src/workers/` | BullMQ producer and document worker. |
| `src/services/` | Ingestion and retrieval pipeline scaffolding. |
| `src/tests/` | Unit tests and the standalone OpenRouter integration script. |
| `.github/workflows/basic.yml` | CI dependency installation, type check, tests, and build with dummy environment values. |

The API registers route groups at `/api/courses`, `/api/notebooks`, `/api/documents`, `/api/chat`, `/api/flashcards`, and `/api/tests`. Consult the route and controller files for implemented endpoints and request types; registration alone does not mean a handler is complete.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Invalid environment variables` | Fill every required variable in `.env`, including `GROQ_MODEL` and `SENTRY_DSN`. Run commands from `backend`. |
| PostgreSQL connection or migration failure | Check the host, credentials, SSL configuration, network access, and pgvector availability. |
| Redis connection refused | Start Redis and verify `REDIS_URL` from both API and worker environments. |
| Documents stay queued | Start the worker and ensure it uses the same Redis instance as the API. |
| Document status becomes `failed` with `not implemented` | Implement the ingestion helper stubs; credentials alone do not complete the pipeline. |
| Browser API request blocked by CORS | Set `FRONTEND_URL` to the browser's exact origin and restart the API. |
| Browser upload to R2 blocked by CORS | Configure CORS on the R2 bucket as well as on the API. |
| API returns 401 | Supply a valid Supabase user access token in the Bearer header. |
| Jest tries to run `dist/tests/*.js` | Keep Jest's `roots` restricted to `<rootDir>/src`. |
| Jest cannot load the OpenRouter ES module | Run the integration script with `tsx`; the current Jest transform uses CommonJS. |
| Sentry diagnostics-channel warning in Jest | Sentry initialization can warn under Jest; mock the Sentry config module in isolated unit tests if needed. |
| Port 3000 is already in use | Stop the conflicting service or change the hardcoded port in `src/server.ts`. |
