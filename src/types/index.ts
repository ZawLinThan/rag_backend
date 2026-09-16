import {z} from "zod"; 

/**
 * Options for a structured Groq model request.
 *
 * @template T - The output type validated by the schema.
 * @property instruction - System instructions sent to the model.
 * @property input - Input data serialized into the user message.
 * @property schema - The schema used to constrain and validate the response.
 * @property completionTokens - The completion token limit, currently fixed at 2500.
 */
export type GroqChatRequest<T> = {
    instruction: string, 
    input: unknown,
    schema: z.ZodType<T>,
    completionTokens: 2500, 
}

/**
 * Supported AI provider identifiers.
 */
export type Provider = "groq"; // add here if more AI's are added
