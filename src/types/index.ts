import { z } from "zod";

/**
 * Options for a structured Groq model request.
 *
 * @template T - The output type validated by the schema.
 * @property instruction - System instructions sent to the model.
 * @property input - Input data serialized into the user message.
 * @property schema - The schema used to constrain and validate the response.
 * @property completionTokens - The completion token limit, currently fixed at 2500.
 */
export type ChatRequest<T> = {
  instruction: string;
  input: unknown;
  schema: z.ZodType<T>;
  completionTokens: 2500;
};

/**
 * Supported AI provider identifiers.
 */
export type Provider = "groq" | "openrouter"; // add here if more AI's are added

export type GetPresignedUrlReq = {
  fileName: string, 
  contentType: string, 
  size: number, 
}

export type ConfirmFileUploadReq = {
  name: string,
  originalName: string, 
  r2Key: string, 
  fileType: string, fileSize: number, courseId:string, notebookId:string
}