import { env } from "../config/env";
import type { Request, Response } from "express";
import type { ConfirmFileUploadReq, GetPresignedUrlReq } from "../types/index";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../config/r2";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../db";
import { documents } from "../db/schema";
import { documentQueue } from "../queue/document.queue";
import { updateDocumentStatus } from "../services/ingest.service";
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
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
};

/**
 * POST /api/documents/confirm
 * Verify the uploaded R2 key belongs to the user and exists; validate notebook/course ownership, create metadata and queue ingestion (extract, chunk, embed).
 * ConfirmFileUploadReq: { name, originalName, r2Key, fileType, fileSize, courseId, notebookId }.
 * Response: 201 Document, initially pending; GET polling reports later status. Serialize dates as ISO strings with no envelope.
 * Errors: { error: string } with 400 validation, 401 authentication,
 * 404 missing/ownership, 409 conflict, or 500 unexpected failure.
 * @param req - Authenticated Express request; scope all records to req.user.id.
 * @param res - Response carrying the documented status and payload.
 * @returns Resolves after the response when implemented.
 */
export const ingestPipeline = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  // don't touch this function now !! //
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
      await updateDocumentStatus(document.id, "failed");

      throw queueError;
    }

    return res.status(202).json({
      documentId: document.id,
      status: "queued",
    });
  } catch (error) {
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
): Promise<void> => {};

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
): Promise<void> => {};

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
): Promise<void> => {};

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
