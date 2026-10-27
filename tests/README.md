# Independent HTTP contract tests

Configure environment variables

```sh
cp .env.test.example .env.test
```

Input the following dummy data to Supabase's user for testing purpose. 

email: test-user-1@example.com
password: "test-password"

email: test-user-2@example.com
password: test-password

Run 
``` sh
npx tsx tests/helpers/getAuthToken.ts
```
The tokens from the console are to be put in .env.test. Also create the Course and NoteBook dummy in Supabase table and add them to .env.test


These Jest tests call HTTP endpoints without importing backend source, mocking
controllers, or assuming database/queue implementation details. Expected behavior
comes from the documented API contracts. They are separate from the existing unit
suite: `npm test` runs unit tests; `npm run test:api` runs these acceptance tests.
Node 20 or newer is required for built-in fetch.

All tests and shared helpers use TypeScript. Both Jest configurations use
`ts-jest`; the HTTP suite still imports no backend implementation. Check test
types with `./node_modules/.bin/tsc --project tsconfig.tests.json`.

Start the API and ingestion worker against an isolated test environment with real
test services. Supply two distinct Supabase user access tokens and an existing
course/notebook pair owned by the first user. Neither token should be an API key.

```sh
npm run test:api
```

The suite fails explicitly if required configuration is missing; it never silently
skips endpoint tests. Requests time out after 10 seconds. Async processing polls
for up to 60 seconds and accepts any observable intermediate state. Processing
failure and timeout both fail the successful ingestion test. The upload uses a
small text fixture and the actual presigned storage URL.

The async contract requires `POST /api/documents/confirm` to return
202 `{ documentId, status: "queued" }`, followed by polling
`GET /api/documents/:id` until ready. Other users receive 404 for owned
resources, as documented. The suite deliberately does not adjust expectations to
make unimplemented handlers pass.

Tests create uniquely named courses and flashcard sets and delete tracked resources
after each test. Cleanup failures are reported. The supplied notebook/course are
retained: no notebook deletion endpoint is documented. If confirmation fails
before returning an ID, a uploaded storage object may remain; use disposable
storage and database fixtures. A broken ownership endpoint can also create a
foreign-owned resource that the first user cannot clean up.

Coverage: authentication on all registered protected endpoints; course CRUD and
ownership; notebook filtering and ownership; manual flashcard CRUD and ownership;
invalid generation inputs; missing resources; presign size boundary; real upload,
async acceptance, status polling, document ownership, rename and deletion;
flashcard generation from ready notes and notebook test generation/content/deletion.

Reference-mode AI generation, worker retry/failure injection, notebook duplicate
creation and authenticated chat CRUD are not covered yet. Chat response/input
schemas and a reproducible processing-failure fixture need specification.
Black-box tests cannot inject queue failures without a public test-environment
control. Existing ingestion stubs and empty handlers are expected to fail these
acceptance tests until implemented.
