import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import {
  courses,
  documents,
  flashcardSets,
  notebooks,
  type Course,
} from "../db/schema.js";
import {z} from "zod"; 

const serializeCourse = (course: Course) => ({
  ...course,
  createdAt: course.createdAt.toISOString(),
  updatedAt: course.updatedAt.toISOString(),
});

/**
 * GET /api/courses
 * List courses belonging to req.user.id.
 * No request body.
 * Respond with 200 Course[]; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getAllCourses = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userID = req.user?.id;
  if (!userID) {
    res.status(401).json({ error: "Unauthorized user" });
    return;
  }
  try {
    const result = await db
      .select()
      .from(courses)
      .where(eq(courses.userId, userID));
    res.status(200).json(result.map(serializeCourse));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/courses
 * Validate name/code/semester, persist a course for req.user.id.
 * CreateCourseInput: { name, code, semester }.
 * Respond with 201 Course; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const createCourse = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userID = req.user?.id;
  if (!userID) {
    res.status(401).json({ error: "Unauthorized user" });
    return;
  }

  if (
    typeof req.body !== "object" ||
    req.body === null ||
    Array.isArray(req.body)
  ) {
    res.status(400).json({ error: "Invalid course data" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const code = typeof body.code === "string" ? body.code.trim() : undefined;
  const semester =
    typeof body.semester === "string" ? body.semester.trim() : undefined;

  if (
    !name ||
    !code ||
    !semester ||
    name.length > 255 ||
    code.length > 50 ||
    semester.length > 50
  ) {
    res.status(400).json({ error: "Invalid course data" });
    return;
  }

  try {
    const [course] = await db
      .insert(courses)
      .values({ userId: userID, name, code, semester })
      .returning();

    if (!course) {
      res.status(500).json({ error: "Failed to create course" });
      return;
    }

    res.status(201).json(serializeCourse(course));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "Course already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/courses/:id
 * Find a course by ID and enforce ownership.
 * req.params.id is the course ID.
 * Respond with 200 Course; 404 if absent; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getCourseById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userID = req.user?.id;
  if (!userID) {
    res.status(401).json({ error: "Unauthorized user" });
    return;
  }

  const courseID = req.params.id;
  if (typeof courseID !== "string" || !z.uuid().safeParse(courseID).success) {
    res.status(400).json({ error: "Invalid course ID" });
    return;
  }

  try {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseID), eq(courses.userId, userID)));

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }
    res.status(200).json(serializeCourse(course));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /api/courses/:id
 * Enforce ownership and reject deletion while dependent notebooks/documents/sets exist.
 * req.params.id is the course ID.
 * Respond with 204 without a body; 409 for dependencies; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const deleteCourse = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userID = req.user?.id;
  if (!userID) {
    res.status(401).json({ error: "Unauthorized user" });
    return;
  }

  const courseID = req.params.id;
  if (typeof courseID !== "string" || !z.uuid().safeParse(courseID).success) {
    res.status(400).json({ error: "Invalid course ID" });
    return;
  }

  try {
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseID), eq(courses.userId, userID)));

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    const [courseNotebooks, courseDocuments, courseSets] = await Promise.all([
      db
        .select({ id: notebooks.id })
        .from(notebooks)
        .where(eq(notebooks.courseId, courseID))
        .limit(1),
      db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.courseId, courseID))
        .limit(1),
      db
        .select({ id: flashcardSets.id })
        .from(flashcardSets)
        .where(eq(flashcardSets.courseId, courseID))
        .limit(1),
    ]);

    if (
      courseNotebooks.length > 0 ||
      courseDocuments.length > 0 ||
      courseSets.length > 0
    ) {
      res.status(409).json({ error: "Course has dependent records" });
      return;
    }

    await db
      .delete(courses)
      .where(and(eq(courses.id, courseID), eq(courses.userId, userID)));
    res.status(204).send();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      res.status(409).json({ error: "Course has dependent records" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};
