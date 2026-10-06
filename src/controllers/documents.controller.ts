import type { Request, Response } from "express";
import type { SuccessfulPresignedUrlResponse, Error } from "../types/index";

/**
 * @description Controller function to generate a presigned URL for uploading a file to S3.
 * File size limit is 20MB. Presigned URL expires in 5 minutes.
 * Acceptable file types are: .pdf, .docx, .txt (.jpg, .jpeg, .png, will be added in the future)
 * The response has to be of type @link SuccessfulPresignedUrlResponse or @link Error
 * EndPoint: POST documents/presign
 *
 * @param req - The request object from Express
 * @param res - The response object from Express
 * @returns A presigned URL for uploading a file to S3
 */
export const getPresignedUrl = async (req: Request, res: Response) => {};

/**
 *
 * @description Controller function to handle the ingest pipeline for a document.
 * It receives a document ID from the request parameters and processes the document through the ingest pipeline.
 * The pipeline includes extracting text, chunking, embedding, and storing in a vector database.
 * EndPoint: POST /documents/:id/confirm
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const ingestPipeline = async (req: Request, res: Response) => {
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
