import { env } from "../config/env.js";
import type { Request, Response } from "express";
import type {
  ConfirmFileUploadReq,
  GetPresignedUrlReq,
} from "../types/index.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../config/r2.js";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { db } from "../db/index.js";
import {
  chatSessionDocuments,
  documents,
  flashcardSets,
  tests,
} from "../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { documentQueue } from "../queue/document.queue.js";
import { updateDocumentStatus } from "../services/ingest.service.js";
import { Sentry } from "../config/sentry.js";
/**
 * @description Controller function to generate a presigned URL for uploading a file to S3.
 * File size limit is 20MB. Presigned URL expires in 3600 seconds.
 * Acceptable file types are: .pdf, .docx, .txt (.jpg, .jpeg, .png, will be added in the future)
 *
 * @param req - The request object from Express
 * @param res - The response object from Express
 * @returns A presigned URL for uploading a file to S3
 */
export const getPresignedUrl = async (req: Request, res: Response) => {
  try {
    const id = req.user?.id;

    if (!id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { fileName, contentType, size } = req.body as GetPresignedUrlReq;

    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    if (size > MAX_SIZE) {
      return res.status(400).json({ error: "File too large" });
    }

    // check the allowed type
    const key = `${id}/${Date.now()}-${fileName.replace(/\s/g, "-")}`;

    console.log("about to send req to r2");
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 3600 },
    );
    console.log("Got Presigned");
    res.status(200).json({
      uploadUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-upload-presigned-url",
      },
    });
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
};

/**
 * POST /api/documents/confirm
 * Verify the uploaded R2 key belongs to the user and exists; validate notebook/course ownership, create metadata and queue ingestion (extract, chunk, embed).
 * ConfirmFileUploadReq: { name, originalName, r2Key, fileType, fileSize, courseId, notebookId }.
 * Response: 202 { documentId, status: "queued" }; GET /api/documents/:id polling reports later processing status.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const ingestPipeline = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  /// DON"T TOUCH THIS FILE NOW ///
  // need to consider the file ingestion for the test generations based on the sample test
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const {
    name,
    originalName,
    r2Key,
    fileType,
    fileSize,
    courseId,
    notebookId,
  } = req.body as ConfirmFileUploadReq;

  try {
    // Presigned uploads are namespaced as `<userId>/...`. Do not allow a
    // different authenticated user to confirm and ingest an existing object.
    if (r2Key.split("/", 1)[0] !== userId) {
      return res.status(404).json({ error: "Uploaded file not found" });
    }

    // verify if the file exists in R2 or not
    await s3.send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: r2Key,
      }),
    );

    // create document row
    const [document] = await db
      .insert(documents)
      .values({
        userId,
        name,
        originalName,
        r2Key,
        fileType,
        fileSize,
        courseId,
        notebookId,
        status: "pending",
      })
      .returning();
    // testing purpose
    return res.status(202).json({
      documentId: document.id,
      status: "queued",
    });
    // process document
    try {
      await documentQueue.add(
        env.PROCESS_DOCUMENT_QUEUE,
        {
          documentId: document.id,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );

      await updateDocumentStatus(document.id, "queued");
    } catch (queueError) {
      Sentry.captureException(queueError, {
        tags: {
          area: "document-ingestion-queue",
        },
      });
      await updateDocumentStatus(document.id, "failed");

      throw queueError;
    }

    return res.status(202).json({
      documentId: document.id,
      status: "queued",
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-ingestion",
      },
    });
    console.log("Error creating document row: ", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/documents
 * List all owned document metadata and ingestion states.
 * No body.
 * Response: 200 Document[] Serialize dates as ISO strings with no envelope.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const getAllDocuments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const ownedDocuments = await db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt));

    // The documented contract returns the document array directly, not an envelope.
    res.status(200).json(ownedDocuments);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-list",
      },
    });
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/documents/:id
 * Retrieve one owned document including ingestion status/error.
 * req.params.id.
 * Response: 200 Document Serialize dates as ISO strings with no envelope.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const getSingleDocument = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  const { id } = req.params as { id: string };

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!id) {
    res.status(400).json({ error: "Document ID is required" });
    return;
  }

  try {
    const [document] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    // Looking up by both id and userId keeps another user's document indistinguishable from absent.
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // The documented contract returns one document directly, not an envelope.
    res.status(200).json(document);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-read",
      },
    });
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /api/documents/:id
 * Reject test references, delete R2 object/chunks/embeddings and metadata, and clear flashcard-set document references.
 * req.params.id.
 * Response: 204 without a body; 409 if referenced by tests Serialize dates as ISO strings with no envelope.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const deleteDocument = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  const { id } = req.params as { id: string };

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!id) {
    res.status(400).json({ error: "Document ID is required" });
    return;
  }

  try {
    const [document] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // Tests intentionally restrict document deletion while they use the upload as a reference.
    const [testReference] = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.referenceFileId, id))
      .limit(1);

    if (testReference) {
      res.status(409).json({
        error: "Document is referenced by a test and cannot be deleted",
      });
      return;
    }

    // This relation is also a database-level RESTRICT foreign key, so surface a useful conflict.
    const [chatSessionReference] = await db
      .select({ sessionId: chatSessionDocuments.sessionId })
      .from(chatSessionDocuments)
      .where(eq(chatSessionDocuments.documentId, id))
      .limit(1);

    if (chatSessionReference) {
      res.status(409).json({
        error: "Document is used by a chat session and cannot be deleted",
      });
      return;
    }

    // Delete the object before metadata. R2 object deletion is idempotent, so a retry is safe
    // if the subsequent database transaction is interrupted.
    await s3.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: document.r2Key,
      }),
    );

    await db.transaction(async (tx) => {
      // Make the required flashcard-set cleanup explicit, even though the FK also uses SET NULL.
      await tx
        .update(flashcardSets)
        .set({ documentId: null, updatedAt: new Date() })
        .where(eq(flashcardSets.documentId, id));

      // The schema cascades document deletion to chunks and message_sources for those chunks.
      await tx
        .delete(documents)
        .where(and(eq(documents.id, id), eq(documents.userId, userId)));
    });

    res.status(204).send();
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        area: "document-delete",
      },
    });
    console.error("Error deleting document:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PATCH /api/documents/:id
 * Validate and update an owned document display name and updatedAt; retain originalName and R2 key.
 * req.params.id; body { name }.
 * Response: 200 Document Serialize dates as ISO strings with no envelope.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const editDocument = async (
  req: Request,
  res: Response,
): Promise<void> => {};
