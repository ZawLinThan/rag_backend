import type { Job } from "bullmq";
import { db } from "../db/index.js";
import { chunks as chunksTable, documents } from "../db/schema.js";
import type { Document, DocumentStatus, NewChunk } from "../db/schema.js";
import type { DocumentJob } from "../queue/document.queue.js";
import { eq } from "drizzle-orm";
import { embedText } from "../config/openRouterAI.js";
import { Sentry } from "../config/sentry.js";
import { PermanentError } from "../lib/errors.js";
import { beforeProviderCall } from "../lib/providerCalls.js";
import { scheduleProviderRequest } from "../lib/providerRateLimit.js";

type TextChunk = Pick<
  NewChunk,
  "content" | "chunkIndex" | "pageNumber" | "tokenCount"
>;

type EmbeddedChunk = TextChunk & {
  embedding: NonNullable<NewChunk["embedding"]>;
};

/** Vector width the chunks table expects. */
const EMBEDDING_DIMENSIONS = 2048;

/** Rows per insert statement. */
const INSERT_BATCH_SIZE = 100;

// Download the document's bytes from R2.
const downloadFromR2 = async (_r2Key: string): Promise<Buffer> => {
  throw new Error("downloadFromR2 is not implemented");
};

// Extract text using the document's file type (pdf, docx, or txt).
const extractText = async (
  _file: Buffer,
  _fileType: Document["fileType"],
): Promise<string> => {
  throw new Error("extractText is not implemented");
};

// Split extracted text into chunks before database IDs are assigned.
const chunkText = (_text: string): TextChunk[] => {
  throw new Error("chunkText is not implemented");
};

// Associate each chunk with its embedding vector.
const embedChunks = async (
  textChunks: readonly TextChunk[],
): Promise<EmbeddedChunk[]> => {
  const embedded: EmbeddedChunk[] = [];

  for (const chunk of textChunks) {
    const embedding = await scheduleProviderRequest(
      "openrouter",
      Math.ceil(chunk.content.length / 4),
      async () => {
        await beforeProviderCall();
        return embedText(chunk.content);
      },
    );

    if (
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every(Number.isFinite) ||
      !embedding.some((value) => value !== 0)
    ) {
      throw new PermanentError(
        `Embedding must be a finite, nonzero ${EMBEDDING_DIMENSIONS}-dimension vector.`,
      );
    }
    embedded.push({ ...chunk, embedding });
  }

  return embedded;
};

// Store embedded chunks with their document and user ownership.
const storeChunks = async (
  documentId: Document["id"],
  userId: Document["userId"],
  embeddedChunks: readonly EmbeddedChunk[],
): Promise<void> => {
  await db.transaction(async (tx) => {
    // Clear rows from an earlier attempt; (documentID, chunkIndex) is unique.
    await tx.delete(chunksTable).where(eq(chunksTable.documentId, documentId));

    for (
      let start = 0;
      start < embeddedChunks.length;
      start += INSERT_BATCH_SIZE
    ) {
      const rows: NewChunk[] = embeddedChunks
        .slice(start, start + INSERT_BATCH_SIZE)
        .map((chunk) => ({
          documentId,
          userId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          tokenCount: chunk.tokenCount,
          embedding: chunk.embedding,
        }));

      await tx.insert(chunksTable).values(rows);
    }
  });
};

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
): Promise<Document[]> => {
  try {
    return await Sentry.startSpan(
      {
        name: "update-document-status",
        op: "db.query",
        attributes: { "document.status": status },
      },
      async () => {
        return db
          .update(documents)
          .set({ status })
          .where(eq(documents.id, documentId))
          .returning();
      },
    );
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
  job: Job<DocumentJob, void>;
};

export const processDocument = async ({
  documentId,
  job,
}: Props): Promise<void> => {
  /// DO NOT TOUCH THIS FILE NOW ///
  await updateDocumentStatus(documentId, "processing");

  try {
    const documentResult = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    const document = documentResult[0];

    await job.updateProgress(10);

    // download from r2
    const file = await Sentry.startSpan(
      {
        name: "download-r2",
        op: "storage.download",
      },
      async () => {
        return downloadFromR2(document.r2Key);
      },
    );

    await job.updateProgress(25);

    // extract text
    const text = await Sentry.startSpan(
      {
        name: "extract-text",
        op: "document.extract",
      },
      async () => {
        return extractText(file, document.fileType);
      },
    );

    await job.updateProgress(55);

    // chunking
    const chunks: TextChunk[] = chunkText(text);

    await job.updateProgress(55);

    // embedding
    const embeddedChunks = await Sentry.startSpan(
      {
        name: "embed-chunks",
        op: "ai.embedding",
      },
      async () => {
        return embedChunks(chunks);
      },
    );

    await job.updateProgress(85);

    // store chunks
    await Sentry.startSpan(
      {
        name: "store-chunks",
        op: "db.query",
      },
      async () => {
        return storeChunks(document.id, document.userId, embeddedChunks);
      },
    );

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
