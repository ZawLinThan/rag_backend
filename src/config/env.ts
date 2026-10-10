import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
  SUPABASE_SECRET_KEY: z.string().trim().min(1),
  SUPABASE_JWKS_URL: z.url(),
  DATABASE_URL: z.url(),
  FRONTEND_URL: z.url().default("http://localhost:5173"),
  R2_ENDPOINT: z.url(),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
  R2_BUCKET_NAME: z.string().trim().min(1),
  GROQ_API_KEY: z.string().trim().min(1),
  GROQ_MODEL: z.string(), // take it out later
  OPENROUTER_API_KEY: z.string().trim().min(1),
  REDIS_URL: z.url(),
  PROCESS_DOCUMENT_QUEUE: z.string().trim().min(1),
  SENTRY_DSN: z.url(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error("Invalid environment variables: ");
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
