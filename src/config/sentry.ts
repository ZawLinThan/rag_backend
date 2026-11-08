import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { env } from "./env.js";

Sentry.init({
  dsn: env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0, //  Capture 100% of the transactions for dev
  profileSessionSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
  profileLifecycle: "trace",
});

export { Sentry };
