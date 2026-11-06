import { beforeEach, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("../../src/db/index.js", () => ({
  db: { select: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../src/config/sentry.js", () => ({
  Sentry: { captureException: jest.fn() },
}));
import { db } from "../../src/db/index.js";
import { renameCourse } from "../../src/controllers/courses.controller.js";
import {
  editNotebook,
  deleteNotebook,
} from "../../src/controllers/notebooks.controller.js";
const id = "c7c0dfc8-d6c2-4c92-83b5-c6d7c2db0f8c";
const userId = "8918a4e1-dcd7-4dc6-948d-1e42e5e96e8d";
const request = (body: unknown = {}) =>
  ({ user: { id: userId }, params: { id }, body }) as Request;
const response = () =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
  }) as unknown as Response;
function rows(value: unknown[]) {
  jest.mocked(db.select).mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: async () => value }) }),
  } as never);
}
beforeEach(() => jest.clearAllMocks());

it.each([renameCourse, editNotebook, deleteNotebook])(
  "requires authentication",
  async (handler) => {
    const res = response();
    await handler({ params: { id } } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  },
);
it.each([renameCourse, editNotebook])(
  "rejects invalid names",
  async (handler) => {
    const res = response();
    await handler(request({ name: " ", noteBookName: " " }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.update).not.toHaveBeenCalled();
  },
);
it("renames only an owned course and trims the name", async () => {
  const where = jest.fn(() => ({
    returning: async () => [
      { id, userId, name: "New", createdAt: new Date(), updatedAt: new Date() },
    ],
  }));
  const set = jest.fn(() => ({ where }));
  jest.mocked(db.update).mockReturnValueOnce({ set } as never);
  const res = response();
  await renameCourse(request({ name: " New " }), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(set).toHaveBeenCalledWith({
    name: "New",
    updatedAt: expect.any(Date),
  });
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.params).toEqual([id, userId]);
});
it("does not reveal an unowned notebook", async () => {
  rows([]);
  const res = response();
  await editNotebook(request({ noteBookName: "New" }), res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(db.update).not.toHaveBeenCalled();
});
it("rejects duplicate notebook names", async () => {
  rows([{ id, courseId: id }]);
  rows([{ id: "duplicate" }]);
  const res = response();
  await editNotebook(request({ noteBookName: "New" }), res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(db.update).not.toHaveBeenCalled();
});
it("edits an owned notebook", async () => {
  rows([{ id, courseId: id }]);
  rows([]);
  jest.mocked(db.update).mockReturnValueOnce({
    set: () => ({
      where: () => ({ returning: async () => [{ id, noteBookName: "New" }] }),
    }),
  } as never);
  const res = response();
  await editNotebook(request({ noteBookName: "New" }), res);
  expect(res.status).toHaveBeenCalledWith(200);
});
it.each([
  [[], 409],
  [[{ id }], 204],
] as const)("deletes only empty notebooks", async (deleted, status) => {
  rows([{ id }]);
  const where = jest.fn(() => ({ returning: async () => deleted }));
  jest.mocked(db.delete).mockReturnValueOnce({ where } as never);
  const res = response();
  await deleteNotebook(request(), res);
  expect(res.status).toHaveBeenCalledWith(status);
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain("not exists");
  expect(query.params).toContain(userId);
});
it("does not delete an unowned notebook", async () => {
  rows([]);
  const res = response();
  await deleteNotebook(request(), res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(db.delete).not.toHaveBeenCalled();
});
