import type { Request, Response } from "express";
import { beforeEach, expect, it, jest } from "@jest/globals";

jest.mock("../../src/db/index.js", () => ({ db: { insert: jest.fn() } }));

import { createCourse } from "../../src/controllers/courses.controller.js";
import { db } from "../../src/db/index.js";

const insert = jest.mocked(db.insert);
const date = new Date("2026-01-01T00:00:00.000Z");

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
}

beforeEach(() => jest.clearAllMocks());

it("creates a course with optional fields omitted", async () => {
  const course = {
    id: "course",
    userId: "user",
    name: "Biology",
    code: null,
    semester: null,
    createdAt: date,
    updatedAt: date,
  };
  const returning = jest.fn().mockResolvedValue([course]);
  const values = jest.fn(() => ({ returning }));
  insert.mockReturnValueOnce({ values } as never);
  const res = response();

  await createCourse(
    {
      user: { id: "user" },
      body: { name: " Biology ", code: null, semester: " " },
    } as Request,
    res,
  );

  expect(values).toHaveBeenCalledWith({
    userId: "user",
    name: "Biology",
    code: null,
    semester: null,
  });
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({
    ...course,
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
  });
});

it.each([
  {},
  { name: " " },
  { name: "a".repeat(256) },
  { name: "Biology", code: 42 },
  { name: "Biology", semester: {} },
  { name: "Biology", code: "a".repeat(51) },
  { name: "Biology", semester: "a".repeat(51) },
])("rejects invalid input %j", async (body) => {
  const res = response();
  await createCourse({ user: { id: "user" }, body } as Request, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(insert).not.toHaveBeenCalled();
});

it("requires authentication", async () => {
  const res = response();
  await createCourse({ body: { name: "Biology" } } as Request, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(insert).not.toHaveBeenCalled();
});
