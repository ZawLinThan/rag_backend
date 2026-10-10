import { env } from "./env";
import IORedis from "ioredis";

export const workerRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const producerRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});
