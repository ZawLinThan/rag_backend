import { env } from "./env.js";
import { Redis } from "ioredis";

export const workerRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const producerRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});
