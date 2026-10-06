import type { Request, Response, NextFunction } from "express";

/**
 * @description Middleware to protect routes by checking for a valid session.
 * If the session is invalid or missing, it responds with a 401 Unauthorized status.
 * The income req object will have a Bearer token in the Authorization header, which will be verified to ensure the user is authenticated.
 * Verify the token using Supabase's auth API
 * Attach the @link User object to the req for downstream handlers to use. // see express.d.ts for the type definition of the User object
 * Error format: { error: "Your error message here" }
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @param next - Express NextFunction callback
 * @returns void
 */
export const protectRoute = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {};
