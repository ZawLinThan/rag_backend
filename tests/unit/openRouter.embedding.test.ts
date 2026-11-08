const generate = jest.fn();

jest.mock("@openrouter/sdk", () => ({
  OpenRouter: jest.fn().mockImplementation(() => ({
    embeddings: { generate },
  })),
}));

import { embedText } from "../../src/config/openRouterAI.js";

it("preserves provider errors so rate limits can be retried", async () => {
  const error = Object.assign(new Error("rate limited"), { status: 429 });
  generate.mockRejectedValueOnce(error);

  await expect(embedText("text")).rejects.toBe(error);
  expect(error).toMatchObject({
    status: 429,
    provider: "openrouter embedding",
  });
  expect(generate).toHaveBeenCalledTimes(1);
});

it("reports a response without an embedding vector", async () => {
  generate.mockResolvedValueOnce({ data: [] });
  await expect(embedText("text")).rejects.toThrow(
    "The embedding response contained no vector.",
  );
});
