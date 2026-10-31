import type { Request, Response } from "express";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));
jest.mock("../../src/config/openRouterAI.js", () => ({ embedText: jest.fn() }));
jest.mock("../../src/services/answer.service.js", () => ({
  generateAnswer: jest.fn(),
}));
jest.mock("../../src/services/retrieval.service.js", () => ({
  retrieveForSession: jest.fn(),
  RetrievalSessionNotFoundError: class extends Error {},
}));

import {
  createNewChatSession,
  getSingleChatSession,
} from "../../src/controllers/chat.controller.js";
import { db } from "../../src/db/index.js";

const id = "c7c0dfc8-d6c2-4c92-83b5-c6d7c2db0f8c";
const select = jest.mocked(db.select);
const transaction = jest.mocked(db.transaction);
const req = { user: { id: "user" }, body: { documentIds: [id] } } as Request;
function res() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
}
function rows(result: unknown[]) {
  select.mockReturnValueOnce({
    from: () => ({ where: async () => result }),
  } as never);
}
beforeEach(() => jest.clearAllMocks());

it.each(["pending", "queued", "processing", "failed"])(
  "rejects a %s document",
  async (status) => {
    rows([{ id, status }]);
    const response = res();
    await createNewChatSession(req, response);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(transaction).not.toHaveBeenCalled();
  },
);

it("does not create a session for missing or unowned documents", async () => {
  rows([]);
  const response = res();
  await createNewChatSession(req, response);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(transaction).not.toHaveBeenCalled();
});

it("creates a session with ready document IDs", async () => {
  rows([{ id, status: "ready" }]);
  const values = jest.fn().mockResolvedValue(undefined);
  transaction.mockImplementation(async (callback: never) =>
    callback({
      insert: jest
        .fn()
        .mockReturnValueOnce({
          values: () => ({ returning: async () => [{ id: "session" }] }),
        })
        .mockReturnValueOnce({ values }),
    }),
  );
  const response = res();
  await createNewChatSession(req, response);
  expect(values).toHaveBeenCalledWith([
    { sessionId: "session", documentId: id },
  ]);
  expect(response.status).toHaveBeenCalledWith(201);
  expect(response.json).toHaveBeenCalledWith({ sessionId: "session" });
});

it("restores a session's original document IDs and message citations", async () => {
  const session = { id, userId: "user" };
  const message = { id: "message", role: "assistant", content: "answer" };
  const source = {
    messageId: "message",
    chunkId: "chunk",
    documentId: "doc",
    documentName: "Notes",
    pageNumber: 1,
    content: "text",
    score: 0.8,
  };
  select
    .mockReturnValueOnce({
      from: () => ({ where: async () => [session] }),
    } as never)
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: async () => [message] }) }),
    } as never)
    .mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({ where: async () => [{ id: "doc" }] }),
      }),
    } as never)
    .mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({ where: async () => [source] }),
        }),
      }),
    } as never);
  const response = res();
  await getSingleChatSession(
    { user: { id: "user" }, params: { id } } as unknown as Request,
    response,
  );
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({
    ...session,
    documentIds: ["doc"],
    messages: [{ ...message, sources: [source] }],
  });
});

it("does not reveal an unowned session", async () => {
  select.mockReturnValueOnce({
    from: () => ({ where: async () => [] }),
  } as never);
  const response = res();
  await getSingleChatSession(
    { user: { id: "user" }, params: { id } } as unknown as Request,
    response,
  );
  expect(response.status).toHaveBeenCalledWith(404);
  expect(select).toHaveBeenCalledTimes(1);
});
