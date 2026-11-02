import type { Job } from "bullmq";
import OpenAI from "openai";
import { db } from "../db/index.js";
import { chunks as chunksTable, documents } from "../db/schema.js";
import type { Document, DocumentStatus, NewChunk } from "../db/schema.js";
import type { DocumentJob } from "../queue/document.queue.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
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

/** Embedding model served through OpenRouter; 1536 dims, matching chunks.embedding. */
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** Vector width the chunks table expects. */
const EMBEDDING_DIMENSIONS = 1536;

/** Inputs per embeddings request. */
const EMBEDDING_BATCH_SIZE = 96;

/** Rows per insert statement. */
const INSERT_BATCH_SIZE = 100;

/** OpenRouter's embeddings API, which is OpenAI-compatible. */
const embeddingClient = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  timeout: 60000,
  maxRetries: 0,
});

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
  if (textChunks.length === 0) return [];

  const embedded: EmbeddedChunk[] = [];

  for (
    let start = 0;
    start < textChunks.length;
    start += EMBEDDING_BATCH_SIZE
  ) {
    const batch = textChunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const estimatedTokens = batch.reduce(
      (total, chunk) => total + Math.ceil(chunk.content.length / 4),
      0,
    );

    const response = await scheduleProviderRequest(
      "openrouter",
      estimatedTokens,
      async () => {
        await beforeProviderCall();
        return embeddingClient.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch.map((chunk) => chunk.content),
        });
      },
    );

    if (response.data.length !== batch.length) {
      throw new PermanentError(
        `Embedding provider returned ${response.data.length} vectors for ${batch.length} inputs.`,
      );
    }

    //Items carry their input index; do not assume response order.
    for (const item of response.data) {
      const chunk = batch[item.index];

      if (!chunk) {
        throw new PermanentError(
          `Embedding response referenced unknown input index ${item.index}.`,
        );
      }

      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new PermanentError(
          `Expected ${EMBEDDING_DIMENSIONS}-dimension embeddings, received ${item.embedding.length}.`,
        );
      }

      embedded.push({ ...chunk, embedding: item.embedding });
    }
  }

  return embedded.sort((a, b) => a.chunkIndex - b.chunkIndex);
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
