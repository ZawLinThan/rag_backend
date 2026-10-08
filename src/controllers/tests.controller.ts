import type { Request, Response } from "express";

/**
 * @description The controller function to generate the test based on the user's uploaded file
 * req must have R2 url attached
 *
 * @param req -
 * @param res -
 */
export const generateTest = async (req: Request, res: Response) => {};

/**
 * @description The controller function to return all tests for the user
 *
 * @param req
 * @param res
 */
export const getAllTests = async (req: Request, res: Response) => {};

/**
 * @description The controller function to return the specific test by the testId for the user
 *
 * @param req
 * @param res
 */
export const getSingleTestById = async (req: Request, res: Response) => {};

/**
 * @description The controller function to delete the specific test from the user
 *
 * @param req
 * @param res
 */
export const deleteSingleTest = async (req: Request, res: Response) => {};
