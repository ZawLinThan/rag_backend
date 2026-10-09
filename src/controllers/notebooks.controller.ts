import type { Request, Response } from "express";

/**
 * GET /api/notebooks?courseId=...
 * List owned notebooks, optionally filtered by an owned course.
 * Optional req.query.courseId.
 * Respond with 200 NoteBook[]; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getAllNotebooks = async (
  req: Request,
  res: Response,
): Promise<void> => {};

/**
 * POST /api/notebooks
 * Validate the owned course and name; reject a duplicate name within that course.
 * CreateNotebookInput: { courseId, noteBookName }.
 * Respond with 201 NoteBook; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const createNotebook = async (
  req: Request,
  res: Response,
): Promise<void> => {};
