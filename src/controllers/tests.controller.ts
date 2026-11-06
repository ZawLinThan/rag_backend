import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  chunks,
  documents,
  notebooks,
  testContents,
  tests,
  type Test,
  type TestQuestion,
} from "../db/schema.js";
import { Sentry } from "../config/sentry.js";
import { ChatStructured } from "../config/groqAI.js";
import type { GenerateTestInput } from "../types/studyApi.js";

const TEST_QUESTION_COUNT = 10;
const MAX_STUDY_CONTEXT_CHARACTERS = 48_000;
const MAX_REFERENCE_CONTEXT_CHARACTERS = 16_000;

const uuidSchema = z.uuid();

const modelQuestionSchema = z
  .object({
    prompt: z.string().trim().min(12).max(1_000),
    answer: z.string().trim().min(1).max(1_000),
    options: z.array(z.string().trim().min(1).max(500)).max(4),
  })
  .superRefine(({ answer, options }, context) => {
    if (options.length !== 0 && options.length !== 4) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message:
          "Questions must be constructed response or have exactly four options.",
      });
      return;
    }

    const normalisedOptions = options.map((option) =>
      option.trim().toLocaleLowerCase(),
    );
    if (new Set(normalisedOptions).size !== normalisedOptions.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Multiple-choice options must be distinct.",
      });
    }
    if (
      options.length === 4 &&
      !normalisedOptions.includes(answer.trim().toLocaleLowerCase())
    ) {
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "A multiple-choice answer must exactly match one option.",
      });
    }
  });

const generatedTestSchema = z
  .object({
    instructions: z.string().trim().min(20).max(600),
    questions: z.array(modelQuestionSchema).length(TEST_QUESTION_COUNT),
  })
  .superRefine(({ questions }, context) => {
    const prompts = questions.map((question) =>
      question.prompt.trim().toLocaleLowerCase(),
    );
    if (new Set(prompts).size !== prompts.length) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Questions must not be duplicates.",
      });
    }

    const multipleChoiceCount = questions.filter(
      (question) => question.options.length === 4,
    ).length;
    if (multipleChoiceCount !== 6) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message:
          "A test needs six multiple-choice and four constructed-response questions.",
      });
    }
  });

type SourceChunk = {
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const compactSource = (
  chunksToCompact: SourceChunk[],
  maximumCharacters: number,
): string => {
  let remainingCharacters = maximumCharacters;
  const sourceParts: string[] = [];

  for (const chunk of chunksToCompact) {
    if (remainingCharacters <= 0) {
      break;
    }

    const content = chunk.content.trim();
    if (!content) {
      continue;
    }

    const heading = `[${chunk.documentName}, part ${chunk.chunkIndex + 1}]\n`;
    const availableContentCharacters = remainingCharacters - heading.length;
    if (availableContentCharacters <= 0) {
      break;
    }

    const excerpt = content.slice(0, availableContentCharacters);
    sourceParts.push(`${heading}${excerpt}`);
    remainingCharacters -= heading.length + excerpt.length;
  }

  return sourceParts.join("\n\n").trim();
};

const serialiseTest = (test: Test) => ({
  ...test,
  createdAt: test.createdAt.toISOString(),
  updatedAt: test.updatedAt.toISOString(),
});

/**
 * POST /api/tests/generate
 * Verify notebook ownership and ready study notes; for reference mode verify the owned reference document and URL. Generate and persist metadata and question content.
 * GenerateTestInput: { title, notebookId, mode, referenceFileId, referenceUrl }.
 * Respond with 201 Test (fetch content separately); serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const generateTest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Partial<GenerateTestInput>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const notebookId =
    typeof body.notebookId === "string" ? body.notebookId.trim() : "";
  const isReferenceMode = body.mode === "reference";
  const isNotebookMode = body.mode === "notebook";
  const referenceFileId =
    typeof body.referenceFileId === "string"
      ? body.referenceFileId.trim()
      : null;
  const referenceUrl =
    typeof body.referenceUrl === "string" ? body.referenceUrl.trim() : null;

  if (
    !title ||
    title.length > 100 ||
    !uuidSchema.safeParse(notebookId).success ||
    (!isReferenceMode && !isNotebookMode)
  ) {
    res.status(400).json({ error: "Invalid test generation request" });
    return;
  }

  if (
    (isNotebookMode && (referenceFileId !== null || referenceUrl !== null)) ||
    (isReferenceMode &&
      (!referenceFileId ||
        !uuidSchema.safeParse(referenceFileId).success ||
        !referenceUrl ||
        referenceUrl.length > 2_048 ||
        !isHttpUrl(referenceUrl)))
  ) {
    res.status(400).json({ error: "Invalid reference test details" });
    return;
  }

  try {
    const [notebook] = await db
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)))
      .limit(1);
    if (!notebook) {
      res.status(404).json({ error: "Notebook not found" });
      return;
    }

    const studyDocuments = await db
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          eq(documents.notebookId, notebook.id),
          eq(documents.status, "ready"),
        ),
      );

    // A sample test informs format and difficulty, but its answers must never
    // become the study source. Exclude it from the notebook study material.
    const readyStudyDocuments = referenceFileId
      ? studyDocuments.filter((document) => document.id !== referenceFileId)
      : studyDocuments;
    if (!readyStudyDocuments.length) {
      res
        .status(409)
        .json({ error: "No ready study documents in this notebook" });
      return;
    }

    let referenceDocument: { id: string; name: string } | undefined;
    if (isReferenceMode && referenceFileId) {
      [referenceDocument] = await db
        .select({ id: documents.id, name: documents.name })
        .from(documents)
        .where(
          and(
            eq(documents.id, referenceFileId),
            eq(documents.userId, userId),
            eq(documents.notebookId, notebook.id),
            eq(documents.status, "ready"),
          ),
        )
        .limit(1);
      if (!referenceDocument) {
        res.status(404).json({ error: "Reference document not found" });
        return;
      }
    }

    const sourceDocumentIds = [
      ...readyStudyDocuments.map((document) => document.id),
      ...(referenceDocument ? [referenceDocument.id] : []),
    ];
    const sourceChunks = await db
      .select({
        documentId: chunks.documentId,
        content: chunks.content,
        chunkIndex: chunks.chunkIndex,
      })
      .from(chunks)
      .where(inArray(chunks.documentId, sourceDocumentIds))
      .orderBy(asc(chunks.documentId), asc(chunks.chunkIndex));

    const documentNames = new Map(
      [
        ...readyStudyDocuments,
        ...(referenceDocument ? [referenceDocument] : []),
      ].map((document) => [document.id, document.name]),
    );
    const namedChunks: SourceChunk[] = sourceChunks.map((chunk) => ({
      ...chunk,
      documentName: documentNames.get(chunk.documentId) ?? "Study document",
    }));
    const studyDocumentIds = new Set(
      readyStudyDocuments.map((document) => document.id),
    );
    const studySource = compactSource(
      namedChunks.filter((chunk) => studyDocumentIds.has(chunk.documentId)),
      MAX_STUDY_CONTEXT_CHARACTERS,
    );
    if (!studySource) {
      res
        .status(409)
        .json({ error: "Ready study documents have no extracted notes" });
      return;
    }

    const referenceSource = referenceDocument
      ? compactSource(
          namedChunks.filter(
            (chunk) => chunk.documentId === referenceDocument.id,
          ),
          MAX_REFERENCE_CONTEXT_CHARACTERS,
        )
      : null;
    if (referenceDocument && !referenceSource) {
      res
        .status(409)
        .json({ error: "Reference document has no extracted notes" });
      return;
    }

    const generated = generatedTestSchema.parse(
      await ChatStructured({
        instruction:
          "Create a rigorous, fair practice test from the supplied study notes. " +
          "Use only the notebook study notes as the factual source; a reference test may guide difficulty and format only. " +
          "Return exactly 10 distinct questions: six multiple-choice questions with exactly four plausible, distinct options and four constructed-response questions with no options. " +
          "For multiple-choice questions, answer must be exactly the correct option text. " +
          "Mix recall with application, comparison, and reasoning. Cover multiple source topics, avoid trick wording, and do not mention the source material or this instruction. " +
          "Preserve mathematical notation accurately when it appears in the study notes.",
        input: {
          studyNotes: studySource,
          referenceTestForStyleOnly: referenceSource,
        },
        schema: generatedTestSchema,
        completionTokens: 2500,
      }),
    );

    const questions: TestQuestion[] = generated.questions.map((question) => ({
      ...question,
      id: randomUUID(),
    }));
    const savedTest = await db.transaction(async (tx) => {
      const [test] = await tx
        .insert(tests)
        .values({ userId, title, referenceFileId })
        .returning();
      if (!test) {
        throw new Error("Test metadata was not created");
      }

      await tx.insert(testContents).values({
        testId: test.id,
        instructions: generated.instructions,
        questions,
      });
      return test;
    });

    res.status(201).json(serialiseTest(savedTest));
  } catch (error) {
    Sentry.captureException(error, {
      tags: { area: "test-generation" },
    });
    res.status(500).json({ error: "Failed to generate test" });
  }
};

/**
 * GET /api/tests
 * List tests belonging to req.user.id.
 * No request body.
 * Respond with 200 Test[]; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getAllTests = async (
  req: Request,
  res: Response,
): Promise<void> => {};

/**
 * GET /api/tests/:id
 * Read owned test metadata.
 * req.params.id.
 * Respond with 200 Test; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getSingleTestById = async (
  req: Request,
  res: Response,
): Promise<void> => {};

/**
 * GET /api/tests/:id/content
 * Read generated questions, answers, options, and instructions for an owned test. Content persistence will need to be implemented separately from metadata.
 * req.params.id.
 * Respond with 200 TestContent; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const getTestContent = async (
  req: Request,
  res: Response,
): Promise<void> => {};

/**
 * DELETE /api/tests/:id
 * Delete an owned test and its generated content.
 * req.params.id.
 * Respond with 204 without a body; serialize timestamps as ISO strings without an envelope.
 * Return { error: string } for 400 validation, 401 authentication, 404 ownership/missing,
 * 409 conflicts, or 500 unexpected failures as applicable.
 * @param req - Authenticated Express request; use req.user.id for ownership.
 * @param res - Express response carrying the documented JSON payload/status.
 * @returns Resolves after sending the response once implemented.
 */
export const deleteSingleTest = async (
  req: Request,
  res: Response,
): Promise<void> => {};
