import { Queue } from "bullmq";
import { producerRedis } from "../config/redis.js";

export type DocumentJob = {
  documentId: string;
};

export const documentQueue = new Queue<DocumentJob>("document-processing", {
  connection: producerRedis,
});
