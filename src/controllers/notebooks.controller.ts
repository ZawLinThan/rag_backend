import type { Request, Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { courses, notebooks, documents } from "../db/schema.js";
import { Sentry } from "../config/sentry.js";
import z from "zod";

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
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const raw = req.query.courseId;
    const courseId = typeof raw === "string" ? raw : undefined;

    if (
      raw != undefined &&
      (!courseId || !z.uuid().safeParse(courseId).success)
    ) {
      res.status(400).json({ error: "courseId must be a valid UUID." });
      return;
    }
    if (courseId) {
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
        .limit(1);

      if (!course) {
        res.status(404).json({ error: "Course not found" });
        return;
      }
    }

    const rows = await db
      .select()
      .from(notebooks)
      .where(
        courseId
          ? and(eq(notebooks.userId, userId), eq(notebooks.courseId, courseId))
          : eq(notebooks.userId, userId),
      );

    res.status(200).json(rows);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "notebooks-list" } });
    console.error("Error listing notebooks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

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
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { courseId, noteBookName } = req.body ?? {};
    if (typeof courseId !== "string" || !z.uuid().safeParse(courseId).success) {
      res.status(400).json({ error: "courseId must be a valid UUID." });
      return;
    }

    const name = typeof noteBookName === "string" ? noteBookName.trim() : "";

    if (name.length < 1 || name.length > 255) {
      res.status(400).json({ error: "Enter a notebook name." });
      return;
    }

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
      .limit(1);

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    const [duplicate] = await db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(
        and(
          eq(notebooks.userId, userId),
          eq(notebooks.courseId, courseId),
          eq(notebooks.noteBookName, name),
        ),
      )
      .limit(1);
    if (duplicate) {
      res
        .status(409)
        .json({ error: "A notebook with this name already exists." });
      return;
    }

    const [notebook] = await db
      .insert(notebooks)
      .values({ userId, courseId, noteBookName: name })
      .returning();

    res.status(201).json(notebook);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "notebooks-create" } });
    console.error("Error creating notebook:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** PATCH /api/notebooks/:id — update the owned notebook's display name. */
export const editNotebook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = z.uuid().safeParse(req.params.id);
  const body = z
    .object({ noteBookName: z.string().trim().min(1).max(255) })
    .safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: "Invalid notebook ID or name" });
    return;
  }
  try {
    const [notebook] = await db
      .select()
      .from(notebooks)
      .where(and(eq(notebooks.id, id.data), eq(notebooks.userId, userId)))
      .limit(1);
    if (!notebook) {
      res.status(404).json({ error: "Notebook not found" });
      return;
    }
    const [duplicate] = await db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(
        and(
          eq(notebooks.userId, userId),
          notebook.courseId
            ? eq(notebooks.courseId, notebook.courseId)
            : sql`${notebooks.courseId} is null`,
          eq(notebooks.noteBookName, body.data.noteBookName),
          ne(notebooks.id, id.data),
        ),
      )
      .limit(1);
    if (duplicate) {
      res
        .status(409)
        .json({ error: "A notebook with this name already exists." });
      return;
    }
    const [updated] = await db
      .update(notebooks)
      .set({ noteBookName: body.data.noteBookName })
      .where(and(eq(notebooks.id, id.data), eq(notebooks.userId, userId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Notebook not found" });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/** DELETE /api/notebooks/:id — delete an empty, owned notebook. */
export const deleteNotebook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid notebook ID" });
    return;
  }
  try {
    const [notebook] = await db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(and(eq(notebooks.id, id.data), eq(notebooks.userId, userId)))
      .limit(1);
    if (!notebook) {
      res.status(404).json({ error: "Notebook not found" });
      return;
    }
    const deleted = await db
      .delete(notebooks)
      .where(
        and(
          eq(notebooks.id, id.data),
          eq(notebooks.userId, userId),
          sql`not exists (select 1 from ${documents} where ${documents.notebookId} = ${id.data})`,
        ),
      )
      .returning({ id: notebooks.id });
    if (!deleted.length) {
      res.status(409).json({
        error: "Remove the documents in this notebook before deleting it.",
      });
      return;
    }
    res.status(204).send();
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
