import { Worker } from "bullmq";
import { workerRedis } from "../config/redis.js";
import { processDocument } from "../services/ingest.service.js";
import { Sentry } from "../config/sentry.js";

const worker = new Worker(
  "document-processing",
  async (job) => {
    const { documentId } = job.data;
    console.log("Processing document: ", documentId);

    return Sentry.startSpan(
      {
        name: "process-document",
        op: "bullmq.job",
        attributes: {
          jobId: job.id,
          documentId: documentId,
        },
      },
      async () => {
        return processDocument({ documentId, job });
      },
    );
  },
  {
    connection: workerRedis,
    concurrency: 2,
  },
);

console.log("Worker started");

worker.on("completed", (job) => {
  console.log(`Document job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Document job ${job?.id} failed`, error);
});

/**
 * Shutdown the bullmq
 */
const shutdown = async () => {
  console.log("Shutting down BullMQ worker");

  await worker.close();
  await workerRedis.quit();

  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
