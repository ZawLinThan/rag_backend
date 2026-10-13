import type { Request, Response } from "express";
import { jest, expect, it, beforeEach } from "@jest/globals";

jest.mock("../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() } },
}));

jest.mock("../src/config/sentry.js", () => ({
  Sentry: { setUser: jest.fn(), captureException: jest.fn() },
}));

import { protectRoute } from "../src/middleware/protectRoute.js";
import { supabase } from "../src/config/supabase.js";
import { Sentry } from "../src/config/sentry.js";

const getUser = jest.mocked(supabase.auth.getUser);

function setup(header?: string) {
  const req = { get: jest.fn(() => header) } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockReset();
});

it.each([undefined, "", "Basic token", "Bearer", "Bearer token extra"])(
  "rejects missing or malformed authorization: %s",
  async (header) => {
    const { req, res, next } = setup(header);
    await protectRoute(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(Sentry.setUser).not.toHaveBeenCalled();
  },
);

it.each([
  { data: { user: null }, error: { message: "Invalid token" } },
  { data: { user: null }, error: null },
])("rejects an unverified user", async (result) => {
  getUser.mockResolvedValue(
    result as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>,
  );
  const { req, res, next } = setup("Bearer invalid-token");
  await protectRoute(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
});

it("attaches the verified user and continues", async () => {
  const user = { id: "verified-user" };
  getUser.mockResolvedValue({
    data: { user },
    error: null,
  } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>);
  const { req, res, next } = setup("bearer valid-token");
  await protectRoute(req, res, next);
  expect(getUser).toHaveBeenCalledWith("valid-token");
  expect(req.user).toBe(user);
  expect(Sentry.setUser).toHaveBeenCalledWith({ id: user.id });
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

it("responds when authentication throws", async () => {
  const failure = new Error("Network unavailable");
  getUser.mockRejectedValue(failure);
  const { req, res, next } = setup("Bearer token");
  await protectRoute(req, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({
    error: "Authentication service unavailable",
  });
  expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
    tags: { area: "authentication" },
  });
  expect(next).not.toHaveBeenCalled();
});
