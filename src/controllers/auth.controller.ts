import { type Request, type Response } from "express";
import { createClient } from "../lib/supabase/server"

/**
 * Placeholder handler for authentication confirmation; currently sends no response.
 *
 * @param req - The incoming Express request.
 * @param res - The Express response to populate when the handler is implemented.
 * @returns Resolves without performing authentication.
 */
export const confirmAuth = async (req: Request, res: Response) => {

}