import type { Request, Response } from "express";
import { protectRoute } from "../middleware/protectRoute.js";
import { supabase } from "../config/supabase.js";

jest.mock("../config/supabase.js", () => ({
  supabase: { auth: { getUser: jest.fn() } },
}));

const getUser = supabase.auth.getUser as jest.Mock;

function setup(header?: string) {
  const req = { get: jest.fn(() => header) } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => getUser.mockReset());

it.each([undefined, "", "Basic token", "Bearer", "Bearer token extra"])(
  "rejects missing or malformed authorization: %s",
  async (header) => {
    const { req, res, next } = setup(header);
    await protectRoute(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  },
);

it.each([
  { data: { user: null }, error: { message: "Invalid token" } },
  { data: { user: null }, error: null },
])("rejects an unverified user", async (result) => {
  getUser.mockResolvedValue(result);
  const { req, res, next } = setup("Bearer invalid-token");
  await protectRoute(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
});

it("attaches the verified user and continues", async () => {
  const user = { id: "verified-user" };
  getUser.mockResolvedValue({ data: { user }, error: null });
  const { req, res, next } = setup("bearer valid-token");
  await protectRoute(req, res, next);
  expect(getUser).toHaveBeenCalledWith("valid-token");
  expect(req.user).toBe(user);
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

it("responds when authentication throws", async () => {
  getUser.mockRejectedValue(new Error("Network unavailable"));
  const { req, res, next } = setup("Bearer token");
  await protectRoute(req, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});
