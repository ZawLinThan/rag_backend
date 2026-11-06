import type { Request, Response } from "express";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/config/env.js", () => ({
  env: { R2_BUCKET_NAME: "test-bucket" },
}));

jest.mock("../../src/config/r2.js", () => ({
  s3: { send: jest.fn() },
}));

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), update: jest.fn(), transaction: jest.fn() },
}));

jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock("../../src/queue/document.queue.js", () => ({
  documentQueue: { add: jest.fn() },
}));

jest.mock("../../src/services/ingest.service.js", () => ({
  updateDocumentStatus: jest.fn(),
}));

import {
  deleteDocument,
  editDocument,
  getAllDocuments,
  getDocumentFile,
  getSingleDocument,
} from "../../src/controllers/documents.controller.js";
import { s3 } from "../../src/config/r2.js";
import { db } from "../../src/db/index.js";

const select = jest.mocked(db.select);
const update = jest.mocked(db.update);
const transaction = jest.mocked(db.transaction);
const send = jest.mocked(s3.send);

const userId = "8918a4e1-dcd7-4dc6-948d-1e42e5e96e8d";
const documentId = "c7c0dfc8-d6c2-4c92-83b5-c6d7c2db0f8c";
const document = {
  id: documentId,
  userId,
  name: "Lecture notes",
  originalName: "lecture-notes.pdf",
  r2Key: `${userId}/lecture-notes.pdf`,
  fileType: "pdf",
  fileSize: 512,
  status: "ready" as const,
  errorMessage: null,
  courseId: null,
  notebookId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function selectRows<T>(rows: T[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const orderBy = jest.fn().mockResolvedValue(rows);
  const where = jest.fn(() => ({ limit, orderBy }));
  const from = jest.fn(() => ({ where }));
  return { from };
}

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
}

function request(id = documentId, authenticated = true) {
  return {
    params: { id },
    user: authenticated ? { id: userId } : undefined,
  } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({} as never);
});

it("lists only the authenticated user's documents", async () => {
  select.mockReturnValueOnce(selectRows([document]) as never);
  const res = response();

  await getAllDocuments(request(), res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith([document]);
});

it("lists documents for an owned notebook", async () => {
  select
    .mockReturnValueOnce(selectRows([{ id: documentId }]) as never)
    .mockReturnValueOnce(selectRows([document]) as never);
  const req = request();
  req.query = { notebookId: documentId };
  const res = response();
  await getAllDocuments(req, res);
  expect(select).toHaveBeenCalledTimes(2);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith([document]);
});

it("does not list documents for a missing or foreign notebook", async () => {
  select.mockReturnValueOnce(selectRows([]) as never);
  const req = request();
  req.query = { notebookId: documentId };
  const res = response();
  await getAllDocuments(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(select).toHaveBeenCalledTimes(1);
});

it("rejects an invalid notebook filter", async () => {
  const req = request();
  req.query = { notebookId: "invalid" };
  const res = response();
  await getAllDocuments(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(select).not.toHaveBeenCalled();
});

it("does not reveal another user's document", async () => {
  select.mockReturnValueOnce(selectRows([]) as never);
  const res = response();

  await getSingleDocument(request(), res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ error: "Document not found" });
});

it("retrieves the original file for its owner", async () => {
  select.mockReturnValueOnce(selectRows([document]) as never);
  send.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => new Uint8Array([65, 66]) },
  } as never);
  const res = response();
  await getDocumentFile(request(), res);
  expect(send).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith(Buffer.from("AB"));
});

it("does not retrieve a file that is not owned", async () => {
  select.mockReturnValueOnce(selectRows([]) as never);
  const res = response();
  await getDocumentFile(request(), res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(send).not.toHaveBeenCalled();
});

it("deletes the R2 object and database metadata when there are no references", async () => {
  select
    .mockReturnValueOnce(selectRows([document]) as never)
    .mockReturnValueOnce(selectRows([]) as never)
    .mockReturnValueOnce(selectRows([]) as never);

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  transaction.mockImplementation(async (callback: never) =>
    callback({
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where: updateWhere })),
      })),
      delete: jest.fn(() => ({ where: deleteWhere })),
    }),
  );
  const res = response();

  await deleteDocument(request(), res);

  expect(send).toHaveBeenCalledTimes(1);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(updateWhere).toHaveBeenCalledTimes(1);
  expect(deleteWhere).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(204);
  expect(res.send).toHaveBeenCalledWith();
});

it("rejects deletion when a test references the document", async () => {
  select
    .mockReturnValueOnce(selectRows([document]) as never)
    .mockReturnValueOnce(selectRows([{ id: "test-id" }]) as never);
  const res = response();

  await deleteDocument(request(), res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({
    error: "Document is referenced by a test and cannot be deleted",
  });
  expect(send).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});

it("updates the owned document's display name and timestamp", async () => {
  const updated = { ...document, name: "New name" };
  const returning = jest.fn().mockResolvedValue([updated]);
  const where = jest.fn(() => ({ returning }));
  const set = jest.fn(() => ({ where }));
  update.mockReturnValueOnce({ set } as never);
  const req = request();
  req.body = { name: "  New name  " };
  const res = response();

  await editDocument(req, res);

  expect(set).toHaveBeenCalledWith({
    name: "New name",
    updatedAt: expect.any(Date),
  });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(updated);
});

it.each([undefined, "", "  ", 42, "a".repeat(256)])(
  "rejects an invalid document name: %p",
  async (name) => {
    const req = request();
    req.body = { name };
    const res = response();
    await editDocument(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(update).not.toHaveBeenCalled();
  },
);

it("returns 404 when the document is not owned or does not exist", async () => {
  const returning = jest.fn().mockResolvedValue([]);
  update.mockReturnValueOnce({
    set: () => ({ where: () => ({ returning }) }),
  } as never);
  const req = request();
  req.body = { name: "New name" };
  const res = response();
  await editDocument(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

it("requires authentication to edit a document", async () => {
  const res = response();
  await editDocument(request(documentId, false), res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(update).not.toHaveBeenCalled();
});
