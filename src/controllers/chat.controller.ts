import type { Request, Response } from "express";
/**
 * @description Create a new chat session with 1+ documents. This will create a new chat session in the database and return the session ID.
 * EndPoint: POST /chat/sessions
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const createNewChatSession = async (req: Request, res: Response) => {};

/**
 * @description Get all chat sessions for the user from the database. This will return a list of chat sessions as a JSON array of session objects. (id, metadata, messages)
 * EndPoint: GET /chat/sessions
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getAllChatSessions = async (req: Request, res: Response) => {};

/**
 * @description Get a single chat session by its ID from the database. This will return the chat session as a JSON object. (id, metadata, messages)
 * EndPoint: GET /chat/sessions/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const getSingleChatSession = async (req: Request, res: Response) => {};

/**
 * @description Delete a chat session by its ID from the database. This will delete the chat session and all its messages.
 * EndPoint: DELETE /chat/sessions/:id
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @returns void
 */
export const deleteChatSession = async (req: Request, res: Response) => {};
