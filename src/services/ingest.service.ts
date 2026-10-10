import { Job } from "bullmq";
import { db } from "../db/index.js";
import { Chunk, documents, DocumentStatus } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Sentry } from "../config/sentry.js";

// download from r2
const downloadFromR2 = async (r2Key: string) => {};
// extract text

// chunk

// embed

// store in vector DB

/**
 * Update the document's status to the new status
 * Assume that user's ownership(authentication) is done before this function call
 *
 * @param documentId id of the document to update
 * @param status the new status to be updated
 * @returns the updated document
 * @throws Error for db error
 */
export const updateDocumentStatus = async (
  documentId: string,
  status: DocumentStatus,
) => {
  try {
    return await db
      .update(documents)
      .set({ status })
      .where(eq(documents.id, documentId))
      .returning();
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-status-update",
      },
    });
    throw new Error("Failed to update the document status");
  }
};

type Props = {
  documentId: string;
  job: Job;
};

export const processDocument = async ({ documentId, job }: Props) => {
  /// DON"T TOUCH THIS FILE NOW ///
  updateDocumentStatus(documentId, "processing");

  try {
    const documentResult = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    const document = documentResult[0];

    await job.updateProgress(10);

    const file = Sentry.startSpan(
      {
        name: "download-r2",
        op: "storage.download",
      },
      async () => {
        return downloadFromR2(document.r2Key);
      },
    );

    await job.updateProgress(25);

    const text = await extractText(file);

    await job.updateProgress(55);

    const chunks: Chunk[] = chunkText(text);

    await job.updateProgress(55);

    const embeddings = await embedChunks(chunks);

    await job.updateProgress(85);

    // save chunks to database

    await updateDocumentStatus(documentId, "ready");

    await job.updateProgress(100);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-ingestion",
      },
    });
    await updateDocumentStatus(documentId, "failed");
    throw error;
  }
};
