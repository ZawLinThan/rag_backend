import type { Request, Response } from "express";
import type { ConfirmFileUploadReq, GetPresignedUrlReq } from "../types/index";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../config/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";
/**
 * @description Controller function to generate a presigned URL for uploading a file to S3.
 * File size limit is 20MB. Presigned URL expires in 5 minutes.
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
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 3600 },
    );
    console.log("Got Presigned");
    res.status(200).json({
      uploadUrl,
      key,
      publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
};

/**
 *
 * @description Controller function to handle the ingest pipeline for a document.
 * It receives a document ID from the request parameters and processes the document through the ingest pipeline.
 * The pipeline includes extracting text, chunking, embedding, and storing in a vector database.
 * EndPoint: POST /documents/confirm
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const ingestPipeline = async (req: Request, res: Response) => {
  const {
    name,
    originalName,
    r2Key,
    fileType,
    fileSize,
    courseId,
    notebookId,
  } = req.body as ConfirmFileUploadReq;
  // don't touch it now.
};

/**
 * @description Controller function to retrieve all documents for the user from the database.
 * EndPoint: GET /documents/
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getAllDocuments = async (req: Request, res: Response) => {};

/**
 * @description Controller function to retrieve a single document by its ID and its ingestion status from the database.
 * EndPoint: GET /documents/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getSingleDocument = async (req: Request, res: Response) => {};

/**
 * @description Controller function to delete a document by its ID from the database, R2 bucket, chunks, embedding db.
 * EndPoint: DELETE /documents/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const deleteDocument = async (req: Request, res: Response) => {};

/**
 * @description Controller function to edit the file name of a document by its ID in the database. // or maybe retag
 * EndPoint: PATCH /documents/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const editDocument = async (req: Request, res: Response) => {};
