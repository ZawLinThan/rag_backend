import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { courses, notebooks } from "../db/schema.js";
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
            res.status(401).json({error: "Unauthorized"});
            return;
            }

        const raw = req.query.courseId;
        const courseId = typeof raw === "string" ? raw : undefined;

        if (raw != undefined && (!courseId || !z.uuid().safeParse(courseId).success)) {
            res.status(400).json({error: "courseId must be a valid UUID."});
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
            ? and(eq(notebooks.userId, userId), eq(notebooks.courseId, courseId)) : eq(notebooks.userId, userId),
            );

        res.status(200).json(rows);
        } catch (error) {
            Sentry.captureException(error, { tags: { area : "notebooks-list" } });
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
            res.status(401).json({ error: "Unauthorized"});
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
            res.status(404).json({ error: "Course not found"});
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
                .json({ error: "A notebook with this name already exists."});
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
