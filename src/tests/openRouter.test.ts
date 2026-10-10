import "dotenv/config";
import { chatStructured } from "../config/openRouterAI.js";
import { z } from "zod";

const AnswerSchema = z.object({
  answer: z.string(),
});

async function main() {
  const result = await chatStructured({
    instruction: "Answer the question clearly and briefly.",
    input: {
      question:
        "How many r's are in 'strawberry'? Return the number as a string.",
    },
    schema: AnswerSchema,
    completionTokens: 2500,
  });

  console.log(result);
}

main().catch((error) => {
  console.error("OpenRouter test failed:", error);
  process.exitCode = 1;
});
