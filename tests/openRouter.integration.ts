import "dotenv/config";
import { z } from "zod";
import { chatStructured } from "../src/config/openRouterAI.js";

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
});
