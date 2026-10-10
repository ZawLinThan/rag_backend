import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { env } from "./env.js";

Sentry.init({
  dsn: env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  // Tracing
  tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0, //  Capture 100% of the transactions for dev
  // Set sampling rate for profiling - this is evaluated only once per SDK.init call
  profileSessionSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
  // Trace lifecycle automatically enables profiling during active traces
  profileLifecycle: "trace",
});

export { Sentry };
