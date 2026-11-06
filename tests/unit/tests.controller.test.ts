import type { Request, Response } from "express";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), transaction: jest.fn() },
}));

jest.mock("../../src/config/groqAI.js", () => ({
  ChatStructured: jest.fn(),
}));

jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));

import { generateTest } from "../../src/controllers/tests.controller.js";
import { ChatStructured } from "../../src/config/groqAI.js";
import { db } from "../../src/db/index.js";

const select = jest.mocked(db.select);
const transaction = jest.mocked(db.transaction);
const chatStructured = jest.mocked(ChatStructured);

const userId = "8918a4e1-dcd7-4dc6-948d-1e42e5e96e8d";
const notebookId = "a907a6e4-7965-4d45-86f9-1c9fac5ec196";
const studyDocumentId = "c7c0dfc8-d6c2-4c92-83b5-c6d7c2db0f8c";
const referenceDocumentId = "aa92fbf5-50a8-4e19-9b75-16c464c54cb8";
const testId = "43210c09-a35e-4ad7-8b9f-e44d90a42f54";

const studyDocument = { id: studyDocumentId, name: "Discrete mathematics" };
const referenceDocument = {
  id: referenceDocumentId,
  name: "Midterm example",
};
const savedTest = {
  id: testId,
  userId,
  title: "Discrete mathematics practice",
  referenceFileId: null,
  createdAt: new Date("2026-10-20T12:00:00.000Z"),
  updatedAt: new Date("2026-10-20T12:00:00.000Z"),
};

const generatedTest = {
  instructions:
    "Answer every question and show concise reasoning for constructed responses.",
  questions: Array.from({ length: 10 }, (_, index) => ({
    prompt: `Question ${index + 1}: explain the relevant discrete mathematics idea.`,
    answer:
      index < 6
        ? `Correct answer ${index + 1}`
        : "A concise supported explanation.",
    options:
      index < 6
        ? [
            `Correct answer ${index + 1}`,
            `Distractor A ${index + 1}`,
            `Distractor B ${index + 1}`,
            `Distractor C ${index + 1}`,
          ]
        : [],
  })),
};

const selectWithLimit = <T>(rows: T[]) => ({
  from: jest.fn(() => ({
    where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue(rows) })),
  })),
});

const selectRows = <T>(rows: T[]) => ({
  from: jest.fn(() => ({ where: jest.fn().mockResolvedValue(rows) })),
});

const selectWithOrder = <T>(rows: T[]) => ({
  from: jest.fn(() => ({
    where: jest.fn(() => ({ orderBy: jest.fn().mockResolvedValue(rows) })),
  })),
});

const request = (
  body: Record<string, unknown>,
  authenticated = true,
): Request =>
  ({
    body,
    user: authenticated ? { id: userId } : undefined,
  }) as Request;

const response = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }) as unknown as Response;

const notebookBody = (): Record<string, unknown> => ({
  title: "  Discrete mathematics practice  ",
  notebookId,
  mode: "notebook",
  referenceFileId: null,
  referenceUrl: null,
});

const mockSuccessfulPersistence = () => {
  const metadataReturning = jest.fn().mockResolvedValue([savedTest]);
  const metadataValues = jest.fn(() => ({ returning: metadataReturning }));
  const contentValues = jest.fn().mockResolvedValue(undefined);
  const insert = jest
    .fn()
    .mockReturnValueOnce({ values: metadataValues })
    .mockReturnValueOnce({ values: contentValues });

  transaction.mockImplementation(async (callback: never) =>
    callback({ insert } as never),
  );

  return { contentValues, metadataValues };
};

const mockNotebookSource = () => {
  select
    .mockReturnValueOnce(selectWithLimit([{ id: notebookId }]) as never)
    .mockReturnValueOnce(selectRows([studyDocument]) as never)
    .mockReturnValueOnce(
      selectWithOrder([
        {
          documentId: studyDocumentId,
          chunkIndex: 0,
          content:
            "Only study source: a bijection is both injective and surjective.",
        },
      ]) as never,
    );
};

beforeEach(() => {
  jest.clearAllMocks();
  chatStructured.mockResolvedValue(generatedTest as never);
});

it("rejects a caller without authentication before accessing study data", async () => {
  const res = response();

  await generateTest(request(notebookBody(), false), res);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  expect(select).not.toHaveBeenCalled();
});

it("rejects invalid mode/reference combinations without calling the database", async () => {
  const res = response();
  const body = notebookBody();
  body.referenceFileId = referenceDocumentId;

  await generateTest(request(body), res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({
    error: "Invalid reference test details",
  });
  expect(select).not.toHaveBeenCalled();
});

it("does not reveal a notebook that is absent or owned by someone else", async () => {
  select.mockReturnValueOnce(selectWithLimit([]) as never);
  const res = response();

  await generateTest(request(notebookBody()), res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ error: "Notebook not found" });
  expect(chatStructured).not.toHaveBeenCalled();
});

it("requires at least one ready study document before generation", async () => {
  select
    .mockReturnValueOnce(selectWithLimit([{ id: notebookId }]) as never)
    .mockReturnValueOnce(selectRows([]) as never);
  const res = response();

  await generateTest(request(notebookBody()), res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({
    error: "No ready study documents in this notebook",
  });
  expect(chatStructured).not.toHaveBeenCalled();
});

it("generates a balanced grounded test and atomically persists metadata and content", async () => {
  mockNotebookSource();
  const { contentValues, metadataValues } = mockSuccessfulPersistence();
  const res = response();

  await generateTest(request(notebookBody()), res);

  expect(chatStructured).toHaveBeenCalledWith(
    expect.objectContaining({
      completionTokens: 2500,
      input: expect.objectContaining({
        studyNotes: expect.stringContaining("Only study source"),
        referenceTestForStyleOnly: null,
      }),
      instruction: expect.stringContaining("six multiple-choice"),
    }),
  );
  expect(metadataValues).toHaveBeenCalledWith({
    userId,
    title: "Discrete mathematics practice",
    referenceFileId: null,
  });
  const persistedContent = contentValues.mock.calls[0]?.[0] as {
    testId: string;
    instructions: string;
    questions: Array<{ id: string; options: string[] }>;
  };
  expect(persistedContent.testId).toBe(testId);
  expect(persistedContent.instructions).toBe(generatedTest.instructions);
  expect(persistedContent.questions).toHaveLength(10);
  expect(
    persistedContent.questions.filter(
      (question) => question.options.length === 4,
    ),
  ).toHaveLength(6);
  expect(
    persistedContent.questions.filter(
      (question) => question.options.length === 0,
    ),
  ).toHaveLength(4);
  expect(
    new Set(persistedContent.questions.map((question) => question.id)).size,
  ).toBe(10);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({
    ...savedTest,
    title: "Discrete mathematics practice",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  });
});

it("uses an owned sample test for style only, never as factual study material", async () => {
  select
    .mockReturnValueOnce(selectWithLimit([{ id: notebookId }]) as never)
    .mockReturnValueOnce(
      selectRows([studyDocument, referenceDocument]) as never,
    )
    .mockReturnValueOnce(selectWithLimit([referenceDocument]) as never)
    .mockReturnValueOnce(
      selectWithOrder([
        {
          documentId: studyDocumentId,
          chunkIndex: 0,
          content: "Only study source: prove that a bijection has an inverse.",
        },
        {
          documentId: referenceDocumentId,
          chunkIndex: 0,
          content:
            "Example format source: Section A has short answer questions.",
        },
      ]) as never,
    );
  mockSuccessfulPersistence();
  const res = response();

  await generateTest(
    request({
      ...notebookBody(),
      mode: "reference",
      referenceFileId: referenceDocumentId,
      referenceUrl: "https://files.example.test/midterm.pdf",
    }),
    res,
  );

  const modelInput = chatStructured.mock.calls[0]?.[0]?.input as {
    studyNotes: string;
    referenceTestForStyleOnly: string;
  };
  expect(modelInput.studyNotes).toContain("Only study source");
  expect(modelInput.studyNotes).not.toContain("Example format source");
  expect(modelInput.referenceTestForStyleOnly).toContain(
    "Example format source",
  );
  expect(res.status).toHaveBeenCalledWith(201);
});

it("does not persist a test when generated content violates the assessment contract", async () => {
  mockNotebookSource();
  chatStructured.mockResolvedValue({
    instructions: "This looks plausible but has the wrong question count.",
    questions: [],
  } as never);
  const res = response();

  await generateTest(request(notebookBody()), res);

  expect(transaction).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: "Failed to generate test" });
});
