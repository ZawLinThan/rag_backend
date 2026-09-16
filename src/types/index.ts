import {z} from "zod"; 

/**
* Props TYPE for LLM request
*
* instruction : the instruction to send to LLM 
* input: question from the user
* schema: the schema we want LLM to output
* completionTokens: 
*/
export type GroqChatRequest<T> = {
    instruction: string, 
    input: unknown,
    schema: z.ZodType<T>,
    completionTokens: 2500, 
}

export type Provider = "groq"; // add here if more AI's are added
