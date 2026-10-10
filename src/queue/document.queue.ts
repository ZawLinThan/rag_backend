import { Queue } from "bullmq";
import { producerRedis } from "../config/redis";

export type DocumentJob = {
  documentId: string;
};

export const documentQueue = new Queue<DocumentJob>("document-processing", {
  connection: producerRedis,
});
