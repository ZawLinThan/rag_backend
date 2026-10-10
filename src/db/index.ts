import { env } from "../config/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = env.DATABASE_URL;

// Disable prepared statements for Supabase's transaction pooler.
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });
